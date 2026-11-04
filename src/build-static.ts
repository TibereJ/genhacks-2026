// Builds the read-only static demo (GitHub Pages): the report UI, the demo sites and the example reports,
// with no server. Usage: npx tsx src/build-static.ts [outDir]   (default dist-static/)
//
// Layout of the output (every URL the UI uses is relative, so it works under a sub-path like /genhacks-2026/):
//   index.html, *.js, style.css       report-ui/ with <meta name="blindspot-static" content="1"> injected
//   demo/                             demo-site/ (the clinic and the shop, bad and fixed)
//   data/reports.json                 run list, same shape as GET /api/reports, newest first
//   data/reports/<id>/report.json     each report, untouched
//   data/reports/<id>/report.md       its Markdown export (reportToMarkdown)
//   data/reports/<id>/step-N.png      screenshots
import { realpathSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reportToMarkdown } from "./core/export.js";
import type { Report } from "./core/types.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export const STATIC_MARKER = '<meta name="blindspot-static" content="1" />';

/** Written at the top of every build. A non-empty output folder is only wiped when it has this file. */
export const BUILD_MARKER_FILE = ".blindspot-static";

/** Repository folders the output folder may never be, contain, or sit inside. */
export const PROTECTED_DIRS = ["src", "report-ui", "demo-site", "examples", "tests", "docs", "node_modules", ".git", ".github"];

/** report-ui/ files that only serve development and tests. */
const UI_EXCLUDED = new Set(["fixtures"]);
const UI_EXCLUDED_EXT = new Set([".ts"]); // format.d.ts

export type RunSummary = Pick<Report, "id" | "url" | "task" | "status" | "score" | "startedAt">;

export interface BuildOptions {
  /** Where the example reports are read from. Default examples/reports/. */
  reportsDir?: string;
  /** Repository root (report-ui/ and demo-site/ are read from it). */
  root?: string;
}

export interface BuildResult {
  outDir: string;
  reports: RunSummary[];
}

/** Add the static marker to report-ui/index.html. */
export function injectStaticMarker(html: string): string {
  if (html.includes('name="blindspot-static"')) return html;
  const charset = /<meta charset="utf-8"\s*\/?>/i;
  if (!charset.test(html)) throw new Error('report-ui/index.html has no <meta charset="utf-8"> to put the static marker after');
  return html.replace(charset, (m) => `${m}\n    ${STATIC_MARKER}`);
}

type Platform = NodeJS.Platform;

const pathApi = (platform: Platform) => (platform === "win32" ? path.win32 : path.posix);

/** A path in the form used to compare paths: resolved, and lowercase on Windows (case-insensitive file system). */
export function comparablePath(p: string, platform: Platform = process.platform): string {
  const resolved = pathApi(platform).resolve(p);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** True when `child` is `parent` or inside it. */
export function isWithin(child: string, parent: string, platform: Platform = process.platform): boolean {
  const sep = pathApi(platform).sep;
  const c = comparablePath(child, platform);
  const p = comparablePath(parent, platform);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

/**
 * Throws unless `out` is a folder strictly inside the repository `root` that does not overlap (as the same folder,
 * a parent or a child) any of its source folders (PROTECTED_DIRS) or `extra` folders. The output folder is wiped
 * before every build, so this is what keeps `build-static.ts src` from deleting src/.
 */
export function checkOutDir(out: string, root: string, extra: string[] = [], platform: Platform = process.platform): void {
  const api = pathApi(platform);
  const refuse = (why: string) => {
    throw new Error(`Refusing to build into ${out}: ${why}. Pick a new folder inside the repository, such as dist-static/.`);
  };
  if (!isWithin(out, root, platform) || comparablePath(out, platform) === comparablePath(root, platform)) {
    refuse(`it must be a folder inside the repository (${root})`);
  }
  for (const dir of [...PROTECTED_DIRS.map((d) => api.join(root, d)), ...extra]) {
    if (isWithin(out, dir, platform) || isWithin(dir, out, platform)) refuse(`it overlaps ${dir}`);
  }
}

/** Resolves symlinks in `p`, or in its nearest existing parent when it does not exist yet. */
function realPath(p: string): string {
  const abs = path.resolve(p);
  try {
    return realpathSync.native(abs);
  } catch {
    const parent = path.dirname(abs);
    return parent === abs ? abs : path.join(realPath(parent), path.basename(abs));
  }
}

/** Empties the output folder, refusing a non-empty folder that a previous build did not write. */
async function prepareOutDir(out: string): Promise<void> {
  const info = await stat(out).catch(() => undefined);
  if (info) {
    if (!info.isDirectory()) throw new Error(`Refusing to build into ${out}: it is a file, not a folder.`);
    const entries = await readdir(out);
    if (entries.length && !entries.includes(BUILD_MARKER_FILE)) {
      throw new Error(
        `Refusing to build into ${out}: it is not empty and was not written by a previous static build (no ${BUILD_MARKER_FILE} file). ` +
          "Delete it yourself or pick another folder.",
      );
    }
    await rm(out, { recursive: true, force: true });
  }
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, BUILD_MARKER_FILE), "Written by src/build-static.ts. The next static build may delete this folder.\n");
}

