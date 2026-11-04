// Data access. With `?fixture=1` in the page URL everything is served from
// fixtures/sample-report.json so the UI can be built and demoed without the server.
//   #/report/sample       finished fixture report
//   #/report/sample-live  the same report replayed as a live run (one new step every 1.5 s)
//
// Static mode (the read-only GitHub Pages demo built by src/build-static.ts, which adds
// <meta name="blindspot-static" content="1">): no server, every URL is relative to the page.
//   data/reports.json                   the run list (same shape as GET /api/reports)
//   data/reports/<id>/report.json       a report
//   data/reports/<id>/report.md         its Markdown export
//   data/reports/<id>/step-N.png        screenshots

const params = new URLSearchParams(location.search);
export const FIXTURE_MODE = params.get("fixture") === "1";
export const STATIC_MODE =
  !FIXTURE_MODE && document.querySelector('meta[name="blindspot-static"]')?.getAttribute("content") === "1";

/** Base URL of step screenshots, for screenshotUrl() in format.js. */
export const SCREENSHOT_BASE = STATIC_MODE ? "data/reports/" : "/reports/";

const relative = (path) => new URL(path, document.baseURI).href;

const FIXTURE_URL = new URL("fixtures/sample-report.json", document.baseURI).href;
const LIVE_STEP_MS = 1500;
let fixtureCache = null;
let liveStartedAt = null;

async function getJson(url, options) {
  const res = await fetch(url, { headers: { Accept: "application/json" }, ...options });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body && typeof body.error === "string") message = body.error;
    } catch {
      /* body was not JSON */
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function loadFixture() {
  fixtureCache ??= await getJson(FIXTURE_URL);
  return structuredClone(fixtureCache);
}

/** Replay the fixture as if the agent were still running. */
function liveSlice(report) {
  liveStartedAt ??= Date.now();
  const shown = Math.floor((Date.now() - liveStartedAt) / LIVE_STEP_MS) + 1;
  if (shown >= report.steps.length + 1) return { ...report, id: "sample-live" };
  const steps = report.steps.slice(0, shown);
  const seen = new Set(steps.map((s) => s.index));
  return {
    ...report,
    id: "sample-live",
    status: "running",
    summary: "",
    score: undefined,
    finishedAt: undefined,
    steps,
    issues: report.issues.filter((i) => i.source === "agent" && seen.has(i.stepIndex) && i.stepIndex < steps.at(-1).index),
  };
}

export async function listReports() {
  if (FIXTURE_MODE) {
    const r = await loadFixture();
    return [{ id: r.id, url: r.url, task: r.task, status: r.status, score: r.score, startedAt: r.startedAt }];
  }
  if (STATIC_MODE) return getJson(relative("data/reports.json"));
  return getJson("/api/reports");
}

export async function getReport(id) {
  if (FIXTURE_MODE) {
    const r = await loadFixture();
    return id === "sample-live" ? liveSlice(r) : r;
  }
  if (STATIC_MODE) return getJson(relative(`data/reports/${encodeURIComponent(id)}/report.json`));
  return getJson(`/api/reports/${encodeURIComponent(id)}`);
}

/**
 * URL of the Markdown export (served as a download). Not available in fixture mode. In static mode it is
 * the report.md file written at build time by src/build-static.ts.
 */
export function markdownUrl(id) {
  if (STATIC_MODE) return `data/reports/${encodeURIComponent(id)}/report.md`;
  return `/api/reports/${encodeURIComponent(id)}/markdown`;
}

/** The report as Markdown, ready to paste into a GitHub issue. */
export async function getMarkdown(id) {
  const res = await fetch(markdownUrl(id), { headers: { Accept: "text/markdown" } });
  if (!res.ok) {
    const err = new Error(`${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return res.text();
}

export async function startRun({ url, task, brain }) {
  if (FIXTURE_MODE) {
    liveStartedAt = null;
    return { id: "sample-live" };
  }
  if (STATIC_MODE) throw new Error("This read-only demo cannot run tests. Run BlindSpot locally to test your own site.");
  return getJson("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ url, task, brain }),
  });
}
