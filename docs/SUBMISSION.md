# Devpost submission: BlindSpot

_Written by the pitch-writer agent from the code in `src/`, `report-ui/`, `demo-site/` and the reports in
`examples/reports/`. Copy each section into the matching Devpost field. Track: **AI, Agentic Systems,
Cybersecurity, and Dev Tools**._

- **Project name:** BlindSpot
- **Tagline (≤ 60 chars):** An AI agent that uses your site the way a blind person does
- **Code:** https://github.com/TibereJ/genhacks-2026
- **Live demo (read-only):** https://tiberej.github.io/genhacks-2026/
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
screen reader announces**. It never sees the page: no pixels, no HTML.

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
- **An honest verdict.** Each run ends as *success* (the site confirmed the task), *blocked* (the site stopped a
  screen reader user), *inconclusive* (a CAPTCHA, bot check or login wall stopped the test: no score, because it
  is not an accessibility verdict), *step limit* or *error*. BlindSpot never tries to bypass a CAPTCHA.
- **A score for the journey**, not for the markup: 100 if the task succeeded, 40 if not, minus penalties per issue.
- **A report you can read, and hear.** The web UI follows the run live: every step shows why the agent acted,
  what it heard, and a screenshot for sighted readers with the target element outlined. The **Listen** button
  reads the transcript aloud, so a developer can hear what their page sounds like. Reports export as Markdown or
  copy straight into a GitHub issue.
- **Before / after comparison.** Two runs of the same task side by side: score delta, and issues split into
  Fixed, Still present and New.
- **Three ways to run the agent:**
  1. the **Claude API** (default model `claude-opus-5-5`, configurable with `BLINDSPOT_MODEL`);
  2. an **external agent**: through the **MCP server**, Claude Code (or any MCP client) becomes the screen reader
     user, and the repo's `.mcp.json` makes Claude Code load it automatically; the same tools are also exposed as
     an HTTP agent API;
  3. a **scripted demo** for the two demo sites, with no API key, fully deterministic, used in CI.
- **CI mode.** Describe the journeys that must keep working in `blindspot.config.json`; a GitHub Actions job
  fails the build when one becomes impossible for a screen reader user, when its score drops below a threshold,
  or when the run is inconclusive (nothing was verified). BlindSpot runs four journeys on its own repository on
  every push.
- **A live demo.** A read-only static build of the UI with all seven example runs is published on GitHub Pages:
  https://tiberej.github.io/genhacks-2026/

**Demo 1: Maple Grove Clinic.** A fictional clinic site in two versions that are **pixel-identical** (a test
compares byte-equal screenshots of every page and state). When Claude played the screen reader user on the
inaccessible version, it was **blocked after 11 steps, score 0/100, 15 issues**. The blocking issue: *"Time slots
cannot be selected"*. The slots are clickable `<div>`s, so they are announced as plain text, and pressing Tab
jumps from the date field straight to "Full name". When it submitted anyway, the red "Please choose a time slot"
error was never announced. On the fixed version, which looks exactly the same, the same agent **booked the
appointment: score 100/100, 0 issues**.

**Demo 2: GreenCart, to show it generalises.** A grocery checkout, also in two pixel-identical versions, with
different barriers: a cookie banner that silently disables every button and whose only control has no name,
quantity and add buttons named just "+" and "Add", cart updates that are never announced, a delivery choice that
never says which option is selected, and a terms checkbox that is a plain `<div>`. Claude was **blocked after
13 steps at the terms checkbox (0/100, 8 issues)** on the inaccessible version and **placed the order (100/100)**
on the fixed one.

