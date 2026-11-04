import { describe, expect, it } from "vitest";
import { compareIssues, issueComparability, issueMatchKey, noScoreText, orderRuns, scoreDelta } from "../report-ui/format.js";

type I = { title: string; severity: string; blocking?: boolean; stepIndex?: number; element?: { role: string; name: string } };

const issue = (title: string, role = "", name = "", over: Partial<I> = {}): I => ({
  title,
  severity: "serious",
  element: role || name ? { role, name } : undefined,
  ...over,
});

describe("issueMatchKey", () => {
  it("matches on title, element role and name, ignoring case and spacing", () => {
    expect(issueMatchKey(issue("Button has no name", "button", ""))).toBe(issueMatchKey(issue(" button  has no NAME ", "Button", "")));
    expect(issueMatchKey(issue("Button has no name", "button", ""))).not.toBe(issueMatchKey(issue("Button has no name", "link", "")));
    expect(issueMatchKey(issue("Field has no label", "textbox", "Email"))).not.toBe(issueMatchKey(issue("Field has no label", "textbox", "Name")));
    expect(issueMatchKey(issue("Page has no title"))).toBe(issueMatchKey({ title: "Page has no title", severity: "minor" }));
  });
});

describe("compareIssues", () => {
  it("splits issues into fixed, still present and new", () => {
    const before = [issue("A", "button", ""), issue("B", "combobox", ""), issue("C")];
    const after = [issue("B", "combobox", "", { severity: "minor" }), issue("D", "link", "More")];
    const { fixed, stillPresent, added } = compareIssues(before, after);
    expect(fixed.map((i) => i.title).sort()).toEqual(["A", "C"]);
    expect(stillPresent).toHaveLength(1);
    expect(stillPresent[0].before.severity).toBe("serious");
    expect(stillPresent[0].after.severity).toBe("minor");
    expect(added.map((i) => i.title)).toEqual(["D"]);
  });

  it("matches duplicates one to one", () => {
    const before = [issue("Dup", "button", ""), issue("Dup", "button", "")];
    const after = [issue("Dup", "button", "")];
    const { fixed, stillPresent, added } = compareIssues(before, after);
    expect(fixed).toHaveLength(1);
    expect(stillPresent).toHaveLength(1);
    expect(added).toHaveLength(0);
  });

  it("sorts each list blocking first, then by severity", () => {
    const after = [issue("minor", "", "", { severity: "minor" }), issue("crit", "", "", { severity: "critical" }), issue("block", "", "", { severity: "moderate", blocking: true })];
    expect(compareIssues([], after).added.map((i) => i.title)).toEqual(["block", "crit", "minor"]);
    expect(compareIssues(after, after).stillPresent.map((p) => p.after.title)).toEqual(["block", "crit", "minor"]);
    expect(compareIssues(after, []).fixed.map((i) => i.title)).toEqual(["block", "crit", "minor"]);
  });

  it("handles missing lists", () => {
    expect(compareIssues(undefined, undefined)).toEqual({ fixed: [], stillPresent: [], added: [] });
  });
});

describe("orderRuns", () => {
  it("puts the older run first", () => {
    const older = { id: "a", startedAt: "2026-11-04T10:00:00.000Z" };
    const newer = { id: "b", startedAt: "2026-11-04T11:00:00.000Z" };
    expect(orderRuns(newer, older)).toEqual([older, newer]);
    expect(orderRuns(older, newer)).toEqual([older, newer]);
  });
});

describe("scoreDelta", () => {
  it("describes the change in score", () => {
    expect(scoreDelta(30, 95)).toMatchObject({ value: 65, text: "+65", tone: "good", sentence: "Score up 65 points" });
    expect(scoreDelta(90, 89)).toMatchObject({ value: -1, tone: "bad", sentence: "Score down 1 point" });
    expect(scoreDelta(50, 50)).toMatchObject({ value: 0, text: "±0", tone: "none" });
    expect(scoreDelta(undefined, 50)).toMatchObject({ value: null, tone: "none", label: "pending" });
    expect(scoreDelta(30, 95).label).toBe("points");
  });

  it("only says pending while a run is still going", () => {
    expect(scoreDelta(undefined, 50, "running", "success")).toMatchObject({ label: "pending", sentence: "Score change not available yet" });
    expect(scoreDelta(80, undefined, "success", "inconclusive")).toMatchObject({ value: null, label: "not scored", sentence: "No score change: the after run was not scored" });
    expect(scoreDelta(undefined, 80, "error", "success").sentence).toBe("No score change: the before run was not scored");
    expect(scoreDelta(undefined, undefined, "error", "inconclusive").sentence).toBe("No score change: neither run was scored");
  });
});

describe("issueComparability", () => {
  it("refuses to compare issues when a run is inconclusive or failed", () => {
    expect(issueComparability("blocked", "success")).toEqual({ comparable: true, reason: "" });
    expect(issueComparability("running", "success").comparable).toBe(true);
    expect(issueComparability("success", "inconclusive")).toMatchObject({ comparable: false });
    expect(issueComparability("success", "inconclusive").reason).toContain("the after run was inconclusive");
    expect(issueComparability("error", "success").reason).toContain("the before run failed");
    expect(issueComparability("error", "inconclusive").reason).toContain("the before run failed and the after run was inconclusive");
  });
});

describe("noScoreText", () => {
  it("says why a run has no score", () => {
    expect(noScoreText("running")).toBe("No score yet");
    expect(noScoreText("inconclusive")).toBe("Not scored: test inconclusive");
    expect(noScoreText("error")).toBe("Not scored: the test failed");
    expect(noScoreText(undefined)).toBe("No score");
  });
});
