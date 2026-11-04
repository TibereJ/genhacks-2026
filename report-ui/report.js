// Report view: live-updating header, issues and the step timeline with the
// "What you see" vs "What a screen reader user hears" comparison.

import { h, icon, replaceChildren } from "./dom.js";
import { getReport, SCREENSHOT_BASE, STATIC_MODE } from "./api.js";
import {
  actionSegments,
  actionText,
  demoSiteHref,
  countBySeverity,
  duration,
  prettyUrl,
  relativeTime,
  screenshotUrl,
  sortIssues,
  statusLabel,
  tokenizeTranscript,
  SEVERITY_ORDER,
} from "./format.js";
import { statusBadge, scoreGauge, elementChip, wcagChip, emptyState, errorBox, announce, roleTag, listRole, quoted, severityLabel } from "./components.js";
import { speak, stopSpeaking, SPEECH_SUPPORTED } from "./speech.js";
import { openLightbox } from "./lightbox.js";
import { reportActions } from "./report-actions.js";

const POLL_MS = 1500;
const RETRY_MS = 3000;

export function renderReport(root, id) {
  let alive = true;
  let timer = null;
  let first = true;
  let sawRunning = false;
  let headKey = "";
  let issuesKey = "";
  /** step index -> { key, node } */
  const stepNodes = new Map();
  let report = null;

  const head = h(
    "header",
    { class: "card report-head" },
    h("div", { class: "head-main" }, announce("heading level 1", h("h1", { id: "page-title", tabindex: "-1" }, "Loading report…"))),
  );
  const liveRegion = h("div", { class: "live-banner", role: "status", "aria-live": "polite" });
  // Export / compare toolbar, filled in once the run has finished.
  const actionsSlot = h("div", { class: "report-actions-slot" });
  const issuesCount = h("span", { class: "count" });
  const issuesRole = roleTag("list");
  const stepsRole = roleTag("list");
  const severitySummary = h("div", { class: "sev-summary" });
  const issuesBody = h("div", { class: "issues-body" });
  const stepsCount = h("span", { class: "count" });
  const stepsList = h("ol", { class: "steps", role: "list" });
  const stepsTail = h("div", { class: "steps-tail" });

  const layout = h(
    "div",
    { class: "report" },
    h("nav", { class: "crumbs", "aria-label": "Breadcrumb" }, h("a", { href: "#/", class: "back-link" }, icon("back"), "All runs")),
    head,
    actionsSlot,
    liveRegion,
    h(
      "nav",
      { class: "jump", "aria-label": "Report sections" },
      h("a", { href: "#issues-title", onclick: jumpTo("issues-title") }, "Blind spots"),
      h("a", { href: "#steps-title", onclick: jumpTo("steps-title") }, "What the agent did"),
    ),
    h(
      "section",
      { class: "issues-section", "aria-labelledby": "issues-title" },
      h("div", { class: "section-head" }, announce(issuesRole, h("h2", { id: "issues-title", tabindex: "-1" }, "Blind spots ", issuesCount)), severitySummary),
      issuesBody,
    ),
    h(
      "section",
      { class: "steps-section", "aria-labelledby": "steps-title" },
      h(
        "div",
        { class: "section-head" },
        announce(stepsRole, h("h2", { id: "steps-title", tabindex: "-1" }, "What the agent did ", stepsCount)),
        h("p", { class: "section-note" }, "The agent never sees the screen. It acts only on what a screen reader announces."),
      ),
      stepsList,
      stepsTail,
    ),
  );
  replaceChildren(root, layout);

  async function tick() {
    try {
      const r = await getReport(id);
      if (!alive) return;
      update(r);
      first = false;
      if (r.status === "running") timer = setTimeout(tick, POLL_MS);
    } catch (err) {
      if (!alive) return;
      if (first) {
        replaceChildren(
          head,
          errorBox(err.status === 404 ? "Report not found." : "Could not load this report.", err.status === 404 ? `There is no run with id "${id}".` : err.message),
        );
        document.title = "Report unavailable · BlindSpot";
        if (err.status !== 404) timer = setTimeout(tick, RETRY_MS);
      } else {
        liveRegion.className = "live-banner is-warning";
        replaceChildren(liveRegion, icon("alert"), h("span", {}, "Connection lost. Retrying…"));
        timer = setTimeout(tick, RETRY_MS);
      }
    }
  }

  function update(r) {
    report = r;
    const running = r.status === "running";
    if (running) sawRunning = true;
    const steps = Array.isArray(r.steps) ? r.steps : [];
    const issues = Array.isArray(r.issues) ? r.issues : [];

    // Header
    const hk = JSON.stringify([r.status, r.score, r.summary, r.error, r.finishedAt, steps.length, issues.length, issues.filter((i) => i.blocking).length]);
    if (hk !== headKey) {
      headKey = hk;
      const hadFocus = head.contains(document.activeElement);
      renderHead(head, r, steps, issues);
      if (hadFocus) document.getElementById("page-title")?.focus({ preventScroll: true });
    }

    if (!running && !actionsSlot.hasChildNodes()) replaceChildren(actionsSlot, reportActions(r));

    // Live status
    if (running) {
      liveRegion.className = "live-banner is-running";
      replaceChildren(
        liveRegion,
        h("span", { class: "radar", "aria-hidden": "true" }, h("span"), h("span")),
        h(
          "span",
          { class: "live-text" },
          h("strong", {}, "The agent is listening…"),
          " ",
          steps.length ? `Step ${steps.length}: ${actionText(steps.at(-1).action)}` : "Opening the page and listening to it.",
        ),
      );
    } else if (sawRunning) {
      liveRegion.className = "live-banner is-done sr-only";
      replaceChildren(
        liveRegion,
        `Test finished: ${statusLabel(r.status)}.${typeof r.score === "number" ? ` Score ${Math.round(r.score)} out of 100.` : ""} ${issues.length} ${issues.length === 1 ? "blind spot" : "blind spots"} found.`,
      );
    } else {
      liveRegion.className = "live-banner sr-only";
    }

    // Issues
    const ik = JSON.stringify(issues);
    if (ik !== issuesKey) {
      issuesKey = ik;
      renderIssues(issues, steps, running);
    }

    // Steps: append new ones, replace changed ones, keep the rest untouched
    // (so scroll positions and a playing "Listen" survive polling).
    steps.forEach((step, pos) => {
      const key = JSON.stringify(step);
      const stepIssues = issuesForStep(issues, step);
      const issueKey = stepIssues.map((i) => `${i.id}:${i.severity}:${i.title}`).join("|");
      const existing = stepNodes.get(pos);
      if (existing && existing.key === key) {
        // Only the issues found at this step changed: update that list in place.
        if (existing.issueKey !== issueKey) {
          replaceChildren(existing.node.querySelector(".step-issues-slot"), stepIssueLinks(stepIssues, pos + 1));
          existing.issueKey = issueKey;
        }
        return;
      }
      const node = renderStep(r.id ?? id, step, pos, stepIssues, existing ? false : !first);
      if (existing) existing.node.replaceWith(node);
      else stepsList.append(node);
      stepNodes.set(pos, { key, issueKey, node });
    });
    for (const [pos, { node }] of stepNodes) {
      if (pos >= steps.length) {
        node.remove();
        stepNodes.delete(pos);
      }
    }
    stepsCount.textContent = steps.length ? String(steps.length) : "";
    stepsRole.textContent = steps.length ? listRole(steps.length) : "list";

    if (running) {
      replaceChildren(
        stepsTail,
        h(
          "div",
          { class: "step-pending", "aria-hidden": "true" },
          h("span", { class: "step-num" }, String(steps.length + 1)),
          h("span", { class: "typing" }, h("span"), h("span"), h("span")),
          h("span", {}, "Listening to the page and deciding what to do…"),
        ),
      );
    } else {
      replaceChildren(stepsTail, steps.length ? null : emptyState("No steps recorded", "The run ended before the agent took any action."));
    }

    document.title = `${running ? "Running" : statusLabel(r.status)}: ${r.task ?? "report"} · BlindSpot`;
  }

  function renderIssues(issues, steps, running) {
    const sorted = sortIssues(issues);
    issuesCount.textContent = issues.length ? String(issues.length) : "";
    issuesRole.textContent = issues.length ? listRole(issues.length) : "list";
    const counts = countBySeverity(issues);
    replaceChildren(
      severitySummary,
      SEVERITY_ORDER.filter((s) => counts[s]).map((s) => h("span", { class: `sev-count sev-${s}` }, h("strong", {}, String(counts[s])), ` ${s}`)),
    );
    if (!sorted.length) {
      replaceChildren(
        issuesBody,
        running
          ? emptyState("No blind spots yet", "They appear here as the agent finds them.")
          : emptyState("No blind spots found", "The agent did not report any barrier on this task."),
      );
      return;
    }
    replaceChildren(issuesBody, h("ol", { class: "issues", role: "list" }, sorted.map((i, k) => renderIssue(i, steps, k + 1))));
  }

  tick();

  return {
    destroy() {
      alive = false;
      clearTimeout(timer);
      stopSpeaking();
    },
  };
}

