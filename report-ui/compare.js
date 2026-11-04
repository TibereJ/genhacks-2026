// Compare view (#/compare/<before>/<after>): scores side by side with the delta, and the
// issues split into Fixed, Still present and New. Issues match on title + element role + name.

import { h, icon, replaceChildren } from "./dom.js";
import { getReport } from "./api.js";
import { compareIssues, duration, prettyUrl, relativeTime, scoreDelta, statusLabel } from "./format.js";
import { statusBadge, scoreGauge, elementChip, wcagChip, emptyState, errorBox } from "./components.js";

const POLL_MS = 1500;
const RETRY_MS = 3000;

const SEVERITY_LABELS = { critical: "Critical", serious: "Serious", moderate: "Moderate", minor: "Minor" };

export function renderCompare(root, beforeId, afterId) {
  let alive = true;
  let timer = null;
  let key = "";

  const body = h(
    "div",
    { class: "cmp-body" },
    h("header", { class: "card cmp-head" }, h("p", { class: "head-kicker" }, "Before / after"), h("h1", { id: "page-title", tabindex: "-1" }, "Loading comparison…")),
  );
  replaceChildren(
    root,
    h(
      "div",
      { class: "report compare-view" },
      h("nav", { class: "crumbs", "aria-label": "Breadcrumb" }, h("a", { href: "#/", class: "back-link" }, icon("back"), "All runs")),
      body,
    ),
  );
  document.title = "Before / after · BlindSpot";

  if (beforeId === afterId) {
    replaceChildren(body, header("Pick two different runs"), errorBox("Both sides are the same run.", "Go back to the runs list and select two different runs."));
    return { destroy() {} };
  }

  async function tick() {
    try {
      const [before, after] = await Promise.all([getReport(beforeId), getReport(afterId)]);
      if (!alive) return;
      const k = JSON.stringify([before, after]);
      if (k !== key) {
        key = k;
        const hadFocus = document.activeElement?.id === "page-title";
        replaceChildren(body, ...renderComparison(before, after));
        if (hadFocus) document.getElementById("page-title")?.focus({ preventScroll: true });
      }
      if (before.status === "running" || after.status === "running") timer = setTimeout(tick, POLL_MS);
    } catch (err) {
      if (!alive) return;
      const missing = err.status === 404;
      replaceChildren(
        body,
        header("Comparison unavailable"),
        errorBox(missing ? "One of these runs does not exist." : "Could not load the runs.", missing ? "It may have been deleted. Go back to the runs list and pick two runs." : err.message),
      );
      if (!missing) timer = setTimeout(tick, RETRY_MS);
    }
  }
  tick();

  return {
    destroy() {
      alive = false;
      clearTimeout(timer);
    },
  };
}

function header(title, ...extra) {
  return h("header", { class: "card cmp-head" }, h("p", { class: "head-kicker" }, "Before / after"), h("h1", { id: "page-title", tabindex: "-1" }, title), ...extra);
}

function renderComparison(before, after) {
  const { fixed, stillPresent, added } = compareIssues(before.issues ?? [], after.issues ?? []);
  const delta = scoreDelta(before.score, after.score);
  const sameTask = String(before.task ?? "").trim() === String(after.task ?? "").trim();
  const running = before.status === "running" || after.status === "running";

  document.title = `Before / after: ${after.task ?? "comparison"} · BlindSpot`;

  return [
    header(
      sameTask ? after.task || "Untitled task" : "Two different tasks",
      sameTask ? null : h("p", { class: "cmp-note" }, icon("alert"), "These runs did not test the same task, so the comparison may be misleading."),
      running ? h("p", { class: "cmp-note", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), "A run is still in progress. This page updates on its own.") : null,
    ),
    h(
      "section",
      { class: "cmp-scores", "aria-label": "Scores" },
      runCard("Before", before),
      h(
        "div",
        { class: `cmp-delta tone-${delta.tone}` },
        h("span", { class: "cmp-delta-arrow", "aria-hidden": "true" }, icon("arrow")),
        h("p", { class: "cmp-delta-num", "aria-hidden": "true" }, delta.text),
        h("p", { class: "cmp-delta-label", "aria-hidden": "true" }, delta.value === null ? "pending" : "points"),
        h("p", { class: "sr-only" }, `${delta.sentence}.`),
      ),
      runCard("After", after),
    ),
    h(
      "nav",
      { class: "jump", "aria-label": "Comparison sections" },
      jumpLink("cmp-fixed-title", `${fixed.length} fixed`),
      jumpLink("cmp-still-title", `${stillPresent.length} still present`),
      jumpLink("cmp-new-title", `${added.length} new`),
    ),
    issueSection({
      id: "cmp-fixed-title",
      tone: "good",
      iconName: "check",
      title: "Fixed",
      note: "Found before, gone after.",
      items: fixed.map((i) => ({ issue: i })),
      empty: before.issues?.length ? "None of the earlier issues were fixed." : "The earlier run had no issues.",
    }),
    issueSection({
      id: "cmp-still-title",
      tone: "warn",
      iconName: "alert",
      title: "Still present",
      note: "Found in both runs.",
      items: stillPresent.map(({ before: b, after: a }) => ({ issue: a, was: b })),
      empty: "No earlier issue is still there.",
    }),
    issueSection({
      id: "cmp-new-title",
      tone: "bad",
      iconName: "plus",
      title: "New",
      note: "Only found in the later run.",
      items: added.map((i) => ({ issue: i })),
      empty: "No new issues.",
    }),
  ];
}