**On real websites.** From a cloud sandbox where most sites were blocked, BlindSpot tested the three real public
sites it could reach. On **nodejs.org** ("find the current LTS and the Windows download") the agent succeeded with
**91/100** and reported 3 real, small issues (two different drop-downs both named "Operating System", an open
option list with no name, a focusable code block with no name). On **jsr.io**, the JavaScript Registry ("find the
package @std/path and tell me its latest version"), it succeeded with **78/100** and 4 issues: search result links
with very long, repetitive names (runtime compatibility read twice, an unexplained "100", and the exact match only
third), a header search label announced twice ("Search for packages Search for packages"), a results-page search
field with only a placeholder, and 10 icon-only "copy" buttons after the code examples with no accessible name
(serious). On **pypi.org** the search triggered a bot check:
BlindSpot noted that it offers an audio CAPTCHA, reported that its field label only mentions the image, and ended
the test as **inconclusive** instead of trying to bypass it.

**How these seven runs were made.** Claude, running in Claude Code, was the agent, driving BlindSpot through its
external-agent HTTP API: it only received the transcripts and chose every action and issue itself. The two clinic
reports were re-executed with the same decisions after a fix that merges repeated scan findings across pages, and
the fixed shop was re-run after a scan false positive was fixed. All seven reports ship in the repo
(`npm run examples`) and in the live demo.

## How we built it

I built BlindSpot solo, with Claude Code as my team: one session acted as project lead and delegated to
specialised agents defined in `.claude/agents/` (builders working on independent features, a reviewer checking
bugs and OWASP Top 10 issues before each merge, and the pitch writer that drafted this page). Everything is in
TypeScript on Node.js.

- **Hearing the page.** Playwright drives full headless Chromium, and BlindSpot calls the Chrome DevTools Protocol
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
  both the MCP server (`src/mcp.ts`, built with the official MCP TypeScript SDK) and the HTTP agent API. The
  scripted brain follows a fixed plan per demo site and makes the demo and CI reproducible without a key.
- **Reports.** A static web UI in plain JavaScript (no framework, no build step), itself built to be accessible:
  skip link, real headings and labels, live regions for status messages. The **Listen** button uses the browser's
  Web Speech API, one utterance per line. The Markdown export escapes everything, because report text comes from
  arbitrary websites and from the AI. `src/build-static.ts` turns the same UI and the example reports into the
  read-only site deployed to GitHub Pages.
- **CI and deployment.** A zod-validated config, a Markdown summary written to the GitHub job summary, clear exit
  codes, a GitHub Actions workflow, and a Dockerfile on the official Playwright image.
- **Security.** A security review led to: the server listening on `127.0.0.1` by default, JSON-only and
  same-origin checks on every `POST` (CSRF), and a public-instance mode with an SSRF guard on every request the
  test browser makes, including each hop of a redirect chain, the external agent API turned off, and the Claude
  agent disabled unless explicitly allowed.
- **Tests.** vitest suites cover the transcript builder, the agent loop, the scan, the Claude and external
  brains, the MCP server, the HTTP server, the CI mode, the Markdown export, the compare view, the URL guard, the
  UI helpers, the static build, and both demo sites (each bad version must expose its documented barriers, each
  fixed one must be usable with accessible names only, and both versions must look identical).

## Challenges we ran into

- **Making the agent honest.** It would be easy for an AI to "cheat" by guessing from page structure it should
  not have. The transcript only numbers operable elements, actions go through the accessibility tree only, and
  the MCP server explicitly tells the client not to fetch the HTML, read the source or take screenshots.
- **Ids that do not survive.** Accessibility node ids change after every navigation, and the agent may send
  several tool calls in one turn. BlindSpot resets the DOM bookkeeping on each snapshot, ties every id to the
  transcript it came from, and refuses a second action in the same turn, telling the agent to read the new
  transcript first.
- **A before/after that is a fair test.** Each pair of demo versions had to be pixel-identical so that the video
  proves the point: the problem is invisible. That meant visually hidden labels and identical CSS, with tests
  comparing screenshots byte for byte, and documenting the compromises this forces on the fixed versions.
- **Real websites broke BlindSpot, and that was the useful part.** Testing nodejs.org, jsr.io and pypi.org from
  the sandbox found real bugs in BlindSpot itself:
  - Playwright's lightweight headless shell rejected the sandbox's TLS proxy certificate. BlindSpot now runs full
    headless Chromium by default, which is also closer to real Chrome (`BLINDSPOT_BROWSER_CHANNEL` overrides it).
  - A bot check is neither a success nor an accessibility failure. Calling it "blocked" would have blamed the
    site unfairly, so I added the *inconclusive* status: no score, and a CI failure because nothing was verified.
  - The scan raised false positives on real markup: a styled wrapper around a native checkbox, and an
    `<a tabindex="0">` without `href`. Both are now recognised as operable.
  - Focus moving into a date field (focus lands on its inner part) and onto a heading after a page change was
    not announced to the agent. Both are now reported as focus moves, as a screen reader would.
  - On jsr.io, only the header and footer were read: the whole page sat inside a focusable skip-link target
    (`<div tabindex="-1">`), and the transcript builder treated it as a single control and hid its content.
    Focusable wrappers are now read through.
- **Code injected into the page.** The TypeScript runner can inject helper functions into code sent to the
  browser, where they do not exist, which breaks in-page checks. The DOM checks are passed to the page as a plain
  JavaScript string instead.
- **Security of a tool that browses for you.** A server that opens any URL in a real browser is an SSRF risk and a
  way to spend someone's API key. Beyond the protections above, the remaining gaps (DNS rebinding, WebSockets)
  are documented in `docs/DEPLOY.md` with the network-level fix, rather than hidden.

## Accomplishments that we're proud of

- **It works end to end on realistic flows**: from a URL and a sentence to a report with the blocking issue, the
  WCAG criteria and the fix. Same agent, identical-looking sites: **0/100 blocked vs 100/100 done**, on two
  different sites with different barriers.
- **It works on the real web too**: real successes with real findings on nodejs.org (91/100) and jsr.io
  (78/100), and a principled *inconclusive* on pypi.org's bot check instead of a fake verdict.
- **The agent found what a rule checker would not phrase this way**: not "element has a click handler" but "a
  blind patient cannot book an appointment, because the times are text and Tab skips them", plus an error message
  nobody would ever hear.
- **The Listen button.** Hearing `button ""` read aloud explains accessibility to a developer better than a
  paragraph of documentation.
- **MCP integration.** Any MCP-capable assistant can become the tester, with BlindSpot keeping the test honest
  and writing the report.
- **Accessibility as a CI check** on real user journeys, running on this repository on every push.
- **Reproducibility and transparency.** The scripted brain gives the same blocked/success result every time with
  no API key, and every report shows exactly what the agent heard and did at each step.

## What we learned

- The accessibility tree is the real interface for screen reader users, and it can be completely different from
  what you see: two pixel-identical pages can be one usable and one impossible.
- Framing matters: "15 issues" is easy to postpone; "a blind patient cannot book" is not. Task-based testing
  turns accessibility from a checklist into a product bug.
- Designing tools for an AI agent is interface design: small, strict tools, short-lived ids, results phrased as
  what a person would notice, and a system prompt that sets the rules of the role.
- Demo sites are not enough. Three real websites found more bugs in BlindSpot (TLS, false positives, unannounced
  focus moves, content hidden inside a focusable wrapper, the missing *inconclusive* status) than many runs on my
  own pages.
- Working with a team of AI agents (builders in parallel, a reviewer before each merge) is fast, but the human
  still has to own the plan and the integration.

## What's next

- **More real-world journeys**: sign-up, checkout and search flows on many more real sites, outside a sandbox.
- **Closer to real screen readers**: browse mode and heading or landmark navigation commands, and checking
  results against NVDA and VoiceOver.
- **Other journeys and disabilities**: a keyboard-only mode, low-vision zoom, and voice control.
- **A ready-to-use GitHub Action** that comments the report on each pull request.
- **A hosted version** with authentication, so teams can test their staging sites without installing anything.

## Built with

- **Claude Code** (Anthropic): AI coding agents used to write part of the project (a project-lead session plus
  builder, reviewer and pitch-writer agents), and the agent that played the screen reader user in the example runs
- **Claude API** (Anthropic, model `claude-opus-5-5` by default): the brain of the BlindSpot agent, through tool use
- **Model Context Protocol**, `@modelcontextprotocol/sdk`: the MCP server that lets Claude Code (or any MCP client)
  act as the agent
- TypeScript, Node.js 22, HTML, CSS, JavaScript
- `@anthropic-ai/sdk`: official Claude API SDK
- `playwright` + Chromium: browser automation
- Chrome DevTools Protocol (`Accessibility.getFullAXTree`): the accessibility tree
- `zod`: validation of the agent's tool inputs and of `blindspot.config.json` (CI mode)
- `tsx`, `typescript`, `vitest`: running, type checking, tests
- Web Speech API (built into browsers): the Listen button
- **GitHub Actions**: `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`
- **GitHub Pages**: hosting of the read-only live demo, with `actions/configure-pages@v5`,
  `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`
- **Docker**: `Dockerfile` to deploy the server in a container
- Official Playwright Docker image `mcr.microsoft.com/playwright:v1.63.0-noble` (Microsoft): Node, Chromium and
  its system dependencies
- WCAG 2.2 (W3C): the success criteria cited in the reports

Devpost "Built with" tags: `typescript` `node.js` `claude` `anthropic` `claude-code` `mcp` `playwright` `chromium`
`zod` `vitest` `github-actions` `github-pages` `docker` `html` `css` `javascript` `web-speech-api` `wcag`

---

# Demo video script

The draft cut is **2:39** (Screen off design), captioned, made from Playwright recordings of the real app, with no voiceover yet. The
voiceover below follows its order. Hard limit 3:00: add **only one** optional insert (the ~10 s MCP clip, about 2:50 in total); adding
the architecture slide as well would go over 3:00. Times are approximate: align each line to the draft's captions. About 330 spoken words;
speak calmly and let the Listen audio play.

Judging criteria in mind: **Impact** (Sam, 0 → 100, a real website), **Technical execution** (real agent runs,
real transcript, Listen, compare, a second site, CI), **Creativity** (the agent hears, never sees),
**Presentation** (one person, one story, numbers on screen that match the voice).

| Time | On screen | Voiceover |
|---|---|---|
| **0:00–0:07** | Title card: **BlindSpot**, tagline *"Lighthouse checks rules. BlindSpot checks whether a blind person can actually use your site."* | "Lighthouse checks rules. BlindSpot checks whether a blind person can actually use your site." |
| **0:07–0:20** | Bad clinic (`/demo/bad/book.html`), caption *"Maple Grove Clinic (fictional)"*. The mouse picks Dr. Lee, a date, a time slot: everything looks fine. | "Meet Sam. Sam is blind and needs to see a doctor. This clinic's booking page looks perfectly normal, and with a mouse you can book in ten seconds." |
| **0:20–0:30** | Fixed clinic (`/demo/fixed/book.html`), same actions, caption *"Fixed version: pixel-identical"*. | "This is the fixed version. It looks exactly the same. The only difference is what a screen reader hears." |
| **0:30–0:44** | BlindSpot home at `localhost:3000`: **Demo: inaccessible clinic** fills the URL and task, agent **Scripted demo (no API key)**, **Run test**, first steps appear. Caption *"Scripted demo shown. The reports that follow are real runs with Claude as the agent."* | "I give BlindSpot the address and a task: book with Dr. Lee. An agent tries it using only what a screen reader announces. It never sees the page." |
| **0:44–1:14** | Real report of the bad clinic (example run): header **Blind user blocked**, score **0**, 11 steps, 15 issues. Open the booking-form step, click **Listen**, let 4–5 s play (*"combobox… Date… Available times, 9:00, 10:30…"*). Scroll to the Tab step: *Focus moved to textbox "Full name"*. Then the issue card **Critical · Blocks the task**, *"Time slots cannot be selected"*, WCAG 2.1.1 / 4.1.2, the radio-group fix. | "Here is a real run, with Claude playing Sam. Listen to the booking form the way Sam hears it." *(pause for audio)* "The times are there, but only as text: nothing to press. Tab jumps from the date straight to the name field. Verdict: blocked, zero out of a hundred. And every issue comes with the WCAG criteria and the fix: here, a real radio group." |
| **1:14–1:24** | Fixed clinic report: **Task completed**, score **100**, last step's transcript with the heading *"Appointment confirmed"*. | "Same agent, the fixed site that looks the same: appointment booked. One hundred." |
| **1:24–1:34** | Compare view: **Before 0 → After 100**, "+100 points", the **Fixed** list. | "Before and after: from zero to a hundred, with every issue that was fixed." |
| **1:34–1:46** | GreenCart checkout, bad and fixed side by side, caption *"GreenCart (fictional): pixel-identical"*. | "It's not one trick. GreenCart is a grocery checkout, also in two identical-looking versions, with different traps: a cookie banner, buttons all called 'Add', silent cart updates." |
| **1:46–2:00** | GreenCart bad report: **blocked** after 13 steps, **0**, 8 issues, issue *"Terms of sale cannot be accepted"*. | "Claude filled the cart and the form, then reached the terms checkbox. It's a plain div: it can't be ticked, so the order can't be placed. On the fixed shop: order placed, one hundred." |
| **2:00–2:12** | Real website: the nodejs.org report, **Task completed**, **91**, the 3 issues (two drop-downs both named "Operating System"…). | "And on a real website, nodejs.org: success, ninety-one, with three small real issues. When a site shows a CAPTCHA, BlindSpot stops and marks the test inconclusive. It never bypasses it." |
| _optional, +10 s_ | **MCP clip**: Claude Code in the repo terminal, prompt *"Use BlindSpot to test /demo/bad/index.html…"*, `blindspot_start`, `blindspot_click`… scroll by while the BlindSpot UI updates live. | "BlindSpot is also an MCP server, so Claude Code itself can be the screen reader user." |
| _optional, +15 s_ | **Architecture slide** (below); highlight each box as it is named. | "Under the hood: Playwright opens Chromium, BlindSpot turns the accessibility tree into a numbered transcript, and the agent acts through tools that only allow what a screen reader user can do. A scan and a scored report come out the other end." |
| **2:12–2:22** | End card: BlindSpot, `github.com/TibereJ/genhacks-2026`, `tiberej.github.io/genhacks-2026`. | "It runs from the web, the command line, Claude Code, and in CI, so the next Sam can book. Next: more real sites and a check on every pull request." |

### Architecture slide (optional insert)

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
                                          │   Agent: Claude API · Claude Code (MCP / HTTP) · scripted
                                          │   tools: click · type · select · press key · back
                                          │          report_issue · finish
                                          ▼
          Report: success / blocked / inconclusive · score · steps (heard / did) · issues + WCAG + fix
          → web UI (Listen, compare) · Markdown / GitHub issue · CI summary
```

### Recording the voiceover

1. **Watch the draft once with captions on** and mark where each segment starts; the times above are a guide.
2. **Record the voiceover** in a quiet room, calm pace. Under the 0:44 segment, duck the voice so the Listen audio
   is clearly heard, and keep that audio at normal speed.
3. **Check every number spoken against the screen**: clinic blocked after 11 steps, 0/100, 15 issues; fixed clinic
   100; GreenCart blocked after 13 steps, 0/100, 8 issues; fixed shop 100; nodejs.org 91 with 3 issues.
4. **Keep the honesty caption at 0:30**: the launched test is the scripted demo; the reports shown after it are
   the real Claude runs from `examples/reports/`.
5. **Optional MCP clip (5–10 s)**, inserted after the nodejs.org segment: start `npm start` in one terminal (the
   live report shows at http://localhost:3000), open Claude Code in the repo folder, approve the `blindspot` MCP
   server when asked, and paste:

   > Use the BlindSpot MCP tools to test /demo/bad/index.html with the task "Book an appointment with Dr. Lee for
   > any available time. Use the name Alex Doe and the email alex@example.com." Act only on what the transcript
   > tells you, report every barrier with blindspot_report_issue, and finish when done or blocked.

   This is a real agent run paid by your Claude subscription. Speed it up in editing with a *"sped up"* caption.
6. **Total length ≤ 3:00** with any inserts.

### Recording checklist (if you re-record any footage)

1. **Reports:** `npm run examples` shows the seven real runs; for a live launch, start the server with a fresh
   folder (`BLINDSPOT_REPORTS_DIR=reports-video npm start`) so "Recent runs" only shows the demo.
2. **Browser:** Chrome, 1920×1080 window, zoom 125%, bookmarks bar hidden, notifications off.
3. **Sound:** an English system voice is installed (Listen uses the browser's speech synthesis) and the screen
   capture records system audio.
4. **Clicks for a live launch:** **Demo: inaccessible clinic** → agent → **Run test** → open the booking-form step →
   **Listen** (click again to **Stop**). For before / after: tick both runs on the home page → **Compare selected**
   (or **Compare with…** on a report).
5. **With a Claude API key** (`ANTHROPIC_API_KEY` in `.env`), do a dry run first: Claude can take a slightly
   different path each time, so adjust the voiceover (Tab step, step count) to what the recorded run shows.

### Before submitting

1. **Live demo:** Pages is enabled (Settings → Pages → Source: **GitHub Actions**) and
   https://tiberej.github.io/genhacks-2026/ loads the seven runs.
2. **CI badge** on the README is green.
3. **Upload** the video to YouTube or Vimeo, **embedding enabled**, captions on, and paste the link at the top of
   this file and on Devpost.
4. **Built with** on Devpost lists every item above (AI tools included, as the rules require).
