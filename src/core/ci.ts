// CI mode: accessibility regression tests for real user journeys.
// A blindspot.config.json lists journeys (URL + task); each one is run with the agent and
// checked against its requirements (task must succeed, minimum score). See docs/CI.md.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { appendFile, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { runTest } from "./agent.js";
import type { Brain } from "./brains/brain.js";
import { ClaudeBrain } from "./brains/claude.js";
import { ScriptedBrain, demoPlanFor } from "./brains/scripted.js";
import { reportDir } from "./report.js";
import type { Issue, Report, Severity } from "./types.js";

// ---------------------------------------------------------------- config

const score = z.number().min(0, "must be between 0 and 100").max(100, "must be between 0 and 100");
const httpUrl = z.url({ protocol: /^https?$/, error: "must be an absolute http(s) URL" });

export const JourneySchema = z.strictObject({
  name: z.string().trim().min(1, "must not be empty"),
  url: z.string().trim().min(1, "must not be empty"),
  task: z.string().trim().min(1, "must not be empty").max(500, "must be at most 500 characters"),
  minScore: score.optional(),
  /** Default true. Set to false for journeys known to be broken (still reported, never fail the build). */
  mustSucceed: z.boolean().optional(),
  note: z.string().optional(),
});

const RootSchema = z.strictObject({
  $schema: z.string().optional(),
  note: z.string().optional(),
  baseUrl: httpUrl.optional(),
  minScore: score.optional(),
  brain: z.enum(["claude", "scripted"], { error: 'must be "claude" or "scripted"' }).optional(),
  journeys: z.array(JourneySchema, { error: "must be a list of journeys" }).min(1, "must contain at least one journey"),
});

export const ConfigSchema = RootSchema.superRefine((cfg, ctx) => {
  const seen = new Set<string>();
  cfg.journeys.forEach((j, i) => {
    if (seen.has(j.name)) ctx.addIssue({ code: "custom", path: ["journeys", i, "name"], message: `duplicate journey name "${j.name}"` });
    seen.add(j.name);
  });
});

export type CiConfig = z.infer<typeof ConfigSchema>;
export type Journey = z.infer<typeof JourneySchema>;
export type BrainName = "claude" | "scripted";

/** Invalid config or command line: exit code 2. */
export class ConfigError extends Error {}

function formatPath(p: PropertyKey[]): string {
  return p.reduce<string>((acc, k) => (typeof k === "number" ? `${acc}[${k}]` : acc ? `${acc}.${String(k)}` : String(k)), "") || "(root)";
}

/** Validates a parsed config object; throws ConfigError listing every problem. */
export function parseConfig(raw: unknown, source = "config"): CiConfig {
  const result = ConfigSchema.safeParse(raw);
  if (result.success) return result.data;
  const lines = result.error.issues.map((i) => {
    const keys = i.code === "unrecognized_keys" ? ` (allowed: ${allowedKeys(i.path).join(", ")})` : "";
    return `  - ${formatPath(i.path)}: ${i.message}${keys}`;
  });
  throw new ConfigError(`Invalid ${source}:\n${lines.join("\n")}`);
}

function allowedKeys(p: PropertyKey[]): string[] {
  return Object.keys((p.length === 0 ? RootSchema : JourneySchema).shape);
}

