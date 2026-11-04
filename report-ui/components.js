// Reusable UI pieces shared by the home and report views.

import { h, icon } from "./dom.js";
import { statusLabel, statusTone, scoreTone, scoreVerdict } from "./format.js";

export function statusBadge(status) {
  return h(
    "span",
    { class: `badge status status-${statusTone(status)}${status === "running" ? " is-running" : ""}` },
    status === "running" ? h("span", { class: "pulse-dot", "aria-hidden": "true" }) : null,
    statusLabel(status),
  );
}

/** Small round score used in lists. */
export function scorePill(score) {
  const has = typeof score === "number";
  return h(
    "span",
    { class: `score-pill tone-${scoreTone(score)}` },
    h("span", { "aria-hidden": "true" }, has ? String(Math.round(score)) : "–"),
    h("span", { class: "sr-only" }, has ? `Score ${Math.round(score)} out of 100` : "No score yet"),
  );
}

/** Big score numeral with a thin bar, for the report header and the compare view. */
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
    // Presentation: a thin horizontal bar under the numeral (was a circular ring).
    h("span", { class: "gauge-bar", "aria-hidden": "true" }, h("span", { class: "gauge-fill", style: `width: ${value}%` })),
    h(
      "div",
      { class: "gauge-label", "aria-hidden": "true" },
      h("span", { class: "gauge-number" }, has ? String(Math.round(value)) : "–"),
      h("span", { class: "gauge-of" }, "/ 100"),
    ),
    h("p", { class: "gauge-verdict", "aria-hidden": "true" }, scoreVerdict(score, status)),
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
