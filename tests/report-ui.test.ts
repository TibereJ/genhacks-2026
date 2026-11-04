import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Report } from "../src/core/types.js";
import {
  actionText,
  countBySeverity,
  demoSiteHref,
  duration,
  prettyUrl,
  screenshotUrl,
  sortIssues,
  statusLabel,
  stripIds,
  toSpeech,
  tokenizeTranscript,
} from "../report-ui/format.js";

const fixture = JSON.parse(
  readFileSync(new URL("../report-ui/fixtures/sample-report.json", import.meta.url), "utf8"),
) as Report;

describe("report-ui fixture", () => {
  it("matches the Report shape well enough for the UI", () => {
    expect(fixture.status).toBe("blocked");
    expect(fixture.score).toBeGreaterThanOrEqual(0);
    expect(fixture.score).toBeLessThanOrEqual(100);
    expect(fixture.steps.length).toBeGreaterThanOrEqual(5);
    const stepIndexes = new Set(fixture.steps.map((s) => s.index));
    for (const issue of fixture.issues) {
      expect(["critical", "serious", "moderate", "minor"]).toContain(issue.severity);
      expect(["agent", "scan"]).toContain(issue.source);
      expect(stepIndexes.has(issue.stepIndex)).toBe(true);
      expect(issue.wcag.length).toBeGreaterThan(0);
    }
    for (const step of fixture.steps) {
      expect(typeof step.heard).toBe("string");
      expect(["click", "type", "select", "press", "back", "finish"]).toContain(step.action.type);
    }
  });
});

describe("actionText", () => {
  it("describes each action type as a human sentence", () => {
    expect(actionText({ type: "click", target: { id: 3, role: "button", name: "Book appointment" } })).toBe(
      'Clicked button "Book appointment"',
    );
    expect(actionText({ type: "type", target: { id: 5, role: "textbox", name: "Full name" }, value: "Alex Doe" })).toBe(
      'Typed "Alex Doe" into textbox "Full name"',
    );
    expect(actionText({ type: "select", target: { id: 3, role: "combobox", name: "" }, value: "Dr. Lee" })).toBe(
      'Selected "Dr. Lee" in combobox ""',
    );
    expect(actionText({ type: "press", value: "enter" })).toBe("Pressed Enter");
    expect(actionText({ type: "back" })).toBe("Went back to the previous page");
    expect(actionText({ type: "finish" })).toBe("Finished");
  });
});

describe("sortIssues", () => {
  it("puts blocking issues first, then orders by severity", () => {
    const sorted = sortIssues(fixture.issues);
    expect(sorted[0].blocking).toBe(true);
    const ranks = sorted.slice(1).map((i) => ["critical", "serious", "moderate", "minor"].indexOf(i.severity));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(fixture.issues[0].id).not.toBe(sorted[0].id); // input not mutated / reordered in place
  });

  it("counts by severity", () => {
    expect(countBySeverity(fixture.issues)).toEqual({ critical: 1, serious: 4, moderate: 2, minor: 0 });
  });
});

describe("transcripts", () => {
  const heard = 'main\n  [3] combobox "" value "Choose a doctor"\n  [4] textbox "Date"\n  text "9:00"  text "10:30"';

  it("strips id markers", () => {
    expect(stripIds(heard)).not.toMatch(/\[\d+\]/);
    expect(stripIds('[12] button "Pay"')).toBe('button "Pay"');
  });

  it("turns the transcript into screen-reader-like sentences", () => {
    expect(toSpeech(heard)).toEqual(["main.", "combobox value Choose a doctor.", "Date, textbox.", "9:00. 10:30."]);
  });

  it("tokenizes ids and empty names for highlighting", () => {
    const lines = tokenizeTranscript(heard);
    expect(lines[1].ids).toEqual([3]);
    expect(lines[1].tokens.filter((t) => t.kind === "empty").map((t) => t.text)).toEqual(['""']);
    expect(lines[1].tokens.map((t) => t.text).join("")).toBe('  [3] combobox "" value "Choose a doctor"');
  });
});

describe("misc formatting", () => {
  it("labels statuses", () => {
    expect(statusLabel("success")).toBe("Task completed");
    expect(statusLabel("blocked")).toBe("Blind user blocked");
  });

  it("builds safe screenshot URLs", () => {
    expect(screenshotUrl("abc", "step-3.png")).toBe("/reports/abc/step-3.png");
    expect(screenshotUrl("abc", "../../etc/passwd")).toBe("/reports/abc/etc/passwd");
    expect(screenshotUrl("abc", undefined)).toBeNull();
    // Static demo build: relative base.
    expect(screenshotUrl("abc", "step-3.png", "data/reports/")).toBe("data/reports/abc/step-3.png");
  });

  it("maps local demo-site URLs to the static build's copy", () => {
    expect(demoSiteHref("http://localhost:3200/demo/bad/index.html")).toBe("demo/bad/index.html");
    expect(demoSiteHref("http://127.0.0.1:3000/demo/shop/fixed/cart.html?x=1")).toBe("demo/shop/fixed/cart.html?x=1");
    expect(demoSiteHref("/demo/fixed/index.html")).toBe("demo/fixed/index.html");
    expect(demoSiteHref("https://example.com/demo/bad/index.html")).toBeNull();
    expect(demoSiteHref("http://localhost:3000/api/reports")).toBeNull();
    expect(demoSiteHref("http://localhost:3000/demo/../api/reports")).toBeNull();
    expect(demoSiteHref("javascript:alert(1)")).toBeNull();
    expect(demoSiteHref(undefined)).toBeNull();
  });

  it("formats durations and URLs", () => {
    expect(duration("2026-11-04T14:02:11.000Z", "2026-11-04T14:03:26.000Z")).toBe("1 min 15 s");
    expect(prettyUrl("http://localhost:3000/demo/bad/index.html")).toBe("localhost:3000/demo/bad/index.html");
    expect(prettyUrl("/demo/bad/index.html")).toBe("/demo/bad/index.html");
  });
});
