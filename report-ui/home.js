// Home view: pitch, "run a test" form with demo presets, and the list of past runs.

import { h, icon, replaceChildren } from "./dom.js";
import { listReports, startRun, FIXTURE_MODE } from "./api.js";
import { orderRuns, prettyUrl, relativeTime } from "./format.js";
import { statusBadge, scorePill, emptyState, errorBox } from "./components.js";

const DEMO_TASK =
  "Book an appointment with Dr. Lee for any available time. Use the name Alex Doe and the email alex@example.com.";

const PRESETS = [
  { label: "Demo: inaccessible clinic", url: "/demo/bad/index.html", tone: "bad" },
  { label: "Demo: fixed clinic", url: "/demo/fixed/index.html", tone: "good" },
];

const LIST_REFRESH_MS = 3000;

export function renderHome(root) {
  let alive = true;
  let listTimer = null;

  // ---- form ----
  const urlInput = h("input", {
    id: "run-url",
    name: "url",
    type: "text",
    inputmode: "url",
    autocomplete: "url",
    spellcheck: "false",
    required: true,
    placeholder: "https://example.com or /demo/bad/index.html",
    "aria-describedby": "run-url-hint",
  });
  const taskInput = h("textarea", {
    id: "run-task",
    name: "task",
    rows: 3,
    required: true,
    placeholder: "What should a screen reader user be able to do?",
    "aria-describedby": "run-task-hint",
  });
  const brainSelect = h(
    "select",
    { id: "run-brain", name: "brain" },
    h("option", { value: "claude" }, "Claude (AI agent)"),
    h("option", { value: "scripted" }, "Scripted demo (no API key)"),
  );
  const submit = h("button", { type: "submit", class: "btn btn-primary btn-lg" }, "Run test", icon("arrow"));
  const formError = h("div", { class: "form-error", "aria-live": "assertive" });

  const presetButtons = PRESETS.map((p) =>
    h(
      "button",
      {
        type: "button",
        class: `btn btn-preset preset-${p.tone}`,
        onclick: () => {
          urlInput.value = p.url;
          taskInput.value = DEMO_TASK;
          replaceChildren(formError);
          submit.focus();
        },
      },
      h("span", { class: "preset-dot", "aria-hidden": "true" }),
      p.label,
    ),
  );

  const form = h(
    "form",
    {
      class: "run-form",
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        replaceChildren(formError);
        const url = urlInput.value.trim();
        const task = taskInput.value.trim();
        if (!url || !task) {
          const missing = !url ? urlInput : taskInput;
          missing.setAttribute("aria-invalid", "true");
          replaceChildren(formError, errorBox(!url ? "Enter the URL of the site to test." : "Describe the task the agent should complete."));
          missing.focus();
          return;
        }
        urlInput.removeAttribute("aria-invalid");
        taskInput.removeAttribute("aria-invalid");
        submit.disabled = true;
        replaceChildren(submit, h("span", { class: "spinner", "aria-hidden": "true" }), "Starting…");
        try {
          const { id } = await startRun({ url, task, brain: brainSelect.value });
          if (!id) throw new Error("The server did not return a run id.");
          location.hash = `#/report/${encodeURIComponent(id)}`;
        } catch (err) {
          if (!alive) return;
          replaceChildren(formError, errorBox("Could not start the test.", err.message));
          submit.disabled = false;
          replaceChildren(submit, "Run test", icon("arrow"));
        }
      },
    },
    h(
      "div",
      { class: "presets" },
      h("p", { class: "presets-label", id: "presets-label" }, "Try the demo site"),
      h("div", { class: "preset-row", role: "group", "aria-labelledby": "presets-label" }, presetButtons),
    ),
    h(
      "div",
      { class: "field" },
      h("label", { for: "run-url" }, "Website URL"),
      urlInput,
      h("p", { class: "hint", id: "run-url-hint" }, "A full URL, or a path on this server for the demo site."),
    ),
    h(
      "div",
      { class: "field" },
      h("label", { for: "run-task" }, "Task"),
      taskInput,
      h("p", { class: "hint", id: "run-task-hint" }, "Written like you would ask a person. The agent decides how to do it."),
    ),
    h(
      "div",
      { class: "form-bottom" },
      h("div", { class: "field field-inline" }, h("label", { for: "run-brain" }, "Agent"), brainSelect),
      submit,
    ),
    formError,
  );

  // ---- runs list ----
  const runsBody = h("div", { class: "runs-body", "aria-busy": "true" }, h("p", { class: "muted" }, "Loading runs…"));
  let runsKey = "";
  let runs = [];
  /** Ids of the runs ticked for a before / after comparison. Survives list refreshes. */
  const selected = new Set();

  const compareHint = h("p", { class: "compare-hint", id: "compare-hint", "aria-live": "polite" });
  const compareBtn = h(
    "button",
    {
      type: "button",
      class: "btn btn-sm btn-primary",
      disabled: true,
      "aria-describedby": "compare-hint",
      onclick: () => {
        const picked = runs.filter((r) => selected.has(r.id));
        if (picked.length !== 2) return;
        const [before, after] = orderRuns(picked[0], picked[1]);
        location.hash = `#/compare/${encodeURIComponent(before.id)}/${encodeURIComponent(after.id)}`;
      },
    },
    icon("compare"),
    "Compare selected",
  );
  const compareBar = h("div", { class: "compare-bar", hidden: true }, compareHint, compareBtn);

  function updateCompareBar() {
    const n = selected.size;
    compareBtn.disabled = n !== 2;
    compareHint.textContent =
      n === 0
        ? "Tick two runs to compare them before and after."
        : n === 1
          ? "1 run selected. Tick one more to compare."
          : n === 2
            ? "2 runs selected. The older one is shown as Before."
            : `${n} runs selected. Untick ${n - 2} to compare exactly two.`;
  }

  function onPick(e) {
    const id = e.target.dataset.id;
    if (e.target.checked) selected.add(id);
    else selected.delete(id);
    e.target.closest(".run-row")?.classList.toggle("is-picked", e.target.checked);
    updateCompareBar();
  }

  async function loadRuns() {
    try {
      const list = await listReports();
      if (!alive) return;
      runsBody.setAttribute("aria-busy", "false");
      runs = Array.isArray(list) ? list : [];
      const known = new Set(runs.map((r) => r.id));
      for (const id of selected) if (!known.has(id)) selected.delete(id);
      compareBar.hidden = runs.length < 2;
      updateCompareBar();
      // Only rebuild the list when it changed, so focus and ticks are not disturbed while polling.
      const k = JSON.stringify(runs);
      if (k !== runsKey) {
        runsKey = k;
        const focusedId = runsBody.contains(document.activeElement) ? document.activeElement.dataset?.id : undefined;
        const focusedKind = document.activeElement?.tagName;
        if (runs.length === 0) {
          replaceChildren(runsBody, emptyState("No runs yet", "Launch a test above, or try one of the demo presets."));
        } else {
          replaceChildren(runsBody, h("ul", { class: "runs", role: "list" }, runs.map((r) => runItem(r, selected.has(r.id), onPick))));
        }
        if (focusedId) {
          const sel = focusedKind === "INPUT" ? "input" : "a";
          [...runsBody.querySelectorAll(`${sel}[data-id]`)].find((el) => el.dataset.id === focusedId)?.focus({ preventScroll: true });
        }
      }
      if (runs?.some?.((r) => r.status === "running")) listTimer = setTimeout(loadRuns, LIST_REFRESH_MS);
    } catch (err) {
      if (!alive) return;
      runsBody.setAttribute("aria-busy", "false");
      replaceChildren(
        runsBody,
        errorBox("Can't reach the BlindSpot server.", `${err.message}. Start it with "npm start", or open this page with ?fixture=1 for sample data.`),
      );
    }
  }

  replaceChildren(
    root,
    h(
      "div",
      { class: "home" },
      h(
        "section",
        { class: "hero", "aria-labelledby": "page-title" },
        h("p", { class: "eyebrow" }, "AI screen reader usability testing"),
        h(
          "h1",
          { id: "page-title", tabindex: "-1" },
          h("span", { class: "hero-quiet" }, "Lighthouse checks rules."),
          " ",
          h("span", { class: "hero-loud" }, "BlindSpot checks whether a blind person can ", h("em", {}, "actually"), " use your site."),
        ),
        h(
          "p",
          { class: "lede" },
          "Give it a task. An AI agent tries to complete it using only what a screen reader announces, never the pixels, and shows you exactly where a blind user gets stuck, with WCAG criteria and code fixes.",
        ),
        h(
          "ol",
          { class: "how", role: "list" },
          howItem("ear", "Hears, never sees", "The agent only gets the accessibility tree, like a screen reader user."),
          howItem("arrow", "Does the real task", "Clicks, types and selects its way through your flow."),
          howItem("alert", "Reports blockers", "Every dead end, with the WCAG criterion and the fix."),
        ),
      ),
      h(
        "section",
        { class: "card run-card", "aria-labelledby": "run-title" },
        h("h2", { id: "run-title" }, "Run a test"),
        form,
      ),
      h(
        "section",
        { class: "runs-section", "aria-labelledby": "runs-title" },
        h("div", { class: "section-head" }, h("h2", { id: "runs-title" }, "Recent runs"), FIXTURE_MODE ? h("span", { class: "badge status-info" }, "Sample data") : null),
        compareBar,
        runsBody,
      ),
    ),
  );

  document.title = "BlindSpot: can a blind person use your site?";
  loadRuns();

  return {
    destroy() {
      alive = false;
      clearTimeout(listTimer);
    },
  };
}