function jumpTo(targetId) {
  return (e) => {
    e.preventDefault(); // keep the hash route intact
    const el = document.getElementById(targetId);
    if (!el) return;
    el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    el.focus({ preventScroll: true });
  };
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function issuesForStep(issues, step) {
  return issues.filter((i) => i.stepIndex === step.index);
}

function stepPosition(steps, stepIndex) {
  const pos = steps.findIndex((s) => s.index === stepIndex);
  return pos === -1 ? null : pos;
}

// ---------------------------------------------------------------- header

function renderHead(head, r, steps, issues) {
  const blocking = issues.filter((i) => i.blocking).length;
  const took = duration(r.startedAt, r.finishedAt);
  const started = relativeTime(r.startedAt);
  const urlIsHttp = /^https?:\/\//i.test(r.url ?? "") || String(r.url ?? "").startsWith("/");
  // The static demo ships a copy of the demo sites: link to it instead of the localhost server the run used.
  const siteHref = (STATIC_MODE && demoSiteHref(r.url)) || r.url;

  replaceChildren(
    head,
    h(
      "div",
      { class: "head-main" },
      announce("heading level 1", h("h1", { id: "page-title", tabindex: "-1" }, quoted(r.task || "Untitled task"))),
      h(
        "p",
        { class: "head-url" },
        urlIsHttp
          ? h("a", { href: siteHref, target: "_blank", rel: "noopener noreferrer" }, prettyUrl(r.url), h("span", { class: "sr-only" }, " (opens in a new tab)"))
          : prettyUrl(r.url),
      ),
    ),
    h("div", { class: "head-score" }, h("p", { class: "gauge-caption" }, "Screen reader score"), scoreGauge(r.score, r.status)),
    h(
      "ul",
      { class: "head-stats", role: "list" },
      h("li", { class: "stat stat-status" }, h("span", { class: "stat-label" }, "Result"), h("span", { class: "stat-value" }, statusBadge(r.status))),
      stat(String(steps.length), steps.length === 1 ? "Step" : "Steps"),
      stat(String(issues.length), issues.length === 1 ? "Blind spot" : "Blind spots"),
      stat(String(blocking), "Blocking", blocking ? "bad" : ""),
      took ? stat(took, "Duration") : null,
      started ? h("li", { class: "stat stat-time" }, h("span", { class: "stat-label" }, "Started"), h("span", { class: "stat-value" }, h("time", { datetime: r.startedAt }, started))) : null,
      r.model ? h("li", { class: "stat stat-model" }, h("span", { class: "stat-label" }, "Agent"), h("span", { class: "stat-value" }, r.model)) : null,
    ),
    r.status === "error" && r.error ? errorBox("The run stopped with an error.", r.error) : null,
    r.summary
      ? h(
          "figure",
          { class: "summary" },
          h("figcaption", {}, "The agent's verdict"),
          h("blockquote", {}, h("p", {}, r.summary)),
        )
      : null,
  );
}

function stat(value, label, tone = "") {
  return h("li", { class: `stat${tone ? ` stat-${tone}` : ""}` }, h("span", { class: "stat-label" }, label), " ", h("strong", { class: "stat-value" }, value));
}

// ---------------------------------------------------------------- issues

function renderIssue(issue, steps, n) {
  const pos = stepPosition(steps, issue.stepIndex);
  const titleId = `issue-${cssId(issue.id)}-title`;
  return h(
    "li",
    {
      class: `issue sev-${issue.severity}${issue.blocking ? " is-blocking" : ""}`,
      id: `issue-${cssId(issue.id)}`,
      tabindex: "-1",
    },
    h(
      "article",
      { "aria-labelledby": titleId },
      h(
        "div",
        { class: "issue-top" },
        h("span", { class: "issue-num", "aria-hidden": "true" }, String(n).padStart(2, "0")),
        severityLabel(issue),
        h("span", { class: `source source-${issue.source}` }, issue.source === "scan" ? "Automated scan" : "Found by agent"),
        pos !== null
          ? h(
              "a",
              { class: "issue-step", href: `#step-${pos + 1}`, onclick: jumpTo(`step-${pos + 1}`) },
              `Step ${pos + 1}`,
              h("span", { class: "sr-only" }, ", go to this step"),
            )
          : null,
      ),
      h("h3", { id: titleId, class: "issue-title" }, issue.title),
      h("p", { class: "issue-desc" }, issue.description),
      h(
        "dl",
        { class: "issue-meta" },
        issue.wcag?.length
          ? h("div", {}, h("dt", {}, "WCAG 2.2"), h("dd", {}, h("ul", { class: "chips", role: "list" }, issue.wcag.map((c) => h("li", {}, wcagChip(c))))))
          : null,
        issue.element
          ? h(
              "div",
              {},
              h("dt", {}, "Element"),
              h("dd", {}, elementChip(issue.element), issue.element.html ? h("code", { class: "el-html" }, issue.element.html) : null),
            )
          : null,
      ),
      issue.fix ? fixBlock(issue.fix, issue.blocking) : null,
    ),
  );
}

function fixBlock(fix, blocking) {
  const status = h("span", { class: "copy-status", role: "status" });
  const copyBtn = h(
    "button",
    {
      type: "button",
      class: "btn btn-ghost btn-sm",
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(fix);
          status.textContent = "Copied";
        } catch {
          status.textContent = "Copy failed";
        }
        setTimeout(() => (status.textContent = ""), 2000);
      },
    },
    icon("copy"),
    "Copy fix",
  );
  const code = h("pre", { class: "fix-code", tabindex: "0" }, h("code", {}, fix));
  const actions = h("div", { class: "fix-actions" }, status, copyBtn);
  // Blocking issues show their fix right away; the others keep it one click away.
  if (blocking) {
    return h("div", { class: "fix" }, h("div", { class: "fix-head" }, h("p", { class: "fix-label" }, "How to fix"), actions), code);
  }
  return h(
    "details",
    { class: "fix" },
    h("summary", {}, "How to fix"),
    code,
    h("div", { class: "fix-foot" }, actions),
  );
}

