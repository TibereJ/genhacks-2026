# Devpost submission: BlindSpot

_Draft written by the pitch-writer agent from the code in `src/`, `report-ui/` and `demo-site/`. Copy each section
into the matching Devpost field. Track: **AI, Agentic Systems, Cybersecurity, and Dev Tools**._

- **Project name:** BlindSpot
- **Tagline (≤ 60 chars):** An AI agent that uses your site the way a blind person does
- **Code:** https://github.com/TibereJ/genhacks-2026
- **Video:** _YouTube or Vimeo link, embedding enabled_

---

## Inspiration

Picture someone who is blind and needs to see a doctor. They open the clinic's website with their screen reader,
pick the doctor, pick the date, and then reach the time slots. The screen reader reads "9:00, 10:30, 14:00", and
nothing happens. The times look like buttons on screen, but for assistive technology they are just text. There is
no way to select one. The only way out is to call the clinic, which is exactly what online booking was supposed
to make unnecessary.

The WHO estimates that at least 2.2 billion people live with a near or distance vision impairment, and WebAIM's
yearly survey of the top one million home pages keeps finding detectable WCAG failures on the vast majority of
them. Developers do have tools: Lighthouse and axe catch rule violations like "this button has no name". But a
list of rule violations does not answer the question a product team actually cares about: **can a screen reader
user finish signing up, paying, or booking?**

I wanted a tool that answers that question directly, by trying.

## What it does

**Lighthouse checks rules. BlindSpot checks whether a blind person can actually use your site.**

You give BlindSpot a URL and a task in plain language, for example *"Book an appointment with Dr. Lee for any
available time, as Alex Doe, alex@example.com"*. An AI agent then tries to complete the task **using only what a
screen reader announces**. It never sees the page, no pixels, no HTML.

- **The agent hears a transcript, not a screenshot.** BlindSpot reads Chromium's accessibility tree and turns it
  into a numbered transcript in reading order: `heading level 1 "Book an appointment"`, `[5] combobox ""`,
  `text "9:00"`, `[9] button ""`. Only operable elements get a number, so plain text cannot be clicked, exactly
  like for a real screen reader user.
- **It does the real task.** The agent clicks, types, picks from drop-downs, presses keys (Tab, Enter, arrows…)
  and goes back. After each action it hears what a screen reader user would notice: a new page, an announced
  alert, a focus move, or "Nothing was announced".
- **It reports like an accessibility auditor.** Every barrier becomes an issue with a severity, whether it blocks
  the task, the WCAG 2.2 success criteria, and a concrete code fix. A deterministic scan runs on every page in
  parallel (unnamed buttons, links and fields, images without alt, clickable `<div>`s, skipped heading levels,
  placeholder-only fields, missing page language or title).
- **A score for the journey**, not for the markup: 100 if the task succeeded, 40 if not, minus penalties per issue.
- **A report you can read, and hear.** The web UI follows the run live: every step shows why the agent acted,
  what it heard, and a screenshot for sighted readers with the target element outlined. The **Listen** button
  reads the transcript aloud, so a developer can hear what their page sounds like. Reports export as Markdown or
  copy straight into a GitHub issue.
- **Before / after comparison.** Two runs of the same task side by side: score delta, and issues split into
  Fixed, Still present and New.
- **Three ways to run the agent:**
  1. the **Claude API** (default model `claude-opus-5-5`, configurable with `BLINDSPOT_MODEL`);
  2. an **MCP server**, so Claude Code (or any MCP client) becomes the screen reader user. The repo's `.mcp.json`
     makes Claude Code load it automatically;
  3. a **scripted demo** with no API key, fully deterministic, used in CI.
- **CI mode.** Describe the journeys that must keep working in `blindspot.config.json`; a GitHub Actions job
  fails the build when one becomes impossible for a screen reader user or its score drops below a threshold.
  BlindSpot runs it on its own repository on every push.

