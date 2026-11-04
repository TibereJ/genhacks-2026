// Pure helpers for the report UI: no DOM access here, so they can be unit tested in Node.

export const SEVERITY_ORDER = ["critical", "serious", "moderate", "minor"];

export const STATUS_LABELS = {
  running: "Running",
  success: "Task completed",
  blocked: "Blind user blocked",
  step_limit: "Step limit reached",
  error: "Error",
};

/** Human label for a run status. Unknown statuses are shown as-is. */
export function statusLabel(status) {
  return STATUS_LABELS[status] ?? String(status ?? "Unknown");
}

/** Visual tone used for a status badge: good | bad | warn | info. */
export function statusTone(status) {
  switch (status) {
    case "success":
      return "good";
    case "blocked":
    case "error":
      return "bad";
    case "step_limit":
      return "warn";
    default:
      return "info";
  }
}

/** Tone for a 0-100 score. */
export function scoreTone(score) {
  if (typeof score !== "number" || Number.isNaN(score)) return "none";
  if (score >= 90) return "good";
  if (score >= 50) return "warn";
  return "bad";
}

/** Short verdict sentence under the score. */
export function scoreVerdict(score) {
  const tone = scoreTone(score);
  if (tone === "good") return "Usable with a screen reader";
  if (tone === "warn") return "Usable, with friction";
  if (tone === "bad") return "Hard or impossible to use";
  return "Score pending";
}

/** Issues sorted: blocking first, then by severity, then by step. Does not mutate the input. */
export function sortIssues(issues) {
  const rank = (s) => {
    const i = SEVERITY_ORDER.indexOf(s);
    return i === -1 ? SEVERITY_ORDER.length : i;
  };
  return [...(issues ?? [])].sort(
    (a, b) =>
      Number(Boolean(b.blocking)) - Number(Boolean(a.blocking)) ||
      rank(a.severity) - rank(b.severity) ||
      (a.stepIndex ?? 0) - (b.stepIndex ?? 0),
  );
}

/** Count issues per severity, e.g. { critical: 1, serious: 3, moderate: 2, minor: 0 }. */
export function countBySeverity(issues) {
  const counts = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, 0]));
  for (const issue of issues ?? []) {
    if (issue.severity in counts) counts[issue.severity] += 1;
  }
  return counts;
}

const KEY_NAMES = {
  enter: "Enter",
  tab: "Tab",
  escape: "Escape",
  esc: "Escape",
  space: "Space",
  " ": "Space",
  arrowdown: "Arrow Down",
  arrowup: "Arrow Up",
  arrowleft: "Arrow Left",
  arrowright: "Arrow Right",
  backspace: "Backspace",
};

function keyName(value) {
  if (!value) return "a key";
  return KEY_NAMES[String(value).toLowerCase()] ?? String(value);
}

/**
 * Describe an agent action as sentence segments, so the UI can style element names
 * (and flag empty ones) without building HTML strings.
 * A segment is either { text } or { el: { role, name } } or { value }.
 */
export function actionSegments(action) {
  const a = action ?? {};
  const el = a.target ? [{ el: { role: a.target.role, name: a.target.name ?? "" } }] : [];
  switch (a.type) {
    case "click":
      return [{ text: "Clicked " }, ...(el.length ? el : [{ text: "an element" }])];
    case "type":
      return [
        { text: "Typed " },
        { value: a.value ?? "" },
        ...(el.length ? [{ text: " into " }, ...el] : []),
      ];
    case "select":
      return [
        { text: "Selected " },
        { value: a.value ?? "" },
        ...(el.length ? [{ text: " in " }, ...el] : []),
      ];
    case "press":
      return [
        { text: `Pressed ${keyName(a.value)}` },
        ...(el.length ? [{ text: " on " }, ...el] : []),
      ];
    case "back":
      return [{ text: "Went back to the previous page" }];
    case "finish":
      return [{ text: "Finished" }];
    default:
      return [{ text: a.type ? `Action: ${a.type}` : "Unknown action" }];
  }
}

/** Plain-text version of actionSegments, e.g. `Clicked button "Book appointment"`. */
export function actionText(action) {
  return actionSegments(action)
    .map((seg) => {
      if ("el" in seg) return `${seg.el.role} "${seg.el.name}"`;
      if ("value" in seg) return `"${seg.value}"`;
      return seg.text;
    })
    .join("");
}

/** Remove the short-lived `[12]` element id markers from a transcript. */
export function stripIds(text) {
  return String(text ?? "").replace(/\[\d+\]\s?/g, "");
}

/**
 * Turn a `heard` transcript into the sentences a screen reader would speak, one per line:
 * id markers removed, `role "name"` read as "name, role", empty names silent (only the role is read).
 * Returns an array so the speech can be queued in short utterances.
 */
export function toSpeech(heard) {
  return stripIds(heard)
    .split("\n")
    .map((line) =>
      line
        .trim()
        // value "x" -> value x
        .replace(/\bvalue "([^"]*)"/g, (_, v) => `value ${v}`)
        // role "" -> role (a screen reader announces only the role)
        .replace(/\b([a-z][a-z0-9 ]*?) ""/g, "$1")
        // text "x" -> x
        .replace(/\btext "([^"]*)"/g, "$1")
        // role "name" -> name, role
        .replace(/\b([a-z][a-z0-9 ]*?) "([^"]*)"/g, "$2, $1")
        .replace(/\s{2,}/g, ". ")
        .replace(/"/g, "")
        .trim(),
    )
    .filter(Boolean)
    .map((line) => (/[.!?:]$/.test(line) ? line : `${line}.`));
}

