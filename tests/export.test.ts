import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Issue, Report } from "../src/core/types.js";
import { codeBlock, codeSpan, escapeMarkdown, reportToMarkdown } from "../src/core/export.js";

const fixture = JSON.parse(
  readFileSync(new URL("../report-ui/fixtures/sample-report.json", import.meta.url), "utf8"),
) as Report;

function issue(over: Partial<Issue>): Issue {
  return {
    id: over.title ?? "i",
    severity: "moderate",
    title: "Some issue",
    description: "Description.",
    wcag: ["1.3.1 Info and Relationships"],
    fix: "<label>Fix</label>",
    stepIndex: 1,
    source: "agent",
    blocking: false,
    ...over,
  };
}

function report(over: Partial<Report> = {}): Report {
  return {
    id: "r1",
    url: "http://localhost:3000/demo/bad/index.html",
    task: "Book an appointment",
    model: "scripted",
    status: "blocked",
    summary: "Could not pick a time.",
    startedAt: "2026-11-04T10:00:00.000Z",
    finishedAt: "2026-11-04T10:01:00.000Z",
    steps: [
      { index: 1, url: "http://x/", reason: "Start", action: { type: "click", target: { id: 3, role: "link", name: "Book" } }, result: "Opened the form", ok: true, heard: "" },
      { index: 2, url: "http://x/", reason: "Name", action: { type: "type", target: { id: 5, role: "textbox", name: "" }, value: "Alex Doe" }, result: "Typed", ok: false, heard: "" },
    ],
    issues: [],
    score: 35,
    ...over,
  };
}

/** Table rows of the issues table. */
function tableRows(md: string): string[] {
  return md.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| # "));
}

/** Count the pipes GFM would use as cell separators (unescaped ones). */
function separators(row: string): number {
  let n = 0;
  for (let i = 0; i < row.length; i++) {
    if (row[i] === "\\") i++;
    else if (row[i] === "|") n++;
  }
  return n;
}

/** Minimal CommonMark fence scanner: returns the code blocks' contents. */
function fencedBlocks(md: string): string[] {
  const blocks: string[] = [];
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = /^(`{3,})/.exec(lines[i]);
    if (!open) continue;
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const close = /^(`{3,})\s*$/.exec(lines[j]);
      if (close && close[1].length >= open[1].length) break;
      body.push(lines[j]);
    }
    blocks.push(body.join("\n"));
    i = j;
  }
  return blocks;
}

