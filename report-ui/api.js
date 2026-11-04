// Data access. With `?fixture=1` in the page URL everything is served from
// fixtures/sample-report.json so the UI can be built and demoed without the server.
//   #/report/sample       finished fixture report
//   #/report/sample-live  the same report replayed as a live run (one new step every 1.5 s)

const params = new URLSearchParams(location.search);
export const FIXTURE_MODE = params.get("fixture") === "1";

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
  return getJson("/api/reports");
}

export async function getReport(id) {
  if (FIXTURE_MODE) {
    const r = await loadFixture();
    return id === "sample-live" ? liveSlice(r) : r;
  }
  return getJson(`/api/reports/${encodeURIComponent(id)}`);
}

export async function startRun({ url, task, brain }) {
  if (FIXTURE_MODE) {
    liveStartedAt = null;
    return { id: "sample-live" };
  }
  return getJson("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ url, task, brain }),
  });
}