export async function loadConfig(file: string): Promise<CiConfig> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    throw new ConfigError(`Cannot read config file ${file}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`${file} is not valid JSON: ${(err as Error).message}`);
  }
  return parseConfig(raw, file);
}

/**
 * Absolute http(s) URLs are used as-is. Relative URLs are appended to baseUrl's path, so with
 * baseUrl "https://preview.example.com/app" the journey URL "/book" becomes ".../app/book".
 */
export function resolveJourneyUrl(url: string, baseUrl?: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    let u: URL;
    try { u = new URL(url); } catch { throw new ConfigError(`Invalid URL "${url}"`); }
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new ConfigError(`Only http(s) URLs can be tested, got "${url}"`);
    return u.href;
  }
  if (!baseUrl) throw new ConfigError(`Journey URL "${url}" is relative but no baseUrl is set (in the config, with --base-url, or with --serve)`);
  const base = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
  return new URL(url.replace(/^\/+/, ""), base).href;
}

// ---------------------------------------------------------------- pass / fail

export interface Verdict {
  passed: boolean;
  /** Why the journey failed; empty when it passed. */
  reasons: string[];
}

/** Pure decision: does this report meet the journey's requirements? */
export function evaluateJourney(journey: Journey, report: Pick<Report, "status" | "score" | "error">, defaults: { minScore?: number } = {}): Verdict {
  const reasons: string[] = [];
  const mustSucceed = journey.mustSucceed ?? true;
  if (report.status === "error") {
    // A run that crashed (site down, browser error) tells nothing about accessibility: always a failure.
    reasons.push(`the test could not run: ${report.error ?? "unknown error"}`);
  } else if (mustSucceed && report.status !== "success") {
    reasons.push(`the task was not completed (status: ${report.status})`);
  }
  const minScore = journey.minScore ?? defaults.minScore;
  if (minScore !== undefined && (report.score === undefined || report.score < minScore)) {
    reasons.push(`score ${report.score ?? "-"} is below the minimum of ${minScore}`);
  }
  return { passed: reasons.length === 0, reasons };
}

export interface JourneyResult extends Verdict {
  journey: Journey;
  url: string;
  report: Report;
  minScore?: number;
  blockingIssues: Issue[];
}

const SEVERITY_ORDER: Severity[] = ["critical", "serious", "moderate", "minor"];

export function blockingIssues(report: Report): Issue[] {
  return report.issues
    .filter((i) => i.blocking)
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}

export const exitCodeFor = (results: Pick<JourneyResult, "passed">[]) => (results.every((r) => r.passed) ? 0 : 1);

// ---------------------------------------------------------------- output

/** Passed only because the journey is marked mustSucceed: false. */
const knownIssue = (r: JourneyResult) => r.passed && r.journey.mustSucceed === false && r.report.status !== "success";
const resultLabel = (r: JourneyResult) => (r.passed ? (knownIssue(r) ? "PASS (known issue)" : "PASS") : "FAIL");
const scoreLabel = (r: JourneyResult) => `${r.report.score ?? "-"}${r.minScore !== undefined ? ` (min ${r.minScore})` : ""}`;
const cell = (s: string) => s.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");

/** Markdown summary: one row per journey, then the failure reasons and report paths. */
export function renderMarkdown(results: JourneyResult[], brain: string): string {
  const passed = results.filter((r) => r.passed).length;
  const lines = [
    "## BlindSpot accessibility journeys",
    "",
    `**${passed}/${results.length} journeys passed** (agent: \`${brain}\`)`,
    "",
    "| Journey | Result | Status | Score | Blocking issues | Top blocking issue |",
    "|---|---|---|---|---|---|",
    ...results.map((r) =>
      `| ${cell(r.journey.name)} | ${r.passed ? "**PASS**" : "**FAIL**"}${knownIssue(r) ? " (known issue)" : ""} | ${r.report.status} | ${scoreLabel(r)} | ${r.blockingIssues.length} | ${cell(r.blockingIssues[0]?.title ?? "-")} |`),
    "",
  ];
  const failed = results.filter((r) => !r.passed);
  if (failed.length) {
    lines.push("### Failures", "");
    for (const r of failed) lines.push(`- **${cell(r.journey.name)}** (${r.url}): ${r.reasons.join("; ")}`);
    lines.push("");
  }
  lines.push("<details><summary>Reports</summary>", "");
  for (const r of results) lines.push(`- ${cell(r.journey.name)}: \`${path.relative(process.cwd(), path.join(reportDir(r.report.id), "report.json"))}\``);
  lines.push("", "</details>", "");
  return lines.join("\n");
}

