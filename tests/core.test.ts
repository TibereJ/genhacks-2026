import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.BLINDSPOT_REPORTS_DIR = await mkdtemp(path.join(os.tmpdir(), "blindspot-test-"));
const { BrowserSession } = await import("../src/core/browser.js");
const { runTest } = await import("../src/core/agent.js");
const { ScriptedBrain, parseTranscript } = await import("../src/core/brains/scripted.js");
const { scanPage } = await import("../src/core/scan.js");

const PAGES: Record<string, string> = {
  "/form": `<!doctype html><html lang="en"><head><title>Form</title></head><body>
    <main>
      <h1>Contact</h1>
      <img src="x.png">
      <label for="n">Name</label><input id="n">
      <input placeholder="Email">
      <div class="slot" onclick="this.classList.add('on')" style="cursor:pointer">9:00</div>
      <select><option>Dr. Lee</option><option>Dr. Patel</option></select>
      <button onclick="document.getElementById('msg').textContent='Sent!'"><svg width="10" height="10"></svg></button>
      <button onclick="location.href='/done'">Send</button>
      <div role="status" id="msg"></div>
      <div style="cursor:pointer"><input type="checkbox" id="terms"><label for="terms">I accept the terms</label></div>
      <a href="/redirect">Partner site</a>
      <a id="dl" tabindex="0" onclick="void 0" style="cursor:pointer">Download audio</a>
    </main></body></html>`,
  "/done": `<!doctype html><html lang="en"><head><title>Thanks</title></head><body><main><h1>Message sent</h1></main></body></html>`,
  "/scan": `<!doctype html><html lang="en"><head><title>Scan</title></head><body><main>
    <h1>Products</h1>
    <div class="card" onclick="location.href='/done'"><h2>Green tea</h2><a href="/done">Details</a></div>
    <div class="opt" onclick="void 0"><input type="radio" id="r1" name="r"><label for="r1">Small</label></div>
    <div class="pair" onclick="void 0"><input id="q1" aria-label="Qty 1"><input id="q2" aria-label="Qty 2"></div>
    <ul><li style="cursor:pointer"><a href="/done">Menu link</a></li></ul>
    <a id="nohref" tabindex="0" onclick="void 0">Download audio</a>
    <a id="keyed" tabindex="0" role="button" onclick="void 0" onkeydown="void 0">Play</a>
    <a id="unreachable" onclick="void 0">Share</a>
  </main></body></html>`,
  "/popup": `<!doctype html><html lang="en"><head><title>Popup</title></head><body><main><h1>Popups</h1>
    <button onclick="window.open('/selfclose')">Open helper</button>
    <button onclick="setTimeout(() => window.open('/done'), 2000)">Open later</button>
    <button onclick="window.open('/form'); window.open('')">Open two</button>
    </main></body></html>`,
  "/selfclose": `<!doctype html><html lang="en"><head><title>Helper</title></head><body><main><h1>Helper</h1>
    <button onclick="window.close()">Done</button></main></body></html>`,
  "/tabs": `<!doctype html><html lang="en"><head><title>Tabs</title></head><body><main>
    <h1>Links</h1><a href="/done" target="_blank">Open thanks in a new tab</a></main></body></html>`,
};

