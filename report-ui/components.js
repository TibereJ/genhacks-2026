// Reusable UI pieces shared by the home and report views.

import { h, s, icon } from "./dom.js";
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

/** Big circular gauge for the report header. */
export function scoreGauge(score) {
  const has = typeof score === "number";
  const value = has ? Math.max(0, Math.min(100, score)) : 0;
  const r = 52;
  const c = 2 * Math.PI * r;
  const tone = scoreTone(score);
  return h(
    "div",
    {
      class: `gauge tone-${tone}`,
      role: "img",
      "aria-label": has ? `Accessibility score: ${Math.round(value)} out of 100. ${scoreVerdict(score)}.` : "Score pending",
    },
    s(
      "svg",
      { viewBox: "0 0 120 120", class: "gauge-ring", "aria-hidden": "true", focusable: "false" },
      s("circle", { cx: 60, cy: 60, r, class: "gauge-track" }),
      s("circle", {
        cx: 60,
        cy: 60,
        r,
        class: "gauge-value",
        "stroke-dasharray": `${c} ${c}`,
        "stroke-dashoffset": String(c * (1 - value / 100)),
        transform: "rotate(-90 60 60)",
      }),
    ),
    h(
      "div",
      { class: "gauge-label", "aria-hidden": "true" },
      h("span", { class: "gauge-number" }, has ? String(Math.round(value)) : "–"),
      h("span", { class: "gauge-of" }, "/ 100"),
    ),
    h("p", { class: "gauge-verdict", "aria-hidden": "true" }, scoreVerdict(score)),
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