function cssId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, "_");
}

// ---------------------------------------------------------------- steps

function renderStep(reportId, step, pos, stepIssues, isNew) {
  const n = pos + 1;
  const action = step.action ?? {};
  const failed = step.ok === false;
  const titleId = `step-${n}-title`;

  return h(
    "li",
    {
      class: `step${failed ? " is-failed" : ""}${action.type === "finish" ? " is-finish" : ""}${isNew ? " is-new" : ""}`,
      id: `step-${n}`,
      tabindex: "-1",
      "aria-labelledby": titleId,
    },
    h("div", { class: "step-rail", "aria-hidden": "true" }, h("span", { class: "step-num" }, String(n).padStart(2, "0"))),
    h(
      "div",
      { class: "step-card card" },
      h(
        "div",
        { class: "step-head" },
        h("span", { class: "step-num-inline", "aria-hidden": "true" }, `step ${n}`),
        h("h3", { class: "step-title", id: titleId }, h("span", { class: "sr-only" }, `Step ${n}: `), actionSentence(action)),
        h(
          "span",
          { class: `badge ok-badge ${failed ? "is-fail" : "is-ok"}` },
          icon(failed ? "cross" : "check"),
          failed ? "Failed" : action.type === "finish" ? "Done" : "OK",
        ),
      ),
      h(
        "dl",
        { class: "step-facts" },
        step.reason ? h("div", { class: "fact" }, h("dt", {}, "Agent's reasoning"), h("dd", { class: "reason" }, step.reason)) : null,
        step.result ? h("div", { class: `fact${failed ? " fact-fail" : ""}` }, h("dt", {}, "Result"), h("dd", { class: "result" }, step.result)) : null,
      ),
      h("div", { class: "step-issues-slot" }, stepIssueLinks(stepIssues, n)),
      h(
        "div",
        { class: "compare" },
        hearPane(step, n),
        seePane(reportId, step, n),
      ),
      step.url ? h("p", { class: "step-url" }, h("span", { class: "sr-only" }, "Page: "), prettyUrl(step.url)) : null,
    ),
  );
}

