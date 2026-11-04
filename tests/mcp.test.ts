import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Drives the real MCP server over stdio, the way Claude Code would, on the bundled demo clinic.

let client: Client;

const textOf = (r: unknown) => ((r as { content: { type: string; text: string }[] }).content[0]?.text ?? "");
const idOf = (transcript: string, re: RegExp) => {
  const line = transcript.split("\n").find((l) => re.test(l));
  const m = line && /\[(\d+)\]/.exec(line);
  if (!m) throw new Error(`No element matching ${re} in:\n${transcript}`);
  return Number(m[1]);
};

beforeAll(async () => {
  const reports = await mkdtemp(path.join(os.tmpdir(), "blindspot-mcp-"));
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/mcp.ts"],
    env: { ...process.env, BLINDSPOT_REPORTS_DIR: reports } as Record<string, string>,
    stderr: "ignore",
  }));
}, 30_000);

afterAll(async () => { await client?.close(); });

describe("MCP server", () => {
  it("lists one tool per agent action", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "blindspot_click", "blindspot_finish", "blindspot_go_back", "blindspot_press_key",
      "blindspot_report_issue", "blindspot_select_option", "blindspot_start", "blindspot_type_text",
    ]);
  });

  it("runs a test on the fixed demo clinic through tool calls", async () => {
    const start = textOf(await client.callTool({ name: "blindspot_start", arguments: { url: "/demo/fixed/index.html", task: "Book with Dr. Lee" } }));
    const session = /Session: (\S+)/.exec(start)![1];
    expect(start).toContain("Screen reader transcript:");

    let t = textOf(await client.callTool({ name: "blindspot_click", arguments: { session, id: idOf(start, /link "Book an appointment"/), reason: "go to form" } }));
    expect(t).toContain("New page loaded");

    t = textOf(await client.callTool({ name: "blindspot_select_option", arguments: { session, id: idOf(t, /combobox "Doctor"/), option: "Dr. Lee", reason: "doctor" } }));
    expect(t).toContain('now has value "Dr. Lee');

    const issue = textOf(await client.callTool({ name: "blindspot_report_issue", arguments: {
      session, severity: "minor", title: "Test issue", description: "d", wcag: ["1.3.1 Info and Relationships"], fix: "f", element_id: null, blocking: false,
    } }));
    expect(issue).toBe("Issue recorded.");

    const end = textOf(await client.callTool({ name: "blindspot_finish", arguments: { session, status: "blocked", summary: "Stopped early for the test." } }));
    expect(end).toMatch(/Test finished with status "blocked", score \d+\/100\. 1 issue/);

    const after = await client.callTool({ name: "blindspot_click", arguments: { session, id: 1, reason: "late" } });
    expect((after as { isError?: boolean }).isError).toBe(true);
  }, 60_000);
});
