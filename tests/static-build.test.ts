// The read-only static demo (src/build-static.ts, published to GitHub Pages by .github/workflows/pages.yml):
// build it into a temp dir, check the files, then serve it under a sub-path like GitHub Pages does
// (https://tiberej.github.io/genhacks-2026/) and click through it in Chromium.
// Set BLINDSPOT_STATIC_SHOTS=<dir> to also save screenshots of the home page and a report there.
import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { buildStatic, injectStaticMarker, type RunSummary } from "../src/build-static.js";

const SUB_PATH = "/genhacks-2026/";
const BAD_CLINIC = "20261104164439-947unj";
const FIXED_CLINIC = "20261104164505-l2g8gy";
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

let outDir: string;
let reports: RunSummary[];
let server: Server;
let browser: Browser;
let origin: string;

beforeAll(async () => {
  outDir = await mkdtemp(path.join(os.tmpdir(), "blindspot-static-"));
  ({ reports } = await buildStatic(outDir));

  // A tiny GitHub Pages: the build is only served under /genhacks-2026/, everything else is a 404.
  server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    if (pathname === SUB_PATH.slice(0, -1)) {
      res.writeHead(301, { location: SUB_PATH }).end();
      return;
    }
    if (!pathname.startsWith(SUB_PATH)) {
      res.writeHead(404).end();
      return;
    }
    let file = path.resolve(outDir, "." + pathname.slice(SUB_PATH.length - 1));
    if (file !== outDir && !file.startsWith(outDir + path.sep)) {
      res.writeHead(404).end();
      return;
    }
    if (pathname.endsWith("/")) file = path.join(file, "index.html");
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no server address");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
  if (outDir) await rm(outDir, { recursive: true, force: true });
});