describe("reportToMarkdown", () => {
  it("starts with the status and the score", () => {
    const md = reportToMarkdown(report());
    expect(md.split("\n")[0]).toBe("# BlindSpot: Blind user blocked, score 35/100");
    expect(md).toContain("**Task:** Book an appointment");
    expect(md).toContain("<http://localhost:3000/demo/bad/index.html>");
    expect(md).toContain("> Could not pick a time.");
  });

  it("says the score is pending while the run is in progress", () => {
    const md = reportToMarkdown(report({ status: "running", score: undefined, summary: "" }));
    expect(md.split("\n")[0]).toBe("# BlindSpot: Running, score pending");
    expect(md).not.toContain("## Summary");
  });

  it("says a finished run without a score was not scored, and why", () => {
    const first = (over: Partial<Report>) => reportToMarkdown(report({ score: undefined, ...over })).split("\n")[0];
    expect(first({ status: "inconclusive" })).toBe("# BlindSpot: Inconclusive, not scored (inconclusive)");
    expect(first({ status: "error" })).toBe("# BlindSpot: Error, not scored (error)");
    expect(first({ status: "inconclusive" })).not.toContain("pending");
  });

  it("lists issues blocking first, then by severity", () => {
    const md = reportToMarkdown(
      report({
        issues: [
          issue({ title: "Minor thing", severity: "minor" }),
          issue({ title: "Serious thing", severity: "serious" }),
          issue({ title: "Moderate blocker", severity: "moderate", blocking: true }),
          issue({ title: "Critical thing", severity: "critical" }),
        ],
      }),
    );
    const titles = tableRows(md).map((r) => r.split(" | ")[3]);
    expect(titles).toEqual(["Moderate blocker", "Critical thing", "Serious thing", "Minor thing"]);
    const headings = md.split("\n").filter((l) => l.startsWith("### "));
    expect(headings).toEqual(["### 1. Moderate blocker", "### 2. Critical thing", "### 3. Serious thing", "### 4. Minor thing"]);
    expect(tableRows(md)[0]).toContain("**Yes**");
  });

  it("escapes pipes so report text cannot add table cells", () => {
    const md = reportToMarkdown(
      report({
        issues: [
          issue({ title: "a | b || c", element: { role: "button", name: "x|y\\|z\\\\|w" }, wcag: ["4.1.2 | evil"] }),
        ],
      }),
    );
    const rows = tableRows(md);
    expect(rows).toHaveLength(1);
    expect(separators(rows[0])).toBe(7); // 6 columns
    expect(separators("| # | Severity | Blocking | Issue | WCAG | Element |")).toBe(7);
  });

  it("never lets a fix or HTML snippet break out of its code fence", () => {
    const fix = "Use this:\n```\n</details>\n# not a heading\n````\nstill code";
    const html = '<button>``` x</button>';
    const md = reportToMarkdown(report({ issues: [issue({ fix, element: { role: "button", name: "", html } })] }));
    const blocks = fencedBlocks(md);
    expect(blocks).toContain(fix);
    expect(blocks).toContain(html);
    // The heading inside the fix stays inside the block.
    expect(md.split("\n").filter((l) => l.startsWith("#")).every((l) => !l.includes("not a heading") || blocks.some((b) => b.includes(l)))).toBe(true);
    expect(md).toContain("`````html");
    // The <details> element is closed exactly once, after the fences.
    const outside = md.replace(/^(`{3,})[\s\S]*?^\1\s*$/gm, "");
    expect(outside.match(/<\/details>/g)).toHaveLength(1);
  });

  it("escapes Markdown and HTML in prose", () => {
    const md = reportToMarkdown(
      report({
        task: "Click <img src=x onerror=alert(1)> and [link](javascript:alert(1))",
        summary: "# Heading\n- list\n**bold** &amp;",
        issues: [issue({ title: "<script>", description: "1. not a list\n> not a quote" })],
      }),
    );
    // Only escaped occurrences (preceded by a backslash) remain.
    expect(md).not.toMatch(/(?<!\\)<img/);
    expect(md).not.toMatch(/(?<!\\)<script>/);
    expect(md).not.toMatch(/(?<!\\)\]\(javascript/);
    expect(md).toContain("\\<img src=x onerror=alert(1)\\>");
    expect(md).toContain("> \\# Heading");
    expect(md).toContain("> \\- list");
    expect(md).toContain("\\*\\*bold\\*\\* \\&amp;");
    expect(md).toContain("1\\. not a list");
    expect(md).toContain("\\> not a quote");
  });

  it("puts each issue's description, WCAG, element and fix in its section", () => {
    const md = reportToMarkdown(
      report({
        issues: [
          issue({
            title: "Name field has no label",
            severity: "serious",
            source: "scan",
            stepIndex: 2,
            wcag: ["1.3.1 Info and Relationships", "4.1.2 Name, Role, Value"],
            element: { role: "textbox", name: "" },
            fix: '<label for="n">Name</label>',
          }),
        ],
      }),
    );
    expect(md).toContain("**Serious** · found by the automated scan · at step 2");
    expect(md).toContain("**WCAG 2.2:** 1.3.1 Info and Relationships; 4.1.2 Name, Role, Value");
    expect(md).toContain('**Element:** `textbox ""` (no accessible name)');
    expect(md).toContain('```html\n<label for="n">Name</label>\n```');
    expect(tableRows(md)[0]).toContain("| 1.3.1, 4.1.2 |");
  });

  it("collapses the steps in a details element", () => {
    const md = reportToMarkdown(report());
    expect(md).toContain("<details>\n<summary>Steps the agent took (2)</summary>\n");
    expect(md).toContain('1. Clicked `link "Book"`\n   Opened the form');
    expect(md).toContain('2. Typed "Alex Doe" into `textbox ""` **(failed)**');
    expect(md.trimEnd().endsWith("_")).toBe(true);
  });

  it("does not link non-http URLs", () => {
    const md = reportToMarkdown(report({ url: "javascript:alert(1)" }));
    expect(md).toContain("**URL:** `javascript:alert(1)`");
  });

  it("renders the sample fixture", () => {
    const md = reportToMarkdown(fixture);
    expect(tableRows(md)).toHaveLength(fixture.issues.length);
    for (const row of tableRows(md)) expect(separators(row)).toBe(7);
    expect(md.match(/^### /gm)).toHaveLength(fixture.issues.length);
    expect(fencedBlocks(md).length).toBeGreaterThanOrEqual(fixture.issues.length);
  });
});

describe("markdown helpers", () => {
  it("codeSpan uses a longer backtick run than the content", () => {
    expect(codeSpan("plain")).toBe("`plain`");
    expect(codeSpan("a`b")).toBe("``a`b``");
    expect(codeSpan("`x`")).toBe("`` `x` ``");
  });

  it("codeBlock uses a fence longer than any backtick run", () => {
    expect(codeBlock("x")).toBe("```\nx\n```");
    expect(codeBlock("````", "html")).toBe("`````html\n````\n`````");
  });

  it("escapeMarkdown keeps plain text readable", () => {
    expect(escapeMarkdown("The doctor picker has no name.")).toBe("The doctor picker has no name.");
    expect(escapeMarkdown("Q&A")).toBe("Q&A");
  });
});