/** Compact plain-text table for the terminal. */
export function renderTable(results: JourneyResult[]): string {
  const rows = [
    ["Journey", "Result", "Status", "Score", "Blocking", "Top blocking issue"],
    ...results.map((r) => [r.journey.name, resultLabel(r), r.report.status, scoreLabel(r), String(r.blockingIssues.length), r.blockingIssues[0]?.title ?? "-"]),
  ];
  const widths = rows[0].map((_, c) => Math.max(...rows.map((row) => row[c].length)));
  const fmt = (row: string[]) => row.map((v, c) => v.padEnd(widths[c])).join("  ").trimEnd();
  return [fmt(rows[0]), widths.map((w) => "-".repeat(w)).join("  "), ...rows.slice(1).map(fmt)].join("\n");
}

// ---------------------------------------------------------------- static demo server (--serve)

const DEMO_ROOT = fileURLToPath(new URL("../../demo-site/", import.meta.url));
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
};

/** Serves `root` (default demo-site/) on 127.0.0.1 and a free port. Refuses paths outside `root`. */
export async function startStaticServer(root = DEMO_ROOT): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const base = path.resolve(root);
  const server = http.createServer(async (req, res) => {
    const notFound = () => { res.writeHead(404, { "content-type": "text/plain" }); res.end("Not found"); };
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
    let rel: string;
    try {
      rel = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    } catch {
      res.writeHead(400); res.end(); return;
    }
    if (rel.includes("\0")) return notFound();
    let file = path.resolve(base, "." + path.posix.normalize("/" + rel));
    if (file !== base && !file.startsWith(base + path.sep)) return notFound();
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
      const data = await readFile(file);
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      notFound();
    }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

// ---------------------------------------------------------------- running

export function makeBrain(name: BrainName, url = ""): Brain {
  return name === "scripted" ? new ScriptedBrain(demoPlanFor(url)) : new ClaudeBrain();
}

export interface RunJourneysOptions {
  brain: BrainName;
  baseUrl?: string;
  /** For tests: build the brain for each journey. */
  brainFactory?: (name: BrainName) => Brain;
  log?: (line: string) => void;
}

/** Runs every journey sequentially (one browser at a time keeps CI runners happy). */
export async function runJourneys(config: CiConfig, opts: RunJourneysOptions): Promise<JourneyResult[]> {
  const log = opts.log ?? (() => {});
  const baseUrl = opts.baseUrl ?? config.baseUrl;
  // Resolve every URL first so a config mistake fails fast, before any browser starts.
  const urls = config.journeys.map((j) => resolveJourneyUrl(j.url, baseUrl));
  const results: JourneyResult[] = [];
  for (const [i, journey] of config.journeys.entries()) {
    const url = urls[i];
    log(`[${i + 1}/${config.journeys.length}] ${journey.name}\n      ${url}`);
    const startedAt = new Date().toISOString();
    let report: Report;
    try {
      report = await runTest({ url, task: journey.task, brain: opts.brainFactory ? opts.brainFactory(opts.brain) : makeBrain(opts.brain, url) });
    } catch (err) {
      report = { id: "none", url, task: journey.task, model: opts.brain, status: "error", summary: "", startedAt, steps: [], issues: [], error: (err as Error).message };
    }
    const minScore = journey.minScore ?? config.minScore;
    const verdict = evaluateJourney(journey, report, { minScore: config.minScore });
    const result: JourneyResult = { ...verdict, journey, url, report, minScore, blockingIssues: blockingIssues(report) };
    results.push(result);
    log(`      ${resultLabel(result)}: ${report.status}, score ${report.score ?? "-"}, ${result.blockingIssues.length} blocking issue(s)${verdict.reasons.length ? ` - ${verdict.reasons.join("; ")}` : ""}`);
  }
  return results;
}

// ---------------------------------------------------------------- command line

export const USAGE = `Usage: npx tsx src/ci.ts [config] [--brain scripted|claude] [--serve] [--base-url <url>] [--summary <file>]

  config            path to the config file (default: blindspot.config.json)
  --brain           agent to use (default: the config's "brain", else claude)
  --serve           serve the bundled demo-site/ on a free port and use it as baseUrl
  --base-url        base URL for relative journey URLs (overrides the config's baseUrl)
  --summary         where to write the Markdown summary (default: blindspot-summary.md)

Exit code: 0 all journeys passed, 1 at least one failed, 2 invalid config or arguments.`;

export interface CliArgs {
  config: string;
  brain?: BrainName;
  serve: boolean;
  baseUrl?: string;
  summary: string;
  help: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { config: "blindspot.config.json", serve: false, summary: "blindspot-summary.md", help: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].startsWith("--") ? argv[i].split(/=(.*)/s, 2) : [argv[i], undefined];
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined || v.startsWith("--")) throw new ConfigError(`${flag} needs a value\n\n${USAGE}`);
      return v;
    };
    switch (flag) {
      case "--brain": {
        const v = value();
        if (v !== "claude" && v !== "scripted") throw new ConfigError(`--brain must be "claude" or "scripted", got "${v}"`);
        args.brain = v;
        break;
      }
      case "--serve": args.serve = true; break;
      case "--base-url": args.baseUrl = value(); break;
      case "--summary": args.summary = value(); break;
      case "--help": case "-h": args.help = true; break;
      default:
        if (flag.startsWith("-")) throw new ConfigError(`Unknown option ${flag}\n\n${USAGE}`);
        positional.push(flag);
    }
  }
  if (positional.length > 1) throw new ConfigError(`Expected at most one config file, got: ${positional.join(" ")}\n\n${USAGE}`);
  if (positional[0]) args.config = positional[0];
  if (args.serve && args.baseUrl) throw new ConfigError("Use either --serve or --base-url, not both");
  if (args.baseUrl && !/^https?:\/\//i.test(args.baseUrl)) throw new ConfigError(`--base-url must be an absolute http(s) URL, got "${args.baseUrl}"`);
  return args;
}