function stepIssueLinks(stepIssues, n) {
  if (!stepIssues.length) return null;
  return h(
    "ul",
    { class: "step-issues", role: "list", "aria-label": `Blind spots found at step ${n}` },
    stepIssues.map((i) =>
      h(
        "li",
        {},
        h(
          "a",
          { href: `#issue-${cssId(i.id)}`, class: `step-issue sev-${i.severity}`, onclick: jumpTo(`issue-${cssId(i.id)}`) },
          icon("alert"),
          i.title,
        ),
      ),
    ),
  );
}

function actionSentence(action) {
  return actionSegments(action).map((seg) => {
    if ("el" in seg) return elementChip(seg.el);
    if ("value" in seg) return h("q", { class: "value" }, seg.value);
    return seg.text;
  });
}

function seePane(reportId, step, n) {
  const src = screenshotUrl(reportId, step.screenshot, SCREENSHOT_BASE);
  const frame = h("div", { class: "shot-frame" });
  const placeholder = (text) =>
    h("div", { class: "shot-missing" }, icon("image"), h("p", {}, text), h("p", { class: "muted" }, "Screenshots are for humans. The agent never sees them."));

  if (!src) {
    frame.append(placeholder("No screenshot for this step"));
  } else {
    const alt = `Screenshot of the page at step ${n}${step.url ? `, ${prettyUrl(step.url)}` : ""}`;
    const img = h("img", { src, alt, loading: "lazy", decoding: "async" });
    const btn = h(
      "button",
      {
        type: "button",
        class: "shot-btn",
        "aria-label": `Enlarge screenshot of step ${n}`,
        onclick: () => openLightbox({ src, alt, caption: `Step ${n}: what a sighted user sees` }, btn),
      },
      img,
      h("span", { class: "shot-zoom", "aria-hidden": "true" }, icon("expand")),
    );
    img.addEventListener("error", () => btn.replaceWith(placeholder("Screenshot not available")), { once: true });
    frame.append(btn);
  }

  return h(
    "figure",
    { class: "pane pane-see" },
    h(
      "figcaption",
      { class: "pane-head" },
      h("span", { class: "pane-icon" }, icon("eye")),
      h("span", { class: "pane-title" }, "What you see"),
      h("span", { class: "screen-label", "aria-hidden": "true" }, "Screen on"),
    ),
    frame,
  );
}

