// Home view: the pitch with a transcript specimen, the "run a test" form with demo presets, and the list of past runs.

import { h, icon, replaceChildren } from "./dom.js";
import { listReports, startRun, FIXTURE_MODE, STATIC_MODE } from "./api.js";
import { orderRuns, prettyUrl, relativeTime, tokenizeTranscript } from "./format.js";
import { statusBadge, scorePill, emptyState, errorBox } from "./components.js";

const DEMO_TASK =
  "Book an appointment with Dr. Lee for any available time. Use the name Alex Doe and the email alex@example.com.";

const SHOP_TASK =
  "Buy 2 kg of apples and a loaf of bread, then check out with home delivery. Use the name Alex Doe, address 12 Elm Street, and accept the terms.";

const PRESETS = [
  { label: "Inaccessible clinic", url: "/demo/bad/index.html", task: DEMO_TASK, tone: "bad" },
  { label: "Fixed clinic", url: "/demo/fixed/index.html", task: DEMO_TASK, tone: "good" },
  { label: "Inaccessible shop", url: "/demo/shop/bad/index.html", task: SHOP_TASK, tone: "bad" },
  { label: "Fixed shop", url: "/demo/shop/fixed/index.html", task: SHOP_TASK, tone: "good" },
];

/**
 * An excerpt of what the agent heard on the inaccessible demo clinic's booking form (step 4 of the example run),
 * shown on the home page as a specimen. `note` points at the numbered remarks under it; "…" marks lines left out.
 */
const SPECIMEN = [
  { line: '[6] date field "Date" value "2026-11-05" ← focus' },
  { line: 'text "Available times"' },
  { line: 'text "9:00"', note: 1 },
  { line: 'text "10:30"', note: 1 },
  { line: 'text "11:45"', note: 1 },
  { line: 'text "14:00"', note: 1 },
  { line: 'text "16:15"', note: 1 },
  { line: "…" },
  { line: '[7] textbox "Full name"' },
  { line: 'text "Email"' },
  { line: '[8] textbox ""', note: 2 },
  { line: "…" },
  { line: 'text "Book appointment"' },
  { line: '[9] button ""', note: 3 },
];

const SPECIMEN_NOTES = [
  "The time slots are plain text with no number, so nothing can focus or choose them. Tab goes from the date straight to Full name.",
  "The email field has no label. “Email” is only nearby text.",
  "The button that books is announced as a button, with no name.",
];

/** The example runs of the demo clinic (examples/reports/), linked from the hero when they are in the list. */
const EXAMPLE_BAD_CLINIC = "20261104164439-947unj";
const EXAMPLE_FIXED_CLINIC = "20261104164505-l2g8gy";

const LIST_REFRESH_MS = 3000;