describe("static build files", () => {
  it("contains the UI with the static marker, the demo sites and the example reports", async () => {
    const index = await readFile(path.join(outDir, "index.html"), "utf8");
    expect(index).toContain('<meta name="blindspot-static" content="1" />');
    expect(existsSync(path.join(outDir, "app.js"))).toBe(true);
    expect(existsSync(path.join(outDir, "fixtures"))).toBe(false);
    expect(existsSync(path.join(outDir, "format.d.ts"))).toBe(false);
    expect(existsSync(path.join(outDir, "demo", "bad", "book.html"))).toBe(true);
    expect(existsSync(path.join(outDir, "demo", "shop", "fixed", "checkout.html"))).toBe(true);
    expect(existsSync(path.join(outDir, "data", "reports", BAD_CLINIC, "step-0.png"))).toBe(true);
    expect(existsSync(path.join(outDir, ".nojekyll"))).toBe(true);

    const md = await readFile(path.join(outDir, "data", "reports", BAD_CLINIC, "report.md"), "utf8");
    expect(md).toMatch(/^# BlindSpot: Blind user blocked, score 0\/100/);
    expect(md).toContain("Time slots cannot be selected");

    // Only report.json, report.md and screenshots are published per report.
    for (const r of reports) {
      const files = await readdir(path.join(outDir, "data", "reports", r.id));
      expect(files.every((f) => f === "report.json" || f === "report.md" || /^step-\d+\.png$/.test(f))).toBe(true);
    }
  });

  it("writes the run list like GET /api/reports, newest first", async () => {
    const list = JSON.parse(await readFile(path.join(outDir, "data", "reports.json"), "utf8")) as RunSummary[];
    expect(list).toHaveLength(4);
    expect(list).toEqual(reports);
    expect(list.map((r) => r.startedAt)).toEqual([...list.map((r) => r.startedAt)].sort().reverse());
    for (const r of list) expect(Object.keys(r).sort()).toEqual(["id", "score", "startedAt", "status", "task", "url"]);
    // Report data is published untouched.
    const original = await readFile(path.resolve("examples/reports", BAD_CLINIC, "report.json"), "utf8");
    expect(await readFile(path.join(outDir, "data", "reports", BAD_CLINIC, "report.json"), "utf8")).toBe(original);
  });

  it("uses no root-absolute URLs outside the server-mode branches", async () => {
    const index = await readFile(path.join(outDir, "index.html"), "utf8");
    expect(index).not.toMatch(/(href|src)="\/(?!\/)/);
    const absolute = /["'`]\/(api|reports|demo)\//;
    for (const file of (await readdir(outDir)).filter((f) => f.endsWith(".js"))) {
      const lines = (await readFile(path.join(outDir, file), "utf8")).split("\n").filter((l) => absolute.test(l));
      if (file === "api.js") {
        // Every server URL in api.js sits after the static-mode early return of the same function.
        const src = await readFile(path.join(outDir, file), "utf8");
        for (const fn of ["listReports", "getReport", "markdownUrl", "startRun"]) {
          const body = src.slice(src.indexOf(`function ${fn}(`));
          const staticAt = body.indexOf("STATIC_MODE");
          const serverAt = body.search(absolute);
          expect(staticAt, fn).toBeGreaterThan(-1);
          expect(staticAt, fn).toBeLessThan(serverAt);
        }
      } else if (file === "format.js") {
        expect(lines.join("\n")).toMatch(/base = "\/reports\/"/); // server default, overridden by SCREENSHOT_BASE
      } else if (file === "home.js") {
        // The presets' server paths; the static notice strips the leading slash.
        expect(lines.every((l) => /url: "\/demo\//.test(l))).toBe(true);
      } else {
        expect(lines, file).toEqual([]);
      }
    }
  });

  it("injects the marker once, after the charset", () => {
    const html = '<html><head>\n    <meta charset="utf-8" />\n</head></html>';
    const once = injectStaticMarker(html);
    expect(once).toMatch(/<meta charset="utf-8" \/>\n\s*<meta name="blindspot-static" content="1" \/>/);
    expect(injectStaticMarker(once)).toBe(once);
    expect(() => injectStaticMarker("<html></html>")).toThrow();
  });

  it("refuses to wipe the repository", async () => {
    // A throwaway "repository", so a broken guard could only delete a temp dir.
    const parent = await mkdtemp(path.join(os.tmpdir(), "blindspot-guard-"));
    const fakeRoot = path.join(parent, "repo");
    await mkdir(fakeRoot);
    try {
      await expect(buildStatic(fakeRoot, { root: fakeRoot })).rejects.toThrow(/Refusing/);
      await expect(buildStatic(parent, { root: fakeRoot })).rejects.toThrow(/Refusing/);
      expect(existsSync(fakeRoot)).toBe(true);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

describe("static demo in a browser, under a sub-path", () => {
  it("lists the runs, opens a report, exports Markdown and compares, with no errors or failed requests", async () => {
    const base = origin + SUB_PATH;
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const problems: string[] = [];
    const requested: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("requestfailed", (r) => problems.push(`failed: ${r.url()} ${r.failure()?.errorText}`));
    page.on("response", (r) => { if (r.status() >= 400) problems.push(`${r.status()}: ${r.url()}`); });
    page.on("request", (r) => requested.push(r.url()));
    const shots = process.env.BLINDSPOT_STATIC_SHOTS;
    if (shots) await mkdir(shots, { recursive: true });

    // Home: the 4 example runs, the read-only notice instead of the form, presets linking to the demo sites.
    await page.goto(base);
    await page.locator(".run-row").nth(3).waitFor();
    expect(await page.locator(".run-row").count()).toBe(4);
    expect(await page.locator("#run-url").count()).toBe(0);
    await expect(page.locator(".static-notice").innerText()).resolves.toContain(
      "This is a read-only demo with real example runs. Run BlindSpot locally to test your own site",
    );
    expect(await page.locator(".static-notice a", { hasText: "quick start" }).getAttribute("href")).toBe(
      "https://github.com/TibereJ/genhacks-2026#quick-start",
    );
    const presetHrefs = await page.locator(".static-notice a.btn-preset").evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).href));
    expect(presetHrefs).toEqual([
      `${base}demo/bad/index.html`,
      `${base}demo/fixed/index.html`,
      `${base}demo/shop/bad/index.html`,
      `${base}demo/shop/fixed/index.html`,
    ]);
    for (const href of presetHrefs) expect((await context.request.get(href)).status()).toBe(200);
    expect((await context.request.get(`${base}demo/bad/book.html`)).status()).toBe(200);
    if (shots) await page.screenshot({ path: path.join(shots, "home.png"), fullPage: true });

    // A report: steps, issues, a screenshot, the link to the shipped demo site.
    await page.locator(`a.run[data-id="${BAD_CLINIC}"]`).click();
    await page.waitForURL(`**/#/report/${BAD_CLINIC}`);
    await page.locator("li.step").nth(10).waitFor();
    expect(await page.locator("li.step").count()).toBe(11);
    expect(await page.locator("li.issue").count()).toBe(15);
    await expect(page.locator("#page-title").innerText()).resolves.toContain("Book an appointment with Dr. Lee");
    expect(await page.locator(".head-url a").evaluate((a) => (a as HTMLAnchorElement).href)).toBe(`${base}demo/bad/index.html`);
    const shot = page.locator(".shot-frame img").first();
    await shot.scrollIntoViewIfNeeded();
    await page.waitForFunction((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0, await shot.elementHandle());
    expect(await shot.getAttribute("src")).toBe(`data/reports/${BAD_CLINIC}/step-0.png`);
    expect(await page.locator(".btn-listen").count()).toBeGreaterThan(0);
    if (shots) {
      await page.locator("li.step").first().screenshot({ path: path.join(shots, "report-step.png") });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(shots, "report.png") });
    }

    // Markdown export: the pre-built report.md.
    const download = page.locator("a[download]", { hasText: "Download Markdown" });
    expect(await download.getAttribute("href")).toBe(`data/reports/${BAD_CLINIC}/report.md`);
    const md = await page.evaluate(async (href) => (await fetch(href)).text(), (await download.getAttribute("href"))!);
    expect(md).toMatch(/^# BlindSpot: Blind user blocked/);

    // Compare with the fixed clinic, through the report toolbar.
    await page.locator("#compare-with").selectOption(FIXED_CLINIC);
    await page.locator(".action-compare button", { hasText: "Compare" }).click();
    await page.waitForURL(`**/#/compare/${BAD_CLINIC}/${FIXED_CLINIC}`);
    await page.locator(".cmp-delta-num").waitFor();
    expect(await page.locator(".cmp-delta-num").innerText()).toBe("+100");
    await expect(page.locator("#cmp-fixed-title").innerText()).resolves.toContain("Fixed");
    if (shots) await page.screenshot({ path: path.join(shots, "compare.png") });

    expect(problems).toEqual([]);
    // Every request stayed under the sub-path (no /api/ or /reports/ at the site root).
    expect(requested.filter((u) => !u.startsWith("data:") && !u.startsWith(base))).toEqual([]);
    expect(requested.some((u) => u.includes("/api/"))).toBe(false);
    await context.close();
  }, 60_000);
});