export interface CiRunOptions {
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  error?: (line: string) => void;
  brainFactory?: (name: BrainName) => Brain;
}

/** The whole CI command. Returns the process exit code. */
export async function runCi(argv: string[], opts: CiRunOptions = {}): Promise<number> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? console.log;
  const error = opts.error ?? console.error;
  let server: Awaited<ReturnType<typeof startStaticServer>> | undefined;
  try {
    const args = parseArgs(argv);
    if (args.help) { log(USAGE); return 0; }
    const config = await loadConfig(args.config);
    const brain: BrainName = args.brain ?? config.brain ?? "claude";
    if (brain === "claude" && !env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN && !opts.brainFactory) {
      throw new ConfigError("The claude brain needs ANTHROPIC_API_KEY (in CI, from a repository secret). Use --brain scripted for the bundled demo.");
    }
    let baseUrl = args.baseUrl;
    if (args.serve) {
      server = await startStaticServer();
      baseUrl = server.baseUrl;
      log(`Serving demo-site/ at ${baseUrl}`);
    }
    log(`BlindSpot CI: ${config.journeys.length} journey(s), agent: ${brain}\n`);
    const results = await runJourneys(config, { brain, baseUrl, brainFactory: opts.brainFactory, log });

    const markdown = renderMarkdown(results, brain);
    log(`\n${renderTable(results)}\n`);
    await writeFile(args.summary, markdown);
    log(`Summary written to ${args.summary}`);
    if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, markdown + "\n");

    const code = exitCodeFor(results);
    log(code === 0 ? "All journeys passed." : `${results.filter((r) => !r.passed).length} journey(s) failed.`);
    return code;
  } catch (err) {
    if (err instanceof ConfigError) { error(err.message); return 2; }
    throw err;
  } finally {
    await server?.close();
  }
}
