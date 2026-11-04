// Toolbar shown on a finished report: export as Markdown (download or copy as a GitHub issue)
// and "Compare with…" another run of the same task.

import { h, icon, replaceChildren } from "./dom.js";
import { getMarkdown, listReports, markdownUrl, FIXTURE_MODE } from "./api.js";
import { orderRuns, prettyUrl, relativeTime, statusLabel } from "./format.js";

const STATUS_CLEAR_MS = 3000;

/** Build the toolbar for a finished report. Returns null when there is nothing to offer (fixture mode). */
export function reportActions(report) {
  if (FIXTURE_MODE) return null;
  return h(
    "section",
    { class: "card report-actions", "aria-labelledby": "actions-title" },
    h("h2", { id: "actions-title", class: "sr-only" }, "Export and compare"),
    exportGroup(report),
    compareGroup(report),
  );
}

function exportGroup(report) {
  const status = h("span", { class: "copy-status", role: "status" });
  let clearTimer = null;
  const say = (text, tone = "good") => {
    clearTimeout(clearTimer);
    status.className = `copy-status tone-${tone}`;
    status.textContent = text;
    clearTimer = setTimeout(() => (status.textContent = ""), STATUS_CLEAR_MS);
  };

  const copyBtn = h(
    "button",
    {
      type: "button",
      class: "btn btn-sm",
      onclick: async () => {
        copyBtn.disabled = true;
        try {
          await copyMarkdown(report.id);
          say("Copied");
        } catch {
          say("Copy failed. Use Download Markdown instead.", "bad");
        } finally {
          copyBtn.disabled = false;
        }
      },
    },
    icon("copy"),
    "Copy as GitHub issue",
  );

  return h(
    "div",
    { class: "action-group" },
    h("p", { class: "action-label", id: "export-label" }, "Export"),
    h(
      "div",
      { class: "action-row", role: "group", "aria-labelledby": "export-label" },
      h(
        "a",
        { class: "btn btn-sm", href: markdownUrl(report.id), download: `blindspot-${report.id}.md` },
        icon("download"),
        "Download Markdown",
      ),
      copyBtn,
      status,
    ),
  );
}

/**
 * Copy the Markdown export. The ClipboardItem form takes a promise, so the clipboard write starts
 * inside the click (Safari requires that) while the text is still being fetched.
 */
async function copyMarkdown(id) {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      const blob = getMarkdown(id).then((text) => new Blob([text], { type: "text/plain" }));
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      return;
    } catch {
      /* fall back to writeText below */
    }
  }
  const text = await getMarkdown(id);
  await navigator.clipboard.writeText(text);
}

function compareGroup(report) {
  const body = h("div", { class: "action-row" }, h("span", { class: "muted action-note" }, "Looking for other runs of this task…"));
  const group = h(
    "div",
    { class: "action-group action-compare" },
    h("p", { class: "action-label", id: "compare-label" }, "Before / after"),
    body,
  );

  listReports()
    .then((runs) => {
      const others = (Array.isArray(runs) ? runs : []).filter(
        (r) => r.id !== report.id && r.status !== "running" && String(r.task ?? "").trim() === String(report.task ?? "").trim(),
      );
      if (!others.length) {
        replaceChildren(body, h("span", { class: "muted action-note" }, "Run the same task again (for example on the fixed site) to compare before and after."));
        return;
      }
      const select = h(
        "select",
        { id: "compare-with", class: "compare-select" },
        others.map((r) => h("option", { value: r.id }, runOptionLabel(r))),
      );
      const go = h(
        "button",
        {
          type: "button",
          class: "btn btn-sm btn-primary",
          onclick: () => {
            const other = others.find((r) => r.id === select.value);
            if (!other) return;
            const [before, after] = orderRuns(report, other);
            location.hash = `#/compare/${encodeURIComponent(before.id)}/${encodeURIComponent(after.id)}`;
          },
        },
        icon("compare"),
        "Compare",
      );
      replaceChildren(
        body,
        h("label", { for: "compare-with", class: "action-prefix" }, "Compare with…"),
        select,
        go,
      );
    })
    .catch(() => replaceChildren(body, h("span", { class: "muted action-note" }, "Could not load other runs.")));

  return group;
}

function runOptionLabel(r) {
  const when = relativeTime(r.startedAt);
  const score = typeof r.score === "number" ? `score ${Math.round(r.score)}` : statusLabel(r.status);
  return [prettyUrl(r.url), score, when].filter(Boolean).join(" · ");
}