**The demo.** *Maple Grove Clinic* is a fictional clinic site in two versions that are **pixel-identical** (a test
compares byte-equal screenshots of every page and state). When Claude played the screen reader user on the
inaccessible version, it was **blocked after 12 steps, score 0/100, 15 issues**. The blocking issue: *"Time slots
cannot be selected"*. The slots are clickable `<div>`s, so they are announced as plain text, and pressing Tab
jumps from the date field straight to "Full name". When it submitted anyway, the red "Please choose a time slot"
error was never announced. On the fixed version, which looks exactly the same, the same agent **booked the
appointment: score 100/100, 0 issues**.

## How we built it

I built BlindSpot solo, with Claude Code as my team: one session acted as project lead and delegated to
specialised agents defined in `.claude/agents/` (builders working on independent features, a reviewer checking
bugs and OWASP Top 10 issues before each merge, and the pitch writer that drafted this page). Everything is in
TypeScript on Node.js.

- **Hearing the page.** Playwright drives Chromium, and BlindSpot calls the Chrome DevTools Protocol
  (`Accessibility.getFullAXTree`) directly. `src/core/ax-tree.ts` walks the tree like a screen reader: it keeps
  landmarks, headings, text, images and controls, flattens layout wrappers, prints states (`checked`, `required`,
  `invalid entry`, `unavailable`, focus), lists the options of drop-downs, collects live regions, and gives each
  operable element a short-lived id.
- **Acting like a screen reader user.** `src/core/browser.ts` resolves each id back to its DOM node and triggers
  the element's own default action, rather than clicking screen coordinates. After the page settles it takes a
  new snapshot and describes the difference: new page, announced alerts, focus moves, or nothing.
- **The agent loop.** `src/core/agent.ts` sends the transcript to a "brain", validates every tool call with zod,
  allows one action per turn (ids change after every action), records issues, screenshots each step for humans,
  runs the scan on each new page, and saves the report after every change so the UI can follow it live.
- **The brains.** The Claude brain uses tool use with strict JSON schemas, prompt caching (the transcript history
  grows at every step, so only the new part is paid for), and explicit handling of refusals and truncated
  answers. The external brain turns the loop inside out: another agent sends one tool call at a time, which powers
  both the MCP server (`src/mcp.ts`, built with the official MCP TypeScript SDK) and an HTTP agent API. The
  scripted brain follows a fixed plan and makes the demo and CI reproducible without a key.
- **Reports.** A static web UI in plain JavaScript (no framework, no build step), itself built to be accessible:
  skip link, real headings and labels, live regions for status messages. The **Listen** button uses the browser's
  Web Speech API, one utterance per line. The Markdown export escapes everything, because report text comes from
  arbitrary websites and from the AI.
- **CI and deployment.** A zod-validated config, a Markdown summary written to the GitHub job summary, clear exit
  codes, a GitHub Actions workflow, and a Dockerfile on the official Playwright image. A public instance mode
  refuses private and internal addresses (SSRF) and keeps the Claude agent off unless explicitly allowed.
- **Tests.** vitest suites cover the transcript builder, the agent loop, the MCP server, the CI mode, the
  Markdown export, the URL guard, the UI helpers, and the demo site itself (the bad version must expose each
  documented barrier, the fixed one must be bookable with accessible names only, and both must look identical).

## Challenges we ran into

- **Making the agent honest.** It would be easy for an AI to "cheat" by guessing from page structure it should
  not have. The transcript only numbers operable elements, actions go through the accessibility tree only, and
  the MCP server explicitly tells the client not to fetch the HTML, read the source or take screenshots.
- **Ids that do not survive.** Accessibility node ids change after every navigation, and the agent may send
  several tool calls in one turn. BlindSpot resets the DOM bookkeeping on each snapshot, ties every id to the
  transcript it came from, and refuses a second action in the same turn, telling the agent to read the new
  transcript first.
- **Native widgets.** Date inputs are composite widgets that take keyboard input in locale order. The agent types
  a date in `YYYY-MM-DD` and BlindSpot sets it the way a completed keyboard entry would.