const QUICK_START_URL = "https://github.com/TibereJ/genhacks-2026#quick-start";

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
    placeholder: "https://example.com/signup",
    "aria-describedby": "run-url-hint",
  });
  const taskInput = h("textarea", {
    id: "run-task",
    name: "task",
    rows: 3,
    required: true,
    placeholder: "Create an account with the email alex@example.com",
    "aria-describedby": "run-task-hint",
  });
  const brainSelect = h(
    "select",
    { id: "run-brain", name: "brain" },
    h("option", { value: "claude" }, "Claude"),
    h("option", { value: "scripted" }, "Scripted demo, no API key"),
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
          taskInput.value = p.task;
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
      h("p", { class: "presets-label", id: "presets-label" }, "Fill in a demo"),
      h("div", { class: "preset-row", role: "group", "aria-labelledby": "presets-label" }, presetButtons),
    ),
    h(
      "div",
      { class: "field" },
      h("label", { for: "run-url" }, "Website URL"),
      urlInput,
      h("p", { class: "hint", id: "run-url-hint" }, "A full URL, or a path on this server such as /demo/bad/index.html."),
    ),
    h(
      "div",
      { class: "field" },
      h("label", { for: "run-task" }, "Task"),
      taskInput,
      h("p", { class: "hint", id: "run-task-hint" }, "One or two sentences, the way you would brief a person. The agent decides how to do it."),
    ),
    h(
      "div",
      { class: "form-bottom" },
      h("div", { class: "field field-inline" }, h("label", { for: "run-brain" }, "Agent"), brainSelect),
      submit,
    ),
    formError,
  );

  // ---- way in: the example clinic runs, when this server has them ----
  const heroLinks = h("ul", { class: "hero-links", role: "list", "aria-label": "Start with an example" });

  function renderHeroLinks() {
    const bad = runs.find((r) => r.id === EXAMPLE_BAD_CLINIC);
    const fixed = runs.find((r) => r.id === EXAMPLE_FIXED_CLINIC);
    if (!bad) return replaceChildren(heroLinks);
    const score = (r) => (typeof r.score === "number" ? String(Math.round(r.score)) : "–");
    replaceChildren(
      heroLinks,
      h(
        "li",
        {},
        h(
          "a",
          { href: `#/report/${encodeURIComponent(bad.id)}` },
          h("span", { class: "hero-link-label" }, "Read a report"),
          h("span", { class: "hero-link-sub" }, "The inaccessible clinic, where the agent gets stuck at the time slots"),
          h("span", { class: "hero-link-score is-bad", "aria-hidden": "true" }, score(bad)),
        ),
      ),
      fixed
        ? h(
            "li",
            {},
            h(
              "a",
              { href: `#/compare/${encodeURIComponent(bad.id)}/${encodeURIComponent(fixed.id)}` },
              h("span", { class: "hero-link-label" }, "See it fixed"),
              h("span", { class: "hero-link-sub" }, "Same page, same pixels, a corrected accessibility tree"),
              h(
                "span",
                { class: "hero-link-score", "aria-hidden": "true" },
                h("span", { class: "is-bad" }, score(bad)),
                h("span", { class: "to" }, "to"),
                score(fixed),
              ),
            ),
          )
        : null,
    );
  }

  // ---- runs list ----
  const runsBody = h("div", { class: "runs-body", "aria-busy": "true" }, h("p", { class: "muted runs-loading" }, "Loading runs…"));
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
      renderHeroLinks();
      updateCompareBar();
      // Only rebuild the list when it changed, so focus and ticks are not disturbed while polling.
      const k = JSON.stringify(runs);
      if (k !== runsKey) {
        runsKey = k;
        const focusedId = runsBody.contains(document.activeElement) ? document.activeElement.dataset?.id : undefined;
        const focusedKind = document.activeElement?.tagName;
        if (runs.length === 0) {
          replaceChildren(
            runsBody,
            STATIC_MODE
              ? emptyState("No example runs", "This demo build contains no reports.")
              : emptyState("No runs yet", "Start a test above, or fill in one of the demos."),
          );
        } else {
          replaceChildren(
            runsBody,
            h(
              "div",
              { class: "runs-cols", "aria-hidden": "true" },
              h("span", { class: "col-pick" }),
              h("span", { class: "col-task" }, "Task and site"),
              h("span", { class: "col-status" }, "Result"),
              h("span", { class: "col-when" }, "Started"),
              h("span", { class: "col-score" }, "Score"),
            ),
            h("ul", { class: "runs", role: "list" }, runs.map((r) => runItem(r, selected.has(r.id), onPick))),
          );
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
        STATIC_MODE
          ? errorBox("Could not load the example runs.", err.message)
          : errorBox("Can't reach the BlindSpot server.", `${err.message}. Start it with "npm start", or open this page with ?fixture=1 for sample data.`),
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
        h(
          "h1",
          { id: "page-title", tabindex: "-1" },
          h("span", { class: "hero-quiet" }, "Lighthouse checks rules."),
          " ",
          h("span", { class: "hero-loud" }, "BlindSpot checks whether a blind person can ", h("em", {}, "actually"), " use your site."),
        ),
        h(
          "div",
          { class: "hero-body" },
          h(
            "div",
            { class: "hero-text" },
            h(
              "p",
              { class: "lede" },
              "Give it a web address and a task, the way you would brief a person: book an appointment, check out, find a price. An agent then tries to do it with nothing but what a screen reader announces. It never sees the page.",
            ),
            h(
              "p",
              { class: "lede-2" },
              "When it gets stuck, the report shows the exact step, what it heard there, the WCAG criterion involved and the code that fixes it.",
            ),
            heroLinks,
          ),
          specimen(),
        ),
      ),
      STATIC_MODE
        ? staticNotice()
        : h(
            "section",
            { class: "run-card", "aria-labelledby": "run-title" },
            h(
              "div",
              { class: "run-intro" },
              h("h2", { id: "run-title" }, "Run a test"),
              h(
                "p",
                { class: "section-note" },
                "The report opens straight away and fills in step by step while the agent works.",
              ),
            ),
            form,
          ),
      h(
        "section",
        { class: "runs-section", "aria-labelledby": "runs-title" },
        h(
          "div",
          { class: "section-head" },
          h("h2", { id: "runs-title" }, STATIC_MODE ? "Example runs" : "Recent runs"),
          FIXTURE_MODE ? h("span", { class: "badge status-info" }, "Sample data") : null,
          STATIC_MODE
            ? h("p", { class: "section-note" }, "Real runs by the agent: both demo sites, broken and fixed, and three public websites.")
            : null,
        ),
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

/** The transcript excerpt shown in the hero: real output, typeset like a specimen with numbered remarks. */
function specimen() {
  const rows = SPECIMEN.map(({ line, note }, i) => {
    const first = note && SPECIMEN[i - 1]?.note !== note;
    const last = note && SPECIMEN[i + 1]?.note !== note;
    if (line === "…") return h("span", { class: "sp-row sp-gap" }, h("span", { class: "sp-code" }, "…"));
    const [tokens] = tokenizeTranscript(line);
    return h(
      "span",
      { class: `sp-row${note ? " is-noted" : ""}${first ? " is-first" : ""}${last ? " is-last" : ""}` },
      h(
        "span",
        { class: "sp-code" },
        tokens.tokens.map((t) => (t.kind === "text" ? t.text : h("span", { class: `t-${t.kind}` }, t.text))),
      ),
      first ? h("span", { class: "sp-mark", "aria-hidden": "true" }, String(note)) : null,
    );
  });
  return h(
    "figure",
    { class: "specimen", "aria-labelledby": "specimen-title" },
    h(
      "div",
      { class: "specimen-head" },
      h("p", { class: "specimen-title", id: "specimen-title" }, "What the agent heard on a booking form"),
      h("p", { class: "specimen-source" }, "Maple Grove Clinic, inaccessible version, step 4"),
    ),
    h("pre", { class: "specimen-code", tabindex: "0", "aria-label": "Screen reader transcript excerpt" }, rows),
    h(
      "figcaption",
      { class: "specimen-notes" },
      h(
        "ol",
        {},
        SPECIMEN_NOTES.map((text) => h("li", {}, text)),
      ),
      h("p", { class: "specimen-foot" }, "A mouse user books without noticing any of it."),
    ),
  );
}

/**
 * Static (read-only) demo: there is no server to run tests, so the form is replaced by a notice. The presets
 * become links to the copies of the demo sites shipped with the build, so visitors can see what the agent tested.
 */
function staticNotice() {
  return h(
    "section",
    { class: "run-card static-notice", "aria-labelledby": "run-title" },
    h(
      "div",
      { class: "run-intro" },
      h("h2", { id: "run-title" }, "Run a test"),
      h(
        "p",
        { class: "static-text" },
        "This is a read-only demo with real example runs. Run BlindSpot locally to test your own site: ",
        h("a", { href: QUICK_START_URL }, "quick start on GitHub"),
        ".",
      ),
    ),
    h(
      "div",
      { class: "presets" },
      h("p", { class: "presets-label", id: "presets-label" }, "Open the demo sites the agent tested"),
      h(
        "ul",
        { class: "preset-row", role: "list", "aria-labelledby": "presets-label" },
        PRESETS.map((p) =>
          h(
            "li",
            { class: "preset-item" },
            h(
              "a",
              { class: `btn btn-preset preset-${p.tone}`, href: p.url.replace(/^\//, ""), target: "_blank", rel: "noopener" },
              h("span", { class: "preset-dot", "aria-hidden": "true" }),
              p.label,
              h("span", { class: "sr-only" }, " (opens in a new tab)"),
            ),
          ),
        ),
      ),
    ),
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
      h(
        "span",
        { class: "run-main" },
        h("span", { class: "run-task" }, run.task || "(no task)"),
        h("span", { class: "run-meta" }, h("span", { class: "run-url" }, prettyUrl(run.url))),
      ),
      h("span", { class: "run-status" }, statusBadge(run.status)),
      h("span", { class: "run-when" }, when ? h("time", { datetime: run.startedAt }, when) : null),
      h("span", { class: "run-score" }, scorePill(run.score, run.status)),
    ),
  );
}
