// Markdown export of a Report, meant to be pasted as a GitHub issue (or saved as a .md file).
// Report text comes from arbitrary websites and from the AI, so every piece of it is escaped
// for the context it lands in: prose, table cells, inline code or fenced code blocks.

import type { Issue, Report, RunStatus, Severity, StepAction } from "./types.js";

const STATUS_LABELS: Record<RunStatus, string> = {
  running: "Running",
  success: "Task completed",
  blocked: "Blind user blocked",
  inconclusive: "Inconclusive",
  step_limit: "Step limit reached",
  error: "Error",
};

const SEVERITY_ORDER: Severity[] = ["critical", "serious", "moderate", "minor"];
const SEVERITY_LABELS: Record<Severity, string> = { critical: "Critical", serious: "Serious", moderate: "Moderate", minor: "Minor" };

/**
 * Escape text so Markdown renders it literally: no emphasis, links, raw HTML, entities or
 * block syntax (headings, quotes, lists) can be smuggled in by report content.
 */
export function escapeMarkdown(text: string): string {
  return escapeChars(text)
    .replace(/^(\s*)([-+=])/gm, "$1\\$2")
    .replace(/^(\s*\d+)([.)])/gm, "$1\\$2");
}

/** Escape the characters that start inline syntax (emphasis, code, links, HTML, entities). */
function escapeChars(text: string): string {
  return String(text ?? "")
    .replace(/[\\`*_{}[\]<>|~#]/g, "\\$&")
    .replace(/&(?=#?[a-z0-9]+;)/gi, "\\&");
}

/** Escaped text on a single line, placed after other content on that line (never at its start). */
function inline(text: string): string {
  return escapeChars(oneLine(text));
}

function oneLine(text: string): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/** Longest run of consecutive `char` in `text`. */
function longestRun(text: string, char: string): number {
  let max = 0;
  let cur = 0;
  for (const c of text) {
    cur = c === char ? cur + 1 : 0;
    if (cur > max) max = cur;
  }
  return max;
}

/** An inline code span that `text` cannot close early, whatever backticks it contains. */
export function codeSpan(text: string): string {
  const t = oneLine(text);
  const ticks = "`".repeat(longestRun(t, "`") + 1);
  const pad = t.startsWith("`") || t.endsWith("`") || t === "" ? " " : "";
  return `${ticks}${pad}${t}${pad}${ticks}`;
}

/** A fenced code block whose fence is longer than any backtick run in `code`. */
export function codeBlock(code: string, lang = ""): string {
  const body = String(code ?? "").replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  const fence = "`".repeat(Math.max(3, longestRun(body, "`") + 1));
  return `${fence}${lang}\n${body}\n${fence}`;
}

/**
 * Table cell content: one line, every pipe escaped (GFM splits cells before parsing code spans,
 * so it needs `\|` even inside them). A pipe after an odd run of backslashes is already escaped.
 */
function cell(markdown: string): string {
  return markdown.replace(/\n/g, " ").replace(/(\\*)\|/g, (_, slashes: string) => (slashes.length % 2 ? `${slashes}|` : `${slashes}\\|`));
}

function blockquote(text: string): string {
  return String(text)
    .trim()
    .split(/\r?\n/)
    .map((line) => (line.trim() ? `> ${escapeMarkdown(line.trim())}` : ">"))
    .join("\n");
}

/** `role "name"`, as a screen reader would announce the element. */
function elementLabel(el: { role: string; name: string }): string {
  return `${el.role || "element"} "${oneLine(el.name ?? "")}"`;
}

function hasName(el: { name: string }): boolean {
  return Boolean(el.name && el.name.trim());
}

const KEY_NAMES: Record<string, string> = {
  enter: "Enter", tab: "Tab", escape: "Escape", esc: "Escape", space: "Space", " ": "Space",
  arrowdown: "Arrow Down", arrowup: "Arrow Up", arrowleft: "Arrow Left", arrowright: "Arrow Right", backspace: "Backspace",
};

/** Same wording as the report UI, e.g. `Typed "Alex Doe" into textbox "Full name"`. Returns Markdown. */
export function actionMarkdown(action: StepAction | undefined): string {
  const a = action ?? ({} as Partial<StepAction>);
  const el = a.target ? codeSpan(elementLabel(a.target)) : "";
  const value = `"${inline(a.value ?? "")}"`;
  switch (a.type) {
    case "click":
      return `Clicked ${el || "an element"}`;
    case "type":
      return `Typed ${value}${el ? ` into ${el}` : ""}`;
    case "select":
      return `Selected ${value}${el ? ` in ${el}` : ""}`;
    case "press": {
      const key = a.value ? KEY_NAMES[a.value.toLowerCase()] ?? a.value : "a key";
      return `Pressed ${inline(key)}${el ? ` on ${el}` : ""}`;
    }
    case "back":
      return "Went back to the previous page";
    case "finish":
      return "Finished";
    default:
      return a.type ? `Action: ${inline(a.type)}` : "Unknown action";
  }
}

/** Blocking first, then by severity, then by step. Does not mutate the input. */
export function sortIssuesForExport(issues: Issue[]): Issue[] {
  const rank = (s: string) => {
    const i = SEVERITY_ORDER.indexOf(s as Severity);
    return i === -1 ? SEVERITY_ORDER.length : i;
  };
  return [...issues].sort(
    (a, b) => Number(Boolean(b.blocking)) - Number(Boolean(a.blocking)) || rank(a.severity) - rank(b.severity) || (a.stepIndex ?? 0) - (b.stepIndex ?? 0),
  );
}

function severityLabel(s: string): string {
  return SEVERITY_LABELS[s as Severity] ?? inline(s);
}

/** Only links to http(s) URLs, written as autolinks so no link text can be faked. */
function urlMarkdown(url: string): string {
  const u = oneLine(url);
  if (/^https?:\/\/[^\s<>]+$/i.test(u)) return `<${u}>`;
  return codeSpan(u);
}

function stepNumber(report: Report, stepIndex: number): number | null {
  const pos = report.steps.findIndex((s) => s.index === stepIndex);
  return pos === -1 ? null : pos + 1;
}

export function reportToMarkdown(report: Report): string {
  const steps = Array.isArray(report.steps) ? report.steps : [];
  const issues = sortIssuesForExport(Array.isArray(report.issues) ? report.issues : []);
  const r = { ...report, steps, issues };
  const status = STATUS_LABELS[report.status] ?? inline(String(report.status));
  const score = typeof report.score === "number" ? `score ${Math.round(report.score)}/100` : "score pending";
  const blocking = issues.filter((i) => i.blocking).length;
  const out: string[] = [];

  out.push(`# BlindSpot: ${status}, ${score}`);
  out.push("");
  out.push(`**Task:** ${inline(report.task || "Untitled task")}  `);
  out.push(`**URL:** ${urlMarkdown(report.url ?? "")}  `);
  const facts = [
    `**Steps:** ${steps.length}`,
    `**Issues:** ${issues.length}${blocking ? ` (${blocking} blocking)` : ""}`,
    report.model ? `**Agent:** ${codeSpan(report.model)}` : null,
    report.startedAt ? `**Run:** ${inline(report.startedAt)}` : null,
  ].filter(Boolean);
  out.push(facts.join(" · "));

  if (report.summary?.trim()) {
    out.push("", "## Summary", "", blockquote(report.summary));
  }
  if (report.status === "error" && report.error) {
    out.push("", "**The run stopped with an error:**", "", codeBlock(report.error));
  }

  out.push("", `## Issues (${issues.length})`, "");
  if (!issues.length) {
    out.push(report.status === "running" ? "_The run is still in progress._" : "No accessibility issues were found on this task.");
  } else {
    out.push("| # | Severity | Blocking | Issue | WCAG | Element |");
    out.push("|---|---|---|---|---|---|");
    issues.forEach((issue, n) => {
      const wcag = (issue.wcag ?? []).map((c) => oneLine(c).match(/^\d+\.\d+\.\d+/)?.[0] ?? oneLine(c));
      const row = [
        String(n + 1),
        severityLabel(issue.severity),
        issue.blocking ? "**Yes**" : "No",
        inline(issue.title),
        wcag.length ? inline(wcag.join(", ")) : "",
        issue.element ? codeSpan(elementLabel(issue.element)) : "",
      ];
      out.push(`| ${row.map(cell).join(" | ")} |`);
    });

    issues.forEach((issue, n) => {
      out.push("", `### ${n + 1}. ${inline(issue.title)}`, "");
      const step = stepNumber(r, issue.stepIndex);
      const meta = [
        `**${severityLabel(issue.severity)}**`,
        issue.blocking ? "**blocks the task**" : null,
        issue.source === "scan" ? "found by the automated scan" : "found by the agent",
        step !== null ? `at step ${step}` : null,
      ].filter(Boolean);
      out.push(meta.join(" · "));
      if (issue.description?.trim()) out.push("", escapeMarkdown(issue.description.trim()));
      if (issue.wcag?.length) out.push("", `**WCAG 2.2:** ${issue.wcag.map(inline).join("; ")}`);
      if (issue.element) {
        out.push("", `**Element:** ${codeSpan(elementLabel(issue.element))}${hasName(issue.element) ? "" : " (no accessible name)"}`);
        if (issue.element.html?.trim()) out.push("", codeBlock(issue.element.html, "html"));
      }
      if (issue.fix?.trim()) out.push("", "**How to fix:**", "", codeBlock(issue.fix, "html"));
    });
  }

  out.push("", "<details>", `<summary>Steps the agent took (${steps.length})</summary>`, "");
  if (!steps.length) {
    out.push("The run ended before the agent took any action.");
  } else {
    steps.forEach((step, n) => {
      const failed = step.ok === false ? " **(failed)**" : "";
      out.push(`${n + 1}. ${actionMarkdown(step.action)}${failed}`);
      if (step.result?.trim()) out.push(`   ${escapeMarkdown(oneLine(step.result))}`);
    });
  }
  out.push("", "</details>", "");
  out.push("_Generated by BlindSpot: an AI agent that tests a site using only what a screen reader announces._", "");
  return out.join("\n");
}