let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/redirect") { res.writeHead(302, { location: "http://127.0.0.2:8080/secret" }); res.end(); return; }
    const page = PAGES[req.url ?? ""];
    res.writeHead(page ? 200 : 404, { "content-type": "text/html" });
    res.end(page ?? "not found");
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("screen reader transcript", () => {
  it("numbers operable elements and exposes missing names", async () => {
    const s = await BrowserSession.open(`${base}/form`);
    try {
      const snap = await s.snapshot();
      expect(snap.text).toContain("Page: Form");
      expect(snap.text).toContain('heading level 1 "Contact"');
      expect(snap.text).toContain("image (no description)");
      expect(snap.text).toMatch(/\[\d+\] textbox "Name"/);
      expect(snap.text).toMatch(/\[\d+\] combobox "" value "Dr. Lee" options: "Dr. Lee", "Dr. Patel"/);
      expect(snap.text).toMatch(/\[\d+\] button ""/);
      // The clickable div is only plain text: no id.
      expect(snap.text).toContain('text "9:00"');
      expect(snap.text).not.toMatch(/\[\d+\] \S+ "9:00"/);
      const parsed = parseTranscript(snap.text);
      expect(parsed.find((e) => e.role === "button" && e.name === "Send")).toBeTruthy();
    } finally {
      await s.close();
    }
  });

  it("performs actions and reports what was announced", async () => {
    const s = await BrowserSession.open(`${base}/form`);
    try {
      let snap = await s.snapshot();
      const find = (role: string, name: string) => [...snap.elements.values()].find((e) => e.role === role && e.name === name)!;

      const typed = await s.act({ type: "type", id: find("textbox", "Name").id, text: "Alex" }, snap);
      expect(typed.ok).toBe(true);
      expect(typed.result).toContain('textbox "Name" now has value "Alex"');
      snap = typed.snapshot;

      const selected = await s.act({ type: "select", id: find("combobox", "").id, option: "patel" }, snap);
      expect(selected.ok).toBe(true);
      snap = selected.snapshot;
      expect(snap.text).toContain('value "Dr. Patel"');

      const wrong = await s.act({ type: "select", id: find("combobox", "").id, option: "Dr. Who" }, snap);
      expect(wrong.ok).toBe(false);
      expect(wrong.result).toContain('"Dr. Lee", "Dr. Patel"');

      const status = await s.act({ type: "click", id: find("button", "").id }, snap);
      expect(status.result).toContain('Announced: "Sent!"');

      const nav = await s.act({ type: "click", id: find("button", "Send").id }, status.snapshot);
      expect(nav.result).toContain('New page loaded: "Thanks"');
      expect(nav.snapshot.text).toContain("Message sent");

      expect((await s.act({ type: "click", id: 999 }, nav.snapshot)).ok).toBe(false);
    } finally {
      await s.close();
    }
  });
});

describe("automated scan", () => {
  it("flags clickable wrappers around links, but not around a single form control and its label", async () => {
    const s = await BrowserSession.open(`${base}/scan`);
    try {
      const findings = await scanPage(s.page, await s.snapshot());
      const clickable = findings.find((f) => f.title.startsWith("Clickable elements"))!;
      expect(clickable.severity).toBe("critical");
      // The product card, the wrapper around two fields, and the <a onclick> without tabindex (Tab never reaches it).
      expect(clickable.description).toContain("3 elements");
      expect(clickable.description).toContain('"Green teaDetails"');
      expect(clickable.description).toContain('"Share"');
      expect(clickable.element?.html).toContain('class="card"');
      expect(clickable.description).not.toContain("Small");
      expect(clickable.description).not.toContain("Menu link");
      expect(clickable.description).not.toContain("Download audio");

      const hrefless = findings.find((f) => f.title === "Links without href may not respond to Enter")!;
      expect(hrefless).toBeDefined();
      expect(hrefless.severity).toBe("moderate");
      expect(hrefless.wcag).toEqual(["2.1.1 Keyboard", "4.1.2 Name, Role, Value"]);
      expect(hrefless.fix).toMatch(/<a href>.*<button>/);
      expect(hrefless.description).toContain("1 link");
      expect(hrefless.description).toContain('"Download audio"');
      expect(hrefless.description).not.toContain("Play");
      expect(hrefless.element).toMatchObject({ role: "link", name: "Download audio" });
    } finally {
      await s.close();
    }
  });
});

