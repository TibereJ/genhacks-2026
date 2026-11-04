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
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { reportToMarkdown } from "./core/export.js";
import type { Report } from "./core/types.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export const STATIC_MARKER = '<meta name="blindspot-static" content="1" />';

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

export async function buildStatic(outDir: string, options: BuildOptions = {}): Promise<BuildResult> {
  const root = path.resolve(options.root ?? ROOT);
  const out = path.resolve(outDir);
  const reportsDir = path.resolve(options.reportsDir ?? path.join(root, "examples", "reports"));
  // The output folder is wiped first: never let that be the repository or one of its parents.
  if (out === root || root.startsWith(out + path.sep) || out === path.parse(out).root) {
    throw new Error(`Refusing to build into ${out}: it contains the repository`);
  }
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const outDir = process.argv[2] ?? "dist-static";
  const { outDir: out, reports } = await buildStatic(outDir);
  console.log(`Static demo built in ${out} with ${reports.length} example report${reports.length === 1 ? "" : "s"}.`);
}