function hearPane(step, n) {
  const lines = tokenizeTranscript(step.heard ?? "");
  const targetId = step.action?.target?.id;
  const pre = h(
    "pre",
    { class: "transcript", tabindex: "0", "aria-label": `Screen reader transcript at step ${n}` },
    lines.map((line) => {
      const isTarget = typeof targetId === "number" && line.ids.includes(targetId);
      return h(
        "span",
        { class: `t-line${isTarget ? " is-target" : ""}`, style: `--in: ${leadingSpaces(line)}` },
        line.tokens.map((t) => (t.kind === "text" ? t.text : h("span", { class: `t-${t.kind}` }, t.text))),
        isTarget ? h("span", { class: "t-acted" }, " agent acted here") : null,
      );
    }),
  );

  const label = h("span", {}, "Listen");
  const labelSuffix = h("span", { class: "sr-only" }, ` to step ${n}`);
  const btnIcon = h("span", { class: "btn-icon" }, icon("speaker"));
  let playing = false;
  const setPlaying = (on) => {
    playing = on;
    listen.classList.toggle("is-playing", on);
    pre.classList.toggle("is-speaking", on);
    label.textContent = on ? "Stop" : "Listen";
    labelSuffix.textContent = on ? ` reading step ${n}` : ` to step ${n}`;
    replaceChildren(btnIcon, icon(on ? "stop" : "speaker"));
    if (!on) highlightLine(pre, -1);
  };
  const listen = h(
    "button",
    {
      type: "button",
      class: "btn btn-listen btn-sm",
      disabled: !SPEECH_SUPPORTED || !step.heard,
      title: SPEECH_SUPPORTED ? "Read this transcript aloud, like a screen reader, with captions" : "Speech synthesis is not supported in this browser",
      onclick: () => {
        if (playing) {
          stopSpeaking();
        } else if (speak(step.heard, () => setPlaying(false), (index) => highlightLine(pre, index))) {
          setPlaying(true);
        }
      },
    },
    btnIcon,
    label,
    labelSuffix,
  );

  return h(
    "figure",
    { class: "pane pane-hear" },
    h(
      "figcaption",
      { class: "pane-head" },
      h("span", { class: "pane-icon" }, icon("ear")),
      h("span", { class: "pane-title" }, "What a screen reader user hears"),
      listen,
    ),
    step.heard ? pre : h("div", { class: "transcript transcript-empty" }, "Nothing was announced."),
  );
}

/** Number of leading spaces of a tokenized transcript line (its depth in the tree). */
function leadingSpaces(line) {
  return line.tokens.map((t) => t.text).join("").match(/^ */)[0].length;
}

/**
 * Captions for Listen: mark transcript line `index` as the one being spoken (-1 clears) and scroll it into view
 * inside the transcript panel only, never the page. Exported so the highlight can be shown without speech.
 */
export function highlightLine(pre, index) {
  pre.querySelector(".t-line.is-current")?.classList.remove("is-current");
  const line = index >= 0 ? pre.querySelectorAll(".t-line")[index] : null;
  if (!line) return;
  line.classList.add("is-current");
  const top = line.offsetTop - pre.clientHeight / 2 + line.offsetHeight / 2;
  pre.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() ? "auto" : "smooth" });
}