describe("agent loop", () => {
  it("runs a scripted test, records steps, scan issues and a score", async () => {
    const brain = new ScriptedBrain([
      (_t, find) => [{ name: "type_text", input: { id: find("textbox", /^Name$/)!.id, text: "Alex", reason: "fill name" } }],
      (_t, find) => [
        { name: "report_issue", input: { severity: "critical", title: "Time cannot be chosen", description: "d", wcag: ["2.1.1 Keyboard"], fix: "f", element_id: null, blocking: true } },
        { name: "click", input: { id: find("button", /^Send$/)!.id, reason: "send" } },
      ],
      () => [{ name: "finish", input: { status: "success", summary: "Done." } }],
    ]);
    const report = await runTest({ url: `${base}/form`, task: "Send the form", brain });
    expect(report.status).toBe("success");
    expect(report.steps.map((s) => s.action.type)).toEqual(["type", "click", "finish"]);
    expect(report.steps[1].result).toContain("New page loaded");
    const titles = report.issues.map((i) => i.title);
    expect(titles).toContain("Time cannot be chosen");
    expect(titles).toContain("Images have no text alternative");
    expect(titles).toContain("Button has no accessible name");
    expect(titles).toContain("Clickable elements cannot be reached or activated with a screen reader or keyboard");
    const clickable = report.issues.find((i) => i.title.startsWith("Clickable elements"))!;
    expect(clickable.description).toContain("1 element");
    expect(clickable.description).not.toContain("accept the terms");
    expect(titles).toContain("Fields use a placeholder instead of a label");
    expect(report.score).toBeGreaterThanOrEqual(50);
    expect(report.score).toBeLessThan(100);
  });
});

/** A brain that replays fixed turns (then repeats the last one) and records what it was told. */
function recordingBrain(turns: { name: string; input: unknown }[][]) {
  const received: { id: string; content: string; isError?: boolean }[][] = [];
  let i = 0;
  let n = 0;
  const next = async () => ({ calls: turns[Math.min(i++, turns.length - 1)].map((c) => ({ ...c, id: `t${++n}` })), text: "" });
  return {
    received,
    calls: () => n,
    brain: {
      model: "test",
      start: next,
      continue: async (o: { id: string; content: string; isError?: boolean }[]) => { received.push(o); return next(); },
      nudge: next,
    },
  };
}

describe("agent loop limits", () => {
  it("refuses finish in the same turn as an action and keeps going", async () => {
    // Transcript ids are stable for the same page, so read them from a first visit.
    const snap = await (async () => { const s = await BrowserSession.open(`${base}/form`); try { return await s.snapshot(); } finally { await s.close(); } })();
    const name = [...snap.elements.values()].find((e) => e.role === "textbox" && e.name === "Name")!;
    const r = recordingBrain([
      [
        { name: "type_text", input: { id: name.id, text: "Alex", reason: "fill" } },
        { name: "finish", input: { status: "success", summary: "Too early." } },
        { name: "report_issue", input: { severity: "minor", title: "After finish", description: "d", wcag: [], fix: "f", element_id: null, blocking: false } },
      ],
      [{ name: "finish", input: { status: "blocked", summary: "Looked first." } }],
    ]);
    const report = await runTest({ url: `${base}/form`, task: "t", brain: r.brain });
    expect(report.status).toBe("blocked");
    expect(report.summary).toBe("Looked first.");
    expect(report.steps.map((s) => s.action.type)).toEqual(["type", "finish"]);
    const firstAnswers = r.received[0];
    expect(firstAnswers.map((o) => o.id)).toEqual(["t1", "t2", "t3"]);
    expect(firstAnswers[1]).toMatchObject({ isError: true, content: "Look at the result of your action before finishing." });
    expect(firstAnswers[2].content).toBe("Issue recorded.");
  });

  it("stops with step_limit after maxTurns brain turns, even without actions", async () => {
    const r = recordingBrain([[{ name: "report_issue", input: { severity: "minor", title: "Again", description: "d", wcag: [], fix: "f", element_id: null, blocking: false } }]]);
    const report = await runTest({ url: `${base}/form`, task: "t", brain: r.brain, maxSteps: 2 });
    expect(report.status).toBe("step_limit");
    expect(r.calls()).toBe(4); // default maxTurns = 2 × maxSteps
    expect(report.summary).toContain("all 4 turns");
    expect(report.issues.filter((i) => i.title === "Again")).toHaveLength(4);
  });

  it("counts turns without tool calls too", async () => {
    let turns = 0;
    const brain = { model: "test", start: async () => { turns++; return { calls: [], text: "" }; }, continue: async () => { turns++; return { calls: [], text: "" }; }, nudge: async () => { turns++; return { calls: [], text: "" }; } };
    const report = await runTest({ url: `${base}/form`, task: "t", brain, maxSteps: 1, maxTurns: 2 });
    expect(report.status).toBe("step_limit");
    expect(turns).toBe(2);
  });
});