function runCard(label, r) {
  const when = relativeTime(r.startedAt);
  const took = duration(r.startedAt, r.finishedAt);
  const issues = r.issues?.length ?? 0;
  const titleId = `cmp-${label.toLowerCase()}-title`;
  return h(
    "article",
    { class: `card cmp-run cmp-${label.toLowerCase()}`, "aria-labelledby": titleId },
    h("h2", { id: titleId, class: "cmp-run-label" }, label),
    scoreGauge(r.score),
    h("div", { class: "cmp-run-status" }, statusBadge(r.status)),
    h(
      "ul",
      { class: "cmp-run-facts", role: "list" },
      h("li", { class: "cmp-run-url" }, prettyUrl(r.url)),
      h("li", {}, `${issues} ${issues === 1 ? "issue" : "issues"}`, took ? ` · ${took}` : ""),
      when ? h("li", {}, h("time", { datetime: r.startedAt }, when)) : null,
    ),
    h(
      "a",
      { class: "btn btn-sm btn-ghost", href: `#/report/${encodeURIComponent(r.id)}` },
      "Open report",
      h("span", { class: "sr-only" }, ` (${label.toLowerCase()}: ${statusLabel(r.status)})`),
    ),
  );
}

function jumpLink(targetId, text) {
  return h(
    "a",
    {
      href: `#${targetId}`,
      onclick: (e) => {
        e.preventDefault(); // keep the hash route intact
        const el = document.getElementById(targetId);
        if (!el) return;
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
        el.focus({ preventScroll: true });
      },
    },
    text,
  );
}

function issueSection({ id, tone, iconName, title, note, items, empty }) {
  return h(
    "section",
    { class: `cmp-section cmp-${tone}`, "aria-labelledby": id },
    h(
      "div",
      { class: "section-head" },
      h(
        "h2",
        { id, tabindex: "-1" },
        h("span", { class: `cmp-section-icon tone-${tone}` }, icon(iconName)),
        title,
        " ",
        h("span", { class: "count" }, `(${items.length})`),
      ),
      h("p", { class: "section-note" }, note),
    ),
    items.length ? h("ul", { class: "cmp-issues", role: "list" }, items.map(cmpIssue)) : emptyState(empty),
  );
}

function cmpIssue({ issue, was }) {
  const changes = [];
  if (was && was.severity !== issue.severity) changes.push(`was ${SEVERITY_LABELS[was.severity]?.toLowerCase() ?? was.severity}`);
  if (was && Boolean(was.blocking) !== Boolean(issue.blocking)) changes.push(was.blocking ? "no longer blocks the task" : "now blocks the task");
  return h(
    "li",
    { class: `cmp-issue sev-${issue.severity}${issue.blocking ? " is-blocking" : ""}` },
    h(
      "div",
      { class: "issue-top" },
      h("span", { class: `badge sev sev-${issue.severity}` }, SEVERITY_LABELS[issue.severity] ?? issue.severity),
      issue.blocking ? h("span", { class: "badge blocking-flag" }, icon("alert"), "Blocks the task") : null,
      h("span", { class: `badge source source-${issue.source}` }, issue.source === "scan" ? "Automated scan" : "Found by agent"),
      changes.length ? h("span", { class: "cmp-change" }, changes.join(", ")) : null,
    ),
    h("h3", { class: "cmp-issue-title" }, issue.title),
    issue.element || issue.wcag?.length
      ? h(
          "div",
          { class: "cmp-issue-meta" },
          issue.element ? elementChip(issue.element) : null,
          issue.wcag?.length ? h("ul", { class: "chips", role: "list", "aria-label": "WCAG criteria" }, issue.wcag.map((c) => h("li", {}, wcagChip(c)))) : null,
        )
      : null,
  );
}
