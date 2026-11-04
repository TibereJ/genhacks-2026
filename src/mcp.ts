import http from "node:http";
import type { AddressInfo } from "node:net";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { callAgentSession, startAgentSession } from "./core/brains/external.js";
import { TOOLS, TOOL_INPUTS, type ToolName } from "./core/tools.js";

// MCP server: lets a coding agent (Claude Code, or any MCP client) act as BlindSpot's brain.
// The agent never sees the page: every tool answers with what a screen reader would announce.
// Stdout carries the MCP protocol, so log only to stderr.

const UI_URL = process.env.BLINDSPOT_UI_URL || "http://localhost:3000";
const DEMO_DIR = path.resolve(process.cwd(), "demo-site");

let demoBase: Promise<string> | undefined;
/** Serves demo-site/ on a random local port the first time a /demo/ URL is tested. */
function demoServer(): Promise<string> {
  demoBase ??= new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const rel = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname).replace(/^\/demo\//, "");
      let file = path.resolve(DEMO_DIR, "." + path.posix.normalize("/" + rel));
      if (!file.startsWith(DEMO_DIR + path.sep)) { res.writeHead(404).end(); return; }
      try {
        if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
        const type = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(file)] ?? "application/octet-stream";
        res.writeHead(200, { "content-type": `${type}; charset=utf-8` }).end(await readFile(file));
      } catch {
        res.writeHead(404).end("Not found");
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
    server.unref();
  });
  return demoBase;
}

const server = new McpServer(
  { name: "blindspot", version: "0.1.0" },
  {
    instructions: `BlindSpot tests whether a blind person using a screen reader can complete a task on a website. You play that person.
Start with blindspot_start, then use the action tools one at a time. Every result is the screen reader transcript: elements you can operate are numbered like [12] button "Book".
Rules for an honest test: do NOT look at the page another way (no fetching the HTML, no reading the site's source files, no screenshots). Only use what the transcript tells you, like a real screen reader user.
Report each accessibility problem with blindspot_report_issue as you meet it, then end with blindspot_finish ("success" only if the site confirmed the task is done).`,
  },
);

const session = z.string().describe("Session id returned by blindspot_start.");
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (t: string) => ({ content: [{ type: "text" as const, text: t }], isError: true });

server.registerTool(
  "blindspot_start",
  {
    title: "Start a BlindSpot test",
    description: "Open a website in BlindSpot's browser and get the first screen reader transcript. Relative URLs starting with /demo/ use the bundled demo sites, e.g. /demo/bad/index.html.",
    inputSchema: {
      url: z.string().describe("Absolute http(s) URL, or /demo/... for the bundled demos."),
      task: z.string().describe("What a screen reader user should be able to do, e.g. \"Book an appointment with Dr. Lee\"."),
    },
  },
  async ({ url, task }) => {
    try {
      const target = url.startsWith("/demo/") ? `${await demoServer()}${url}` : new URL(url).href;
      if (!/^https?:/.test(target)) return fail("Only http and https URLs can be tested.");
      const { id, transcript } = await startAgentSession(target, task, "Claude Code (via MCP)");
      return text(`Session: ${id}\nLive report: ${UI_URL}/#/report/${id} (if the BlindSpot server is running)\n\nTask: ${task}\n\nScreen reader transcript:\n${transcript}`);
    } catch (err) {
      return fail(`Could not start the test: ${(err as Error).message}`);
    }
  },
);

// One MCP tool per BlindSpot agent tool, with the same descriptions and schemas plus a session id.
for (const tool of TOOLS) {
  const name = tool.name as ToolName;
  const schema = TOOL_INPUTS[name];
  server.registerTool(
    `blindspot_${name}`,
    { description: tool.description, inputSchema: { session, ...schema.shape } },
    async (args: Record<string, unknown>) => {
      const { session: id, ...input } = args;
      try {
        return text(await callAgentSession(String(id), name, input));
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}

const transport = new StdioServerTransport();
// Open browsers keep the process alive: exit when the client goes away.
transport.onclose = () => process.exit(0);
process.stdin.on("end", () => process.exit(0));
await server.connect(transport);
console.error("BlindSpot MCP server ready");