describe("composite widgets", () => {
  it("reports focus inside a date field as focus on the date field", async () => {
    const { buildSnapshot } = await import("../src/core/ax-tree.js");
    const nodes = [
      { nodeId: "1", ignored: false, role: { value: "RootWebArea" }, childIds: ["2"] },
      { nodeId: "2", ignored: false, role: { value: "Date" }, name: { value: "Date" }, value: { value: "2026-11-05" }, backendDOMNodeId: 2, childIds: ["3"], properties: [{ name: "focusable", value: { value: true } }] },
      { nodeId: "3", ignored: false, role: { value: "spinbutton" }, name: { value: "Month" }, backendDOMNodeId: 3, properties: [{ name: "focused", value: { value: true } }] },
    ];
    const snap = buildSnapshot(nodes, "http://x", "T");
    expect(snap.focused).toBe('date field "Date"');
    expect(snap.text).toContain('[1] date field "Date" value "2026-11-05" ← focus');
    expect(snap.text).not.toContain("Month");
  });
});

describe("browser safety and states", () => {
  it("announces checkbox state changes", async () => {
    const s = await BrowserSession.open(`${base}/form`);
    try {
      const snap = await s.snapshot();
      const box = [...snap.elements.values()].find((e) => e.role === "checkbox")!;
      expect(snap.text).toContain('checkbox "I accept the terms" (not checked)');
      const out = await s.act({ type: "click", id: box.id }, snap);
      expect(out.result).toContain('checkbox "I accept the terms" is now checked');
    } finally {
      await s.close();
    }
  });

  it("follows a link into a new tab, and back closes that tab", async () => {
    const s = await BrowserSession.open(`${base}/tabs`);
    try {
      const snap = await s.snapshot();
      const link = [...snap.elements.values()].find((e) => e.role === "link")!;
      const opened = await s.act({ type: "click", id: link.id }, snap);
      expect(opened.ok).toBe(true);
      expect(opened.result).toContain('A new tab opened: "Thanks".');
      expect(opened.snapshot.text).toContain("Message sent");
      expect(s.page.url()).toBe(`${base}/done`);

      const back = await s.act({ type: "back" }, opened.snapshot);
      expect(back.ok).toBe(true);
      expect(back.result).toContain('This tab closed. Back on the previous tab: "Tabs".');
      expect(s.page.url()).toBe(`${base}/tabs`);
      expect(s.page.context().pages()).toHaveLength(1);
    } finally {
      await s.close();
    }
  });

  it("goes back to the previous tab when a popup closes itself", async () => {
    const s = await BrowserSession.open(`${base}/popup`);
    try {
      const snap = await s.snapshot();
      const open = [...snap.elements.values()].find((e) => e.name === "Open helper")!;
      const opened = await s.act({ type: "click", id: open.id }, snap);
      expect(opened.result).toContain('A new tab opened: "Helper".');
      const done = [...opened.snapshot.elements.values()].find((e) => e.name === "Done")!;
      const closed = await s.act({ type: "click", id: done.id }, opened.snapshot);
      expect(closed.ok).toBe(true);
      expect(closed.result).toContain('This tab closed. Back on the previous tab: "Popup".');
      expect(closed.snapshot.title).toBe("Popup");
      expect(s.page.url()).toBe(`${base}/popup`);

      // The popup closing itself between two actions: the next action is not performed, and says why.
      const again = await s.act({ type: "click", id: open.id }, closed.snapshot);
      const helper = s.page;
      await helper.evaluate(() => window.close());
      await expect.poll(() => helper.isClosed()).toBe(true);
      const skipped = await s.act({ type: "press", key: "Tab" }, again.snapshot);
      expect(skipped.ok).toBe(false);
      expect(skipped.result).toContain("closed by itself");
      expect(skipped.result).toContain('Back on the previous tab: "Popup"');
      expect(await s.snapshot()).toMatchObject({ title: "Popup" });
    } finally {
      await s.close();
    }
  });

  it("adopts a tab opened after the action settled at the next action", async () => {
    const s = await BrowserSession.open(`${base}/popup`);
    try {
      const snap = await s.snapshot();
      const later = [...snap.elements.values()].find((e) => e.name === "Open later")!;
      const first = await s.act({ type: "click", id: later.id }, snap);
      expect(first.result).not.toContain("new tab");
      expect(s.page.url()).toBe(`${base}/popup`);
      await expect.poll(() => s.page.context().pages().length, { timeout: 5_000 }).toBe(2);
      const next = await s.act({ type: "press", key: "Tab" }, first.snapshot);
      expect(next.result).toContain('A new tab opened: "Thanks".');
      expect(s.page.url()).toBe(`${base}/done`);
    } finally {
      await s.close();
    }
  });

  it("ignores blank tabs, and prefers a tab opened by the current page", async () => {
    const s = await BrowserSession.open(`${base}/popup`);
    try {
      const snap = await s.snapshot();
      const two = [...snap.elements.values()].find((e) => e.name === "Open two")!;
      const out = await s.act({ type: "click", id: two.id }, snap);
      expect(s.page.context().pages()).toHaveLength(3);
      // The last tab stayed on about:blank.
      expect(out.result).toContain('A new tab opened: "Form".');
      expect(s.page.url()).toBe(`${base}/form`);

      // Now on /form. Its tab opens /done, then the first tab (in the background) opens /tabs: /done wins.
      const [first] = s.page.context().pages();
      await s.page.evaluate(() => { window.open("/done"); });
      await expect.poll(() => s.page.context().pages().length).toBe(4);
      await first.evaluate(() => { window.open("/tabs"); });
      await expect.poll(() => s.page.context().pages().length).toBe(5);
      const next = await s.act({ type: "press", key: "Tab" }, out.snapshot);
      expect(next.result).toContain('A new tab opened: "Thanks".');
      expect(s.page.url()).toBe(`${base}/done`);
    } finally {
      await s.close();
    }
  });

  it("retries a snapshot once when a navigation destroyed the page mid-read", async () => {
    const s = await BrowserSession.open(`${base}/tabs`);
    try {
      const cdp = (s as unknown as { cdp: { send: (...a: unknown[]) => Promise<unknown> } }).cdp;
      const real = cdp.send.bind(cdp);
      let failures = 0;
      cdp.send = async (...a: unknown[]) => {
        if (failures === 0) { failures++; throw new Error("Protocol error: Execution context was destroyed."); }
        return real(...a);
      };
      const snap = await s.snapshot();
      expect(failures).toBe(1);
      expect(snap.title).toBe("Tabs");
    } finally {
      await s.close();
    }
  });

  it("blocks requests the guard refuses, including redirects", async () => {
    const guard = async (u: URL) => (u.hostname === "127.0.0.2" ? "private address" : null);
    const s = await BrowserSession.open(`${base}/form`, guard);
    try {
      const snap = await s.snapshot();
      const link = [...snap.elements.values()].find((e) => e.role === "link" && e.name === "Partner site")!;
      await s.act({ type: "click", id: link.id }, snap);
      expect(s.page.url()).not.toContain("127.0.0.2");
    } finally {
      await s.close();
    }
    await expect(BrowserSession.open(`${base}/redirect`, guard)).rejects.toThrow(/BLOCKED_BY_CLIENT/);
  });
});

