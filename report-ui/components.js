// Reusable UI pieces shared by the home, report and compare views.
//
// Design note: the interface is typeset the way a screen reader announces a page. Headings carry their role
// ("heading level 1", "list (7 items)") as a dim, aria-hidden prefix, so the real heading text stays clean for
// actual screen readers, and scores are drawn as a row of dots, like braille cells.

import { h, icon } from "./dom.js";
import { noScoreText, statusLabel, statusTone, scoreTone, scoreVerdict } from "./format.js";

const STATUS_ICONS = { good: "check", bad: "alert", warn: "minus" };

/** Run status: always a word plus a symbol, never colour alone. */
export function statusBadge(status) {
  const tone = statusTone(status);
  const running = status === "running";
  return h(
    "span",
    { class: `badge status status-${tone}${running ? " is-running" : ""}` },
    running ? h("span", { class: "pulse-dot", "aria-hidden": "true" }) : STATUS_ICONS[tone] ? icon(STATUS_ICONS[tone]) : null,
    statusLabel(status),
  );
}

/** Ten dots filled in proportion to a 0-100 score, grouped five and five like braille cells. Decorative. */
export function scoreCells(score, size = "") {
  const has = typeof score === "number";
  const filled = has ? Math.round(Math.max(0, Math.min(100, score)) / 10) : 0;
  return h(
    "span",
    { class: `cells${size ? ` cells-${size}` : ""}${has ? "" : " is-unscored"}`, "aria-hidden": "true" },
    Array.from({ length: 10 }, (_, i) => h("span", { class: `cell${i < filled ? " is-on" : ""}` })),
  );
}

/** Compact score used in lists: number and small cells. Pass the run status so a missing score says why. */
export function scorePill(score, status) {
  const has = typeof score === "number";
  return h(
    "span",
    { class: `score-pill tone-${scoreTone(score)}` },
    h("span", { class: "score-pill-num", "aria-hidden": "true" }, has ? String(Math.round(score)) : "–"),
    scoreCells(score, "sm"),
    h("span", { class: "sr-only" }, has ? `Score ${Math.round(score)} out of 100` : noScoreText(status)),
  );
}

/** The score for the report header and the compare view: a mono numeral over ten cells, and a verdict. */
export function scoreGauge(score, status) {
  const has = typeof score === "number";
  const value = has ? Math.max(0, Math.min(100, score)) : 0;
  const tone = scoreTone(score);
  return h(
    "div",
    {
      class: `gauge tone-${tone}`,
      role: "img",
      "aria-label": has ? `Accessibility score: ${Math.round(value)} out of 100. ${scoreVerdict(score)}.` : scoreVerdict(score, status),
    },
    h(
      "div",
      { class: "gauge-label", "aria-hidden": "true" },
      h("span", { class: "gauge-number" }, has ? String(Math.round(value)) : "–"),
      h("span", { class: "gauge-of" }, has ? "/100" : "no score"),
    ),
    scoreCells(score),
    h("p", { class: "gauge-verdict", "aria-hidden": "true" }, scoreVerdict(score, status)),
  );
}

/**
 * A heading typeset as a screen reader announces it: the dim role first, then the content. The role is
 * aria-hidden (a real screen reader says it anyway); `role` may be a string or a node to update later.
 */
export function announce(role, heading, extraClass = "") {
  return h(
    "div",
    { class: `announce${extraClass ? ` ${extraClass}` : ""}` },
    typeof role === "string" ? roleTag(role) : role,
    heading,
  );
}

export function roleTag(text) {
  return h("span", { class: "announce-role", "aria-hidden": "true" }, text);
}

/** Quote marks around a heading's content, as in a transcript. Hidden from assistive technology. */
export function quoted(...children) {
  return [h("span", { class: "q q-open", "aria-hidden": "true" }, '"'), ...children, h("span", { class: "q q-close", "aria-hidden": "true" }, '"')];
}

/** "list (3 items)" */
export function listRole(n) {
  return `list (${n} ${n === 1 ? "item" : "items"})`;
}

const SEVERITY_DOTS = { critical: 4, serious: 3, moderate: 2, minor: 1 };

/** Severity as a mono, role-like label: "critical · blocks the task", with four dots showing the weight. */
export function severityLabel(issue) {
  const sev = issue.severity;
  const dots = SEVERITY_DOTS[sev] ?? 0;
  return h(
    "span",
    { class: `sev-label sev-${sev}${issue.blocking ? " is-blocking" : ""}` },
    h(
      "span",
      { class: "sev-dots", "aria-hidden": "true" },
      Array.from({ length: 4 }, (_, i) => h("span", { class: i < dots ? "is-on" : "" })),
    ),
    h("span", { class: "sev-word" }, sev),
    issue.blocking ? h("span", { class: "sev-block" }, h("span", { class: "sev-sep", "aria-hidden": "true" }, " · "), h("span", { class: "sr-only" }, ", "), "blocks the task") : null,
  );
}

/** An element as a screen reader perceives it: role + name, with empty names made obvious. */
export function elementChip({ role, name }) {
  const empty = !name || !String(name).trim();
  return h(
    "span",
    { class: `el-chip${empty ? " is-empty" : ""}` },
    h("span", { class: "el-role" }, role || "element"),
    " ",
    h("span", { class: "el-name" }, `"${name ?? ""}"`),
    empty ? h("span", { class: "el-warn" }, "no accessible name") : null,
  );
}

/** Link a WCAG criterion like "4.1.2 Name, Role, Value" to its W3C Understanding page. */
export function wcagChip(criterion) {
  const text = String(criterion);
  const m = text.match(/^\s*(\d+\.\d+\.\d+)\s+(.+?)\s*$/);
  if (!m) return h("span", { class: "chip wcag" }, text);
  const slug = m[2]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return h(
    "a",
    {
      class: "chip wcag",
      href: `https://www.w3.org/WAI/WCAG22/Understanding/${slug}.html`,
      target: "_blank",
      rel: "noopener noreferrer",
    },
    h("span", { class: "chip-num" }, m[1]),
    " ",
    m[2],
    h("span", { class: "sr-only" }, " (WCAG Understanding page, opens in a new tab)"),
  );
}

export function emptyState(title, text) {
  return h("div", { class: "empty" }, h("p", { class: "empty-title" }, title), text ? h("p", {}, text) : null);
}

export function errorBox(title, text) {
  return h(
    "div",
    { class: "error-box", role: "alert" },
    icon("alert"),
    h("div", {}, h("p", { class: "error-title" }, title), text ? h("p", {}, text) : null),
  );
}
