import http from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const tmp = await mkdtemp(path.join(os.tmpdir(), "blindspot-ci-test-"));
process.env.BLINDSPOT_REPORTS_DIR = path.join(tmp, "reports");
const ci = await import("../src/core/ci.js");
const { ConfigError, evaluateJourney, exitCodeFor, parseArgs, parseConfig, renderMarkdown, resolveJourneyUrl, runCi, startStaticServer } = ci;
type Report = import("../src/core/types.js").Report;

const journey = (extra: Record<string, unknown> = {}) => ({ name: "Book", url: "/book", task: "Book an appointment", ...extra });
const configError = (raw: unknown) => {
  try {
    parseConfig(raw);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return (err as Error).message;
  }
  throw new Error("expected a ConfigError");
};

describe("config validation", () => {
  it("accepts a minimal and a full config", () => {
    expect(parseConfig({ journeys: [journey()] }).journeys[0].name).toBe("Book");
    const full = parseConfig({
      $schema: "x", note: "n", baseUrl: "https://preview.example.com", minScore: 80, brain: "scripted",
      journeys: [journey({ minScore: 90, mustSucceed: false, note: "known bad" })],
    });
    expect(full.brain).toBe("scripted");
    expect(full.journeys[0].mustSucceed).toBe(false);
  });

  it("accepts the repository's blindspot.config.json", async () => {
    const raw = JSON.parse(await readFile(new URL("../blindspot.config.json", import.meta.url), "utf8"));
    const cfg = parseConfig(raw);
    expect(cfg.journeys.map((j) => j.mustSucceed)).toEqual([true, false]);
  });

  it("reports every problem with its path", () => {
    const msg = configError({
      baseUrl: "ftp://example.com", brain: "gpt", extra: 1,
      journeys: [journey({ mustsucceed: true }), { name: "", url: "/x", task: "t", minScore: 120 }, { name: "No task", url: "/x" }],
    });
    expect(msg).toContain("baseUrl: must be an absolute http(s) URL");
    expect(msg).toContain('brain: must be "claude" or "scripted"');
    expect(msg).toMatch(/\(root\): Unrecognized key: "extra" \(allowed: .*journeys/);
    expect(msg).toMatch(/journeys\[0\]: Unrecognized key: "mustsucceed" \(allowed: .*mustSucceed/);
    expect(msg).toContain("journeys[1].name: must not be empty");
    expect(msg).toContain("journeys[1].minScore: must be between 0 and 100");
    expect(msg).toContain("journeys[2].task");
  });

  it("requires at least one journey and unique names", () => {
    expect(configError({})).toContain("journeys");
    expect(configError({ journeys: [] })).toContain("journeys: must contain at least one journey");
    expect(configError({ journeys: [journey(), journey()] })).toContain('journeys[1].name: duplicate journey name "Book"');
  });

  it("loadConfig rejects missing files and invalid JSON", async () => {
    await expect(ci.loadConfig(path.join(tmp, "missing.json"))).rejects.toThrow(/Cannot read config file/);
    const bad = path.join(tmp, "bad.json");
    await writeFile(bad, "{ journeys: ");
    await expect(ci.loadConfig(bad)).rejects.toThrow(/not valid JSON/);
  });
});

describe("journey URLs", () => {
  it("appends relative URLs to the base URL's path", () => {
    expect(resolveJourneyUrl("/fixed/index.html", "http://127.0.0.1:4000/")).toBe("http://127.0.0.1:4000/fixed/index.html");
    expect(resolveJourneyUrl("/fixed/index.html", "https://preview.example.com/demo")).toBe("https://preview.example.com/demo/fixed/index.html");
    expect(resolveJourneyUrl("book?x=1", "https://preview.example.com/demo/")).toBe("https://preview.example.com/demo/book?x=1");
  });

  it("keeps absolute URLs and rejects other schemes or a missing base", () => {
    expect(resolveJourneyUrl("https://other.example.com/a", "http://127.0.0.1/")).toBe("https://other.example.com/a");
    expect(() => resolveJourneyUrl("file:///etc/passwd", "http://x/")).toThrow(ConfigError);
    expect(() => resolveJourneyUrl("/book")).toThrow(/relative but no baseUrl/);
  });
});

describe("pass/fail decision", () => {
  const report = (status: Report["status"], score?: number, error?: string) => ({ status, score, error });

  it("requires success by default", () => {
    expect(evaluateJourney(journey(), report("success", 100)).passed).toBe(true);
    const v = evaluateJourney(journey(), report("blocked", 20));
    expect(v.passed).toBe(false);
    expect(v.reasons[0]).toContain("status: blocked");
    expect(evaluateJourney(journey(), report("step_limit", 30)).passed).toBe(false);
  });

  it("allows known-bad journeys with mustSucceed: false", () => {
    expect(evaluateJourney(journey({ mustSucceed: false }), report("blocked", 0)).passed).toBe(true);
  });

  it("checks the journey minScore, falling back to the global one", () => {
    expect(evaluateJourney(journey({ minScore: 90 }), report("success", 89)).reasons).toEqual(["score 89 is below the minimum of 90"]);
    expect(evaluateJourney(journey({ minScore: 90 }), report("success", 90)).passed).toBe(true);
    expect(evaluateJourney(journey(), report("success", 70), { minScore: 80 }).passed).toBe(false);
    expect(evaluateJourney(journey({ minScore: 60 }), report("success", 70), { minScore: 80 }).passed).toBe(true);
    // mustSucceed: false does not disable the score check.
    expect(evaluateJourney(journey({ mustSucceed: false, minScore: 50 }), report("blocked", 10)).passed).toBe(false);
  });

  it("always fails a run that errored", () => {
    const v = evaluateJourney(journey({ mustSucceed: false }), report("error", undefined, "net::ERR_CONNECTION_REFUSED"));
    expect(v.passed).toBe(false);
    expect(v.reasons[0]).toContain("ERR_CONNECTION_REFUSED");
    expect(evaluateJourney(journey({ minScore: 10 }), report("error")).reasons).toHaveLength(2);
  });

  it("exit code is 1 when any journey failed", () => {
    expect(exitCodeFor([{ passed: true }, { passed: true }])).toBe(0);
    expect(exitCodeFor([{ passed: true }, { passed: false }])).toBe(1);
  });
});

describe("command line", () => {
  it("parses arguments", () => {
    expect(parseArgs([])).toMatchObject({ config: "blindspot.config.json", serve: false, summary: "blindspot-summary.md" });
    expect(parseArgs(["my.json", "--brain", "scripted", "--serve"])).toMatchObject({ config: "my.json", brain: "scripted", serve: true });
    expect(parseArgs(["--brain=claude", "--base-url", "https://x.dev"])).toMatchObject({ brain: "claude", baseUrl: "https://x.dev" });
    expect(() => parseArgs(["--brain", "gpt"])).toThrow(ConfigError);
    expect(() => parseArgs(["--nope"])).toThrow(/Unknown option/);
    expect(() => parseArgs(["--serve", "--base-url", "https://x.dev"])).toThrow(/either/);
    expect(() => parseArgs(["a.json", "b.json"])).toThrow(/at most one/);
  });

  it("exits with 2 on config errors", async () => {
    const errors: string[] = [];
    const quiet = { log: () => {}, error: (l: string) => errors.push(l) };
    expect(await runCi([path.join(tmp, "missing.json")], quiet)).toBe(2);
    const cfg = path.join(tmp, "relative.json");
    await writeFile(cfg, JSON.stringify({ journeys: [journey()] }));
    expect(await runCi([cfg, "--brain", "scripted"], quiet)).toBe(2);
    expect(await runCi([cfg, "--brain", "claude"], { ...quiet, env: {} })).toBe(2);
    expect(errors.join("\n")).toMatch(/Cannot read config file[\s\S]*relative but no baseUrl[\s\S]*ANTHROPIC_API_KEY/);
  });
});

describe("static demo server", () => {
  const get = (base: string, rawPath: string) =>
    new Promise<number>((resolve, reject) => {
      const u = new URL(base);
      http.get({ host: u.hostname, port: u.port, path: rawPath }, (res) => { res.resume(); resolve(res.statusCode ?? 0); }).on("error", reject);
    });

  it("serves demo-site/ and refuses path traversal", async () => {
    const server = await startStaticServer();
    try {
      expect(await get(server.baseUrl, "/fixed/index.html")).toBe(200);
      expect(await get(server.baseUrl, "/fixed/")).toBe(200);
      expect(await get(server.baseUrl, "/shared/style.css")).toBe(200);
      expect(await get(server.baseUrl, "/../package.json")).toBe(404);
      expect(await get(server.baseUrl, "/%2e%2e/package.json")).toBe(404);
      expect(await get(server.baseUrl, "/..%2fpackage.json")).toBe(404);
      expect(await get(server.baseUrl, "/fixed/..%2f..%2fpackage.json")).toBe(404);
      expect(await get(server.baseUrl, "/%E0%A4%A")).toBe(400);
    } finally {
      await server.close();
    }
  });
});

describe("markdown summary", () => {
  it("escapes table cells and lists failures", () => {
    const rep = { id: "r1", url: "u", task: "t", model: "m", status: "blocked", summary: "", startedAt: "", steps: [], issues: [], score: 10 } as Report;
    const issue = { id: "i", severity: "critical", title: "A | B", description: "", wcag: [], fix: "", stepIndex: 0, source: "agent", blocking: true } as import("../src/core/types.js").Issue;
    const md = renderMarkdown([
      { journey: journey({ name: "Pay | checkout" }), url: "https://x/pay", report: rep, passed: false, reasons: ["the task was not completed"], blockingIssues: [issue] },
    ], "claude");
    expect(md).toContain("**0/1 journeys passed**");
    expect(md).toContain("| Pay \\| checkout | **FAIL** | blocked | 10 | 1 | A \\| B |");
    expect(md).toContain("### Failures");
  });
});

describe("CI run on the demo clinic (scripted agent, --serve)", () => {
  it("passes: fixed succeeds, bad is blocked but allowed", async () => {
    const summary = path.join(tmp, "summary.md");
    const stepSummary = path.join(tmp, "step-summary.md");
    await writeFile(stepSummary, "previous step\n");
    const lines: string[] = [];
    const code = await runCi(
      [new URL("../blindspot.config.json", import.meta.url).pathname, "--brain", "scripted", "--serve", "--summary", summary],
      { env: { GITHUB_STEP_SUMMARY: stepSummary }, log: (l) => lines.push(l), error: (l) => lines.push(l) },
    );
    expect(code, lines.join("\n")).toBe(0);
    const md = await readFile(summary, "utf8");
    expect(md).toContain("**2/2 journeys passed**");
    expect(md).toMatch(/\| Book appointment \(fixed clinic\) \| \*\*PASS\*\* \| success \| \d+ \(min 90\) \| 0 \| - \|/);
    expect(md).toMatch(/\| Book appointment \(inaccessible clinic\) \| \*\*PASS\*\* \(known issue\) \| blocked \| \d+ \| [1-9]\d* \| Time slots cannot be selected \|/);
    const step = await readFile(stepSummary, "utf8");
    expect(step.startsWith("previous step\n")).toBe(true);
    expect(step).toContain(md);
  }, 120_000);

  it("fails with exit code 1 when a required journey is blocked", async () => {
    const cfg = path.join(tmp, "strict.json");
    await writeFile(cfg, JSON.stringify({ journeys: [{ name: "Bad clinic must work", url: "/bad/index.html", task: "Book with Dr. Lee" }] }));
    const summary = path.join(tmp, "strict.md");
    const code = await runCi([cfg, "--brain", "scripted", "--serve", "--summary", summary], { env: {}, log: () => {}, error: () => {} });
    expect(code).toBe(1);
    expect(await readFile(summary, "utf8")).toMatch(/\*\*FAIL\*\*[\s\S]*### Failures[\s\S]*status: blocked/);
  }, 120_000);
});