describe("focus on non-widgets", () => {
  it("reports focus moved to a heading", async () => {
    const { buildSnapshot } = await import("../src/core/ax-tree.js");
    const snap = buildSnapshot([
      { nodeId: "1", ignored: false, role: { value: "RootWebArea" }, childIds: ["2"] },
      { nodeId: "2", ignored: false, role: { value: "heading" }, name: { value: "Checkout" }, backendDOMNodeId: 2, properties: [{ name: "level", value: { value: 1 } }, { name: "focusable", value: { value: true } }, { name: "focused", value: { value: true } }] },
    ], "http://x", "T");
    expect(snap.focused).toBe('heading level 1 "Checkout"');
    expect(snap.text).toContain('heading level 1 "Checkout" ← focus');
  });
});

describe("inconclusive runs", () => {
  it("ends without a score when the agent cannot test the task (e.g. CAPTCHA)", async () => {
    const brain = new ScriptedBrain([
      () => [{ name: "finish", input: { status: "inconclusive", summary: "A bot check stopped me; it offers an audio challenge." } }],
    ]);
    const report = await runTest({ url: `${base}/done`, task: "Anything", brain });
    expect(report.status).toBe("inconclusive");
    expect(report.score).toBeUndefined();
    expect(report.steps.at(-1)?.result).toContain("not an accessibility verdict");
  });
});