- **A before/after that is a fair test.** The two clinic versions had to be pixel-identical so that the video
  proves the point: the problem is invisible. That meant visually hidden labels and keeping identical CSS, with a
  test comparing screenshots byte for byte, and documenting the one compromise this forces on the fixed version.
- **Code injected into the page.** The TypeScript runner can inject helper functions into code sent to the
  browser, where they do not exist, which breaks in-page checks. The DOM checks are passed to the page as a plain
  JavaScript string instead.
- **Security of a tool that browses for you.** A server that opens any URL in a real browser is an SSRF risk and a
  way to spend someone's API key. Public mode blocks private, loopback, link-local and IPv4-mapped IPv6 addresses
  and disables the Claude agent by default. The remaining gaps (redirects, DNS rebinding) are documented in
  `docs/DEPLOY.md` rather than hidden.

## Accomplishments that we're proud of

- **It works end to end on a realistic flow**: from a URL and a sentence to a report with the blocking issue, the
  WCAG criteria and the fix. Same agent, two identical-looking sites: **0/100 blocked vs 100/100 booked**.
- **The agent found what a rule checker would not phrase this way**: not "element has a click handler" but "a
  blind patient cannot book an appointment, because the times are text and Tab skips them", plus an error message
  nobody would ever hear.
- **The Listen button.** Hearing `button ""` read aloud explains accessibility to a developer better than a
  paragraph of documentation.
- **MCP integration.** Any MCP-capable assistant can become the tester, with BlindSpot keeping the test honest
  and writing the report.
- **Accessibility as a CI check** on real user journeys, running on this repository on every push.
- **Reproducibility.** The scripted brain gives the same blocked/success result every time, with no API key.

## What we learned

- The accessibility tree is the real interface for screen reader users, and it can be completely different from
  what you see: two pixel-identical pages can be one usable and one impossible.
- Framing matters: "15 issues" is easy to postpone; "a blind patient cannot book" is not. Task-based testing
  turns accessibility from a checklist into a product bug.
- Designing tools for an AI agent is interface design: small, strict tools, short-lived ids, results phrased as
  what a person would notice, and a system prompt that sets the rules of the role.
- Working with a team of AI agents (builders in parallel, a reviewer before each merge) is fast, but the human
  still has to own the plan and the integration.

## What's next

- **More real-world journeys**: sign-up, checkout and search flows on real sites, and more demo sites.
- **Closer to real screen readers**: browse mode and heading or landmark navigation commands, and checking
  results against NVDA and VoiceOver.
- **Other journeys and disabilities**: a keyboard-only mode, low-vision zoom, and voice control.
- **A ready-to-use GitHub Action** that comments the report on each pull request.
- **A hosted version** with authentication, so teams can test their staging sites without installing anything.

## Built with

- **Claude Code** (Anthropic): AI coding agents used to write part of the project (a project-lead session plus
  builder, reviewer and pitch-writer agents)
- **Claude API** (Anthropic, model `claude-opus-5-5` by default): the brain of the BlindSpot agent, through tool use
- **Model Context Protocol**, `@modelcontextprotocol/sdk`: the MCP server that lets Claude Code act as the agent
- TypeScript, Node.js 22, HTML, CSS, JavaScript
- `@anthropic-ai/sdk`: official Claude API SDK
- `playwright` + Chromium: browser automation
- Chrome DevTools Protocol (`Accessibility.getFullAXTree`): the accessibility tree
- `zod`: validation of the agent's tool inputs and of `blindspot.config.json` (CI mode)
- `tsx`, `typescript`, `vitest`: running, type checking, tests
- Web Speech API (built into browsers): the Listen button
- **GitHub Actions**: `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`
- **Docker**, official Playwright image `mcr.microsoft.com/playwright:v1.63.0-noble` (Microsoft)
- WCAG 2.2 (W3C): the success criteria cited in the reports

Devpost "Built with" tags: `typescript` `node.js` `claude` `anthropic` `claude-code` `mcp` `playwright` `chromium`
`zod` `vitest` `github-actions` `docker` `html` `css` `javascript` `web-speech-api` `wcag`

---

# Demo video script