/**
 * Split a transcript into lines and inline tokens for display.
 * Token kinds: "id" ([12]), "empty" ("" or "(no description)"), "text".
 */
export function tokenizeTranscript(heard) {
  const re = /(\[\d+\])|(""|\(no description\))/g;
  return String(heard ?? "")
    .split("\n")
    .map((line) => {
      const tokens = [];
      let last = 0;
      for (const m of line.matchAll(re)) {
        if (m.index > last) tokens.push({ kind: "text", text: line.slice(last, m.index) });
        tokens.push({ kind: m[1] ? "id" : "empty", text: m[0] });
        last = m.index + m[0].length;
      }
      if (last < line.length) tokens.push({ kind: "text", text: line.slice(last) });
      const idMatch = line.match(/\[(\d+)\]/);
      return { tokens, ids: [...line.matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1])), firstId: idMatch ? Number(idMatch[1]) : null };
    });
}

/** "2 min ago", "yesterday"… Falls back to a date string. */
export function relativeTime(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = (t - now) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), "day");
  return new Date(t).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });
}

/** Duration between two ISO dates, e.g. "1 min 12 s". */
export function duration(startIso, endIso) {
  const a = Date.parse(startIso);
  const b = Date.parse(endIso);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return "";
  const s = Math.round((b - a) / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

/**
 * URL of a step screenshot: served by the API under /reports/ by default, or under another base
 * (the static demo build passes the relative "data/reports/").
 */
export function screenshotUrl(reportId, file, base = "/reports/") {
  if (!file) return null;
  const path = String(file)
    .split("/")
    .filter((p) => p && p !== "." && p !== "..")
    .map(encodeURIComponent)
    .join("/");
  return `${base}${encodeURIComponent(reportId)}/${path}`;
}

/**
 * For the static demo build: a report URL that pointed at a local BlindSpot server's demo site
 * (http://localhost:3000/demo/bad/index.html) becomes a relative link to the copy shipped with the
 * build (demo/bad/index.html). Any other URL returns null.
 */
export function demoSiteHref(url) {
  let u;
  try {
    u = new URL(String(url ?? ""), "http://localhost");
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return null;
  if (!u.pathname.startsWith("/demo/")) return null;
  return `demo/${u.pathname.slice("/demo/".length)}${u.search}${u.hash}`;
}

/** Display a URL without the protocol noise. */
export function prettyUrl(url) {
  try {
    const u = new URL(url, "http://x.invalid");
    if (u.host === "x.invalid") return String(url);
    return `${u.host}${u.pathname}${u.search}`;
  } catch {
    return String(url ?? "");
  }
}

// ---------------------------------------------------------------- before / after comparison

/** Issues are the "same" across two runs when title, element role and element name match. */
export function issueMatchKey(issue) {
  const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return JSON.stringify([norm(issue?.title), norm(issue?.element?.role), norm(issue?.element?.name)]);
}

/**
 * Split issues into fixed (only before), still present (in both) and added (only after).
 * Duplicates are matched one to one. Still-present entries carry both versions.
 * Each list is sorted like the report (blocking first, then severity); still present by the "after" issue.
 */
export function compareIssues(beforeIssues, afterIssues) {
  const pool = new Map();
  for (const issue of afterIssues ?? []) {
    const key = issueMatchKey(issue);
    if (!pool.has(key)) pool.set(key, []);
    pool.get(key).push(issue);
  }
  const fixed = [];
  const pairs = new Map(); // after issue -> { before, after }
  for (const issue of beforeIssues ?? []) {
    const match = pool.get(issueMatchKey(issue))?.shift();
    if (match) pairs.set(match, { before: issue, after: match });
    else fixed.push(issue);
  }
  const added = (afterIssues ?? []).filter((i) => !pairs.has(i));
  return {
    fixed: sortIssues(fixed),
    stillPresent: sortIssues([...pairs.keys()]).map((after) => pairs.get(after)),
    added: sortIssues(added),
  };
}

/** Order two runs so the one that started first is "before". */
export function orderRuns(a, b) {
  const ta = Date.parse(a?.startedAt);
  const tb = Date.parse(b?.startedAt);
  return !Number.isNaN(ta) && !Number.isNaN(tb) && tb < ta ? [b, a] : [a, b];
}

/** Score change from before to after: { value, text: "+57", tone, sentence }. value is null when a score is missing. */
export function scoreDelta(before, after) {
  if (typeof before !== "number" || typeof after !== "number") {
    return { value: null, text: "–", tone: "none", sentence: "Score change not available yet" };
  }
  const value = Math.round(after) - Math.round(before);
  const pts = (n) => `${n} point${n === 1 ? "" : "s"}`;
  if (value > 0) return { value, text: `+${value}`, tone: "good", sentence: `Score up ${pts(value)}` };
  if (value < 0) return { value, text: `−${-value}`, tone: "bad", sentence: `Score down ${pts(-value)}` };
  return { value, text: "±0", tone: "none", sentence: "Score unchanged" };
}