describe("focusable wrappers", () => {
  it("reads the content of a focusable wrapper such as a skip-link target", async () => {
    const { buildSnapshot } = await import("../src/core/ax-tree.js");
    const snap = buildSnapshot([
      { nodeId: "1", ignored: false, role: { value: "RootWebArea" }, childIds: ["2"] },
      { nodeId: "2", ignored: false, role: { value: "generic" }, backendDOMNodeId: 2, childIds: ["3", "4"], properties: [{ name: "focusable", value: { value: true } }] },
      { nodeId: "3", ignored: false, role: { value: "heading" }, name: { value: "Packages" }, backendDOMNodeId: 3, properties: [{ name: "level", value: { value: 1 } }] },
      { nodeId: "4", ignored: false, role: { value: "link" }, name: { value: "@std/path" }, backendDOMNodeId: 4 },
    ], "http://x", "T");
    expect(snap.text).toContain('heading level 1 "Packages"');
    expect(snap.text).toMatch(/\[\d+\] link "@std\/path"/);
  });
});

describe("find_text", () => {
  it("searches lines cut from a long transcript and returns usable ids", async () => {
    const { buildSnapshot, findInSnapshot } = await import("../src/core/ax-tree.js");
    const nodes: Record<string, unknown>[] = [{ nodeId: "0", ignored: false, role: { value: "RootWebArea" }, childIds: [] as string[] }];
    for (let i = 1; i <= 700; i++) {
      (nodes[0].childIds as string[]).push(String(i));
      nodes.push(i === 650
        ? { nodeId: String(i), ignored: false, role: { value: "button" }, name: { value: "Copy example" }, backendDOMNodeId: i }
        : { nodeId: String(i), ignored: false, role: { value: "StaticText" }, name: { value: `line ${i}` } });
    }
    const snap = buildSnapshot(nodes as never, "http://x", "Long");
    expect(snap.text).not.toContain("Copy example");
    expect(snap.text).toContain("use find_text");
    const found = findInSnapshot(snap, "copy");
    expect(found).toMatch(/1 match for "copy":\nline \d+: \[1\] button "Copy example"/);
    expect(snap.elements.get(1)?.name).toBe("Copy example");
    expect(findInSnapshot(snap, "nope")).toContain("was not found");
  });
});

describe("lists", () => {
  it("announces the number of items like a screen reader", async () => {
    const { buildSnapshot } = await import("../src/core/ax-tree.js");
    const snap = buildSnapshot([
      { nodeId: "1", ignored: false, role: { value: "RootWebArea" }, childIds: ["2"] },
      { nodeId: "2", ignored: false, role: { value: "list" }, childIds: ["3", "4", "5"] },
      { nodeId: "3", ignored: false, role: { value: "listitem" }, childIds: ["6"] },
      { nodeId: "4", ignored: false, role: { value: "listitem" }, childIds: [] },
      { nodeId: "5", ignored: false, role: { value: "listitem" }, childIds: [] },
      { nodeId: "6", ignored: false, role: { value: "link" }, name: { value: "Apples" }, backendDOMNodeId: 6 },
    ], "http://x", "T");
    expect(snap.text).toContain("list (3 items)");
    expect(snap.text).toMatch(/\n {2}\[1\] link "Apples"/);
  });
});