Target length **2:45** (hard limit 3:00). About 380 spoken words. Speak calmly; let the Listen audio play.

Judging criteria in mind: **Impact** (the patient, 0 → 100), **Technical execution** (live run, real transcript,
MCP, CI), **Creativity** (the agent hears, never sees; Listen), **Presentation** (one story, one flow).

| Time | On screen | Voiceover |
|---|---|---|
| **0:00–0:18** | Black screen, then the bad clinic's booking page (`/demo/bad/book.html`), full screen. Caption: *"Maple Grove Clinic (fictional)"*. | "Meet Sam. Sam is blind, and needs to see a doctor. Sam's screen reader can reach this booking form. Can Sam actually book? Nobody at the clinic knows, because nobody has tried." |
| **0:18–0:30** | Split screen: `/demo/bad/book.html` left, `/demo/fixed/book.html` right. Click a time slot on each side: both turn the same color. Caption: *"Pixel-identical. Different accessibility tree."* | "These two versions of the site are pixel-identical. For a mouse user they behave the same. One of them is a dead end for Sam." |
| **0:30–0:42** | BlindSpot home at `localhost:3000`. Hover over the headline. Click **Demo: inaccessible clinic**: URL and task fill in. Agent: **Claude (AI agent)**. Click **Run test**. | "This is BlindSpot. I give it a site and a task: book with Dr. Lee as Alex Doe. An AI agent will try it using only what a screen reader announces. It never sees the page." |
| **0:42–1:05** | Live report: steps appear one by one (caption *"sped up"* if accelerated). Open the step on the booking form and click **Listen**. Let 4–5 seconds of the transcript play: *"…combobox… Date… Available times, 9:00, 10:30…"*. | "Each step shows what the agent heard and why it acted. Let's listen to the booking form the way Sam hears it." *(pause for audio)* "The times are there, but only as text. Nothing to press." |
| **1:05–1:25** | Scroll to the step where the agent pressed Tab: result *Focus moved to textbox "Full name"*. Then the final header: **Blind user blocked**, score gauge **0**. Agent's verdict quote. | "The agent tries the keyboard: Tab jumps from the date straight to the name field. It even submits the form, and the error message, 'Please choose a time slot', is never announced. Verdict: blocked. Score zero." |
| **1:25–1:42** | Issues list: the top card **Critical · Blocks the task · Found by agent**, *"Time slots cannot be selected"*, WCAG chips 2.1.1 / 4.1.2, the **How to fix** radio group snippet. Briefly show an **Automated scan** badge on another issue. | "Every issue comes with the WCAG criteria and the fix: here, a real radio group. A deterministic scan runs alongside and catches the classic problems, like buttons with no name." |
| **1:42–1:55** | Back to **All runs**. Click **Demo: fixed clinic**, **Run test**. Fast-forward to **Task completed**, score **100**, the agent's verdict, and the last step's transcript showing the heading *"Appointment confirmed"*. | "Same agent, the fixed site, which looks exactly the same: appointment booked. One hundred out of a hundred." |
| **1:55–2:05** | On the fixed report: **Compare with…** → pick the bad run → **Compare**. Compare view: **Before 0 → After 100**, "+100 points", the **Fixed** list. | "Before and after: from zero to a hundred, and every issue that was fixed." |
| **2:05–2:20** | Quick cuts. (1) Claude Code in the repo terminal: prompt *"Use BlindSpot to test /demo/bad/index.html…"*, tool calls `blindspot_start`, `blindspot_click`… scroll by. (2) GitHub Actions run of the **BlindSpot** workflow: job summary table, fixed journey passed, bad journey blocked. | "BlindSpot is also an MCP server, so Claude Code itself can play the screen reader user. And in CI, it fails the build the day a journey stops working for blind users." |
| **2:20–2:35** | Architecture diagram (one slide, see below). Highlight each box as it is named. | "Under the hood: Playwright opens Chromium, BlindSpot turns the accessibility tree into a numbered transcript, and Claude acts through tools that only allow what a screen reader user can do. A scan and a scored report come out the other end." |
| **2:35–2:45** | Back to the split screen of the two clinics, then the BlindSpot logo and the repo URL `github.com/TibereJ/genhacks-2026`. | "Lighthouse checks rules. BlindSpot checks whether Sam can actually book. Next: more real sites, real screen reader comparisons, and a pull request check for every team. Thanks for watching." |

