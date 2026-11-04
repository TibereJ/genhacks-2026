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
    </main></body></html>`,
  "/done": `<!doctype html><html lang="en"><head><title>Thanks</title></head><body><main><h1>Message sent</h1></main></body></html>`,
};

let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
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
    expect(titles).toContain("Fields use a placeholder instead of a label");
    expect(report.score).toBeGreaterThanOrEqual(50);
    expect(report.score).toBeLessThan(100);
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