/** True when this file is the script node was started with (paths compared case-insensitively on Windows). */
export function isMainModule(moduleUrl: string, argv1: string | undefined, platform: Platform = process.platform): boolean {
  if (!argv1) return false;
  const real = (p: string) => {
    try { return realpathSync.native(p); } catch { return p; }
  };
  const modulePath = fileURLToPath(moduleUrl, { windows: platform === "win32" });
  return comparablePath(real(modulePath), platform) === comparablePath(real(pathApi(platform).resolve(argv1)), platform);
}

export async function buildStatic(outDir: string, options: BuildOptions = {}): Promise<BuildResult> {
  const root = path.resolve(options.root ?? ROOT);
  const out = path.resolve(outDir);
  const reportsDir = path.resolve(options.reportsDir ?? path.join(root, "examples", "reports"));
  checkOutDir(realPath(out), realPath(root), [realPath(reportsDir)]);
  await prepareOutDir(out);

  // 1. The report UI, with the static marker.
  const uiDir = path.join(root, "report-ui");
  await cp(uiDir, out, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(uiDir, src);
      if (rel === "") return true;
      if (UI_EXCLUDED.has(rel.split(path.sep)[0])) return false;
      return !UI_EXCLUDED_EXT.has(path.extname(src));
    },
  });
  const indexPath = path.join(out, "index.html");
  await writeFile(indexPath, injectStaticMarker(await readFile(indexPath, "utf8")));

  // 2. The demo sites, at demo/ like the server serves them at /demo/.
  await cp(path.join(root, "demo-site"), path.join(out, "demo"), { recursive: true });

  // 3. The example reports and their Markdown export.
  const reports: RunSummary[] = [];
  let ids: string[] = [];
  try {
    ids = (await readdir(reportsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    throw new Error(`No example reports found in ${reportsDir}`);
  }
  for (const id of ids.sort()) {
    if (!/^[a-z0-9-]+$/i.test(id)) continue;
    const src = path.join(reportsDir, id);
    let raw: string;
    try {
      raw = await readFile(path.join(src, "report.json"), "utf8");
    } catch {
      continue; // not a report folder
    }
    const report = JSON.parse(raw) as Report;
    if (report.id !== id) throw new Error(`Report ${src} has id "${report.id}", expected "${id}"`);
    if (report.status === "running") {
      throw new Error(`Report ${src} is still "running": wait for it to finish (or delete it) before publishing the static demo`);
    }
    const dest = path.join(out, "data", "reports", id);
    await mkdir(dest, { recursive: true });
    await writeFile(path.join(dest, "report.json"), raw);
    for (const file of await readdir(src)) {
      if (/^step-\d+\.png$/.test(file)) await cp(path.join(src, file), path.join(dest, file));
    }
    await writeFile(path.join(dest, "report.md"), reportToMarkdown(report));
    const { url, task, status, score, startedAt } = report;
    reports.push({ id, url, task, status, score, startedAt });
  }
  reports.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  await writeFile(path.join(out, "data", "reports.json"), JSON.stringify(reports, null, 2) + "\n");

  // GitHub Pages: serve files as they are (no Jekyll processing).
  await writeFile(path.join(out, ".nojekyll"), "");
  return { outDir: out, reports };
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const outDir = process.argv[2] ?? "dist-static";
  try {
    const { outDir: out, reports } = await buildStatic(outDir);
    console.log(`Static demo built in ${out} with ${reports.length} example report${reports.length === 1 ? "" : "s"}.`);
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  }
}