function howItem(iconName, title, text) {
  return h(
    "li",
    {},
    h("span", { class: "how-icon" }, icon(iconName)),
    h("span", { class: "how-text" }, h("strong", {}, title), h("span", {}, text)),
  );
}

function runItem(run, picked, onPick) {
  const when = relativeTime(run.startedAt);
  return h(
    "li",
    { class: `run-row${picked ? " is-picked" : ""}` },
    h(
      "label",
      { class: "run-pick" },
      h("input", { type: "checkbox", checked: picked, dataset: { id: run.id }, onchange: onPick }),
      h("span", { class: "sr-only" }, `Compare: ${run.task || "(no task)"}, ${prettyUrl(run.url)}${when ? `, ${when}` : ""}`),
    ),
    h(
      "a",
      { class: "run", href: `#/report/${encodeURIComponent(run.id)}`, dataset: { id: run.id } },
      scorePill(run.score),
      h(
        "span",
        { class: "run-main" },
        h("span", { class: "run-task" }, run.task || "(no task)"),
        h(
          "span",
          { class: "run-meta" },
          h("span", { class: "run-url" }, prettyUrl(run.url)),
          when ? h("span", { "aria-hidden": "true" }, " · ") : null,
          when ? h("time", { datetime: run.startedAt }, when) : null,
        ),
      ),
      statusBadge(run.status),
    ),
  );
}