### Architecture slide (2:20)

```
  URL + task
      │
  Playwright → Chromium ── CDP getFullAXTree ──► accessibility tree
                                                      │
                                   numbered screen reader transcript
                                   [5] combobox ""   text "9:00"
                                                      │
          deterministic scan ◄────────────┬───────────┤
                                          │           ▼
                                          │   Agent: Claude API · Claude Code (MCP) · scripted
                                          │   tools: click · type · select · press key · back
                                          │          report_issue · finish
                                          ▼
                     Report: status · score · steps (heard / did) · issues + WCAG + fix
                     → web UI (Listen, compare) · Markdown / GitHub issue · CI summary
```

### Recording without an API key

The draft cut (`blindspot-demo-draft.mp4`, made from Playwright recordings of the real app) uses the example
reports in `examples/reports/` and a scripted demo run, so it needs no API key. For the live AI part, record
Claude Code driving BlindSpot through MCP on your own machine (prompt below) while the BlindSpot UI shows the
live report; that is a real agent run paid by your Claude subscription.

Prompt for Claude Code, in the repo folder (approve the `blindspot` MCP server when asked, and keep `npm start`
running in another terminal so the live report shows at http://localhost:3000):

> Use the BlindSpot MCP tools to test /demo/bad/index.html with the task "Book an appointment with Dr. Lee for any
> available time. Use the name Alex Doe and the email alex@example.com." Act only on what the transcript tells
> you, report every barrier with blindspot_report_issue, and finish when done or blocked.

### Recording checklist

1. **Fresh reports folder** so "Recent runs" only shows the demo:
   `mv reports reports-before-video` (or start the server with `BLINDSPOT_REPORTS_DIR=reports-video`).
2. **Dry run first.** Run both clinics once with the Claude agent in a throwaway folder
   (`BLINDSPOT_REPORTS_DIR=reports-dryrun npm start`) and check that the result matches the script: blocked on the
   bad clinic with "Time slots cannot be selected", success on the fixed one. Claude can take a slightly different
   path each run; adjust the voiceover (Tab step, validation error, step count) to what the recorded run shows.
3. **Start the server** with the API key: `.env` contains `ANTHROPIC_API_KEY`, then `npm start`.
   Fallback without a key: choose **Scripted demo (no API key)**. It gives the same blocked / success outcome but
   stops at the time slots, so cut the lines about the Tab key and the unannounced error message.
4. **Browser:** Chrome, 1920×1080 window, **zoom 125%**, bookmarks bar hidden, notifications off, one window with
   three tabs: `localhost:3000/demo/bad/book.html`, `localhost:3000/demo/fixed/book.html`, `localhost:3000`.
5. **Sound:** check that an English system voice is installed (the Listen button uses the browser's speech
   synthesis) and that screen capture records system audio.
6. **Clicks, in order:** **Demo: inaccessible clinic** → Agent **Claude (AI agent)** → **Run test** → open the
   booking-form step → **Listen** (click again to **Stop**) → **All runs** → **Demo: fixed clinic** → **Run test**
   → on the fixed report **Compare with…** → **Compare** (or tick both runs on the home page and click
   **Compare selected**).
7. **Speed:** a Claude run takes a while. Speed it up in editing and show a *"sped up"* caption; keep the Listen
   audio at normal speed.
8. **MCP clip:** open Claude Code in the repo (approve the `blindspot` MCP server on first use), keep the server
   running so the report appears in the UI, paste the prepared prompt. Record only 5–8 seconds.
9. **CI clip:** open a finished run of the **BlindSpot** workflow on GitHub and show the job summary table.
10. **Upload** to YouTube or Vimeo, **embedding enabled**, and paste the link at the top of this file and on Devpost.
