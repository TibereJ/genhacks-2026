import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { runTest } from "./core/agent.js";
import { ClaudeBrain } from "./core/brains/claude.js";
import { ScriptedBrain, clinicDemoPlan } from "./core/brains/scripted.js";
import { callAgentSession, startAgentSession } from "./core/brains/external.js";
import { listReports, loadReport, markInterruptedReports, newReportId, reportDir } from "./core/report.js";
import { reportToMarkdown } from "./core/export.js";
import { checkPublicTarget, claudeAllowed, isPublicInstance } from "./core/url-guard.js";

const PORT = Number(process.env.PORT || 3000);
// Loopback by default: the API drives a real browser, so only expose it on purpose (the Docker image sets HOST=0.0.0.0).
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = process.cwd();
const MAX_CONCURRENT_RUNS = Number(process.env.BLINDSPOT_MAX_RUNS || 2);
let activeRuns = 0;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg",
  ".ico": "image/x-icon", ".woff2": "font/woff2",
};

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/** Serve a file from `base`, refusing anything that resolves outside it. Answers 400 to malformed escapes. */
async function serveStatic(res: http.ServerResponse, base: string, rel: string): Promise<boolean> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    send(res, 400, { error: "Malformed URL" });
    return true;
  }
  const file = path.resolve(base, "." + path.posix.normalize("/" + decoded));
  if (file !== base && !file.startsWith(base + path.sep)) return false;
  let target = file;
  try {
    if ((await stat(target)).isDirectory()) target = path.join(target, "index.html");
    const data = await readFile(target);
    res.writeHead(200, { "content-type": MIME[path.extname(target)] ?? "application/octet-stream" });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 16_384) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

/** POST bodies must be JSON (which forces a CORS preflight on cross-site requests). */
function isJsonRequest(req: http.IncomingMessage): boolean {
  const type = req.headers["content-type"];
  return typeof type === "string" && type.split(";")[0].trim().toLowerCase() === "application/json";
}

/**
 * Refuses requests sent by another site's page (CSRF): when the browser sends an Origin header, its host must be
 * this server's Host (or X-Forwarded-Host, for reverse proxies that rewrite Host). No Origin (curl, MCP) is fine.
 */
function isSameOrigin(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false; // "null" (sandboxed iframes, file://) or garbage
  }
  const forwarded = req.headers["x-forwarded-host"];
  const hosts = [req.headers.host, ...(typeof forwarded === "string" ? forwarded.split(",") : forwarded ?? [])]
    .filter((h): h is string => typeof h === "string" && h.trim() !== "")
    .map((h) => h.trim().toLowerCase());
  return hosts.includes(originHost);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const p = url.pathname;

    if (req.method === "POST") {
      if (!isSameOrigin(req)) return send(res, 403, { error: "Cross-origin requests are not allowed" });
      if (!isJsonRequest(req)) return send(res, 415, { error: "Expected content-type: application/json" });
    }

    if (req.method === "GET" && p === "/api/reports") return send(res, 200, await listReports());

    const reportMatch = /^\/api\/reports\/([a-z0-9-]+)$/i.exec(p);
    if (req.method === "GET" && reportMatch) {
      const report = await loadReport(reportMatch[1]);
      return report ? send(res, 200, report) : send(res, 404, { error: "Report not found" });
    }

    const markdownMatch = /^\/api\/reports\/([a-z0-9-]+)\/markdown$/i.exec(p);
    if (req.method === "GET" && markdownMatch) {
      const report = await loadReport(markdownMatch[1]);
      if (!report) return send(res, 404, { error: "Report not found" });
      res.writeHead(200, {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="blindspot-${markdownMatch[1]}.md"`,
        "cache-control": "no-store",
      });
      return void res.end(reportToMarkdown(report));
    }

    if (req.method === "POST" && p === "/api/runs") {
      const body = (await readJson(req).catch(() => null)) as { url?: unknown; task?: unknown; brain?: unknown } | null;
      if (!body || typeof body.url !== "string" || typeof body.task !== "string" || !body.task.trim()) {
        return send(res, 400, { error: "Expected JSON {url, task, brain}" });
      }
      let target: URL;
      try {
        // Relative URLs (like /demo/bad/index.html) point at this server.
        target = new URL(body.url, `http://localhost:${PORT}`);
      } catch {
        return send(res, 400, { error: "Invalid URL" });
      }
      if (target.protocol !== "http:" && target.protocol !== "https:") return send(res, 400, { error: "Only http and https URLs can be tested" });
      if (activeRuns >= MAX_CONCURRENT_RUNS) return send(res, 429, { error: "Too many tests running, try again in a minute" });

      const brainName = body.brain === "scripted" ? "scripted" : "claude";
      if (isPublicInstance()) {
        // Public instance: no private/local targets (SSRF) and no spending the API key unless allowed. See docs/DEPLOY.md.
        if (brainName === "claude" && !claudeAllowed()) return send(res, 403, { error: "The Claude agent is disabled on this public instance. Use the scripted demo instead." });
        const verdict = await checkPublicTarget(target, { selfPort: PORT });
        if (!verdict.ok) return send(res, 403, { error: verdict.reason });
      }
      if (brainName === "claude" && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
        return send(res, 400, { error: "No Claude API key configured on the server (set ANTHROPIC_API_KEY). Use the scripted demo instead." });
      }
      const brain = brainName === "scripted" ? new ScriptedBrain(clinicDemoPlan) : new ClaudeBrain();
      const id = newReportId();
      activeRuns++;
      const requestGuard = isPublicInstance()
        ? async (u: URL) => { const v = await checkPublicTarget(u, { selfPort: PORT }); return v.ok ? null : v.reason; }
        : undefined;
      runTest({ id, url: target.href, task: body.task.trim().slice(0, 500), brain, requestGuard })
        .catch((err) => console.error("run failed", err))
        .finally(() => { activeRuns--; });
      return send(res, 202, { id });
    }

    // External agent API: another AI agent (e.g. Claude Code) drives the test one tool call at a time.
    // Disabled on public instances: it lets the caller steer the server's browser.
    if (req.method === "POST" && p.startsWith("/api/agent/") && !isPublicInstance()) {
      const body = (await readJson(req).catch(() => null)) as Record<string, unknown> | null;
      if (!body) return send(res, 400, { error: "Expected a JSON body" });
      if (p === "/api/agent/start") {
        if (typeof body.url !== "string" || typeof body.task !== "string") return send(res, 400, { error: "Expected {url, task}" });
        let target: URL;
        try { target = new URL(body.url, `http://localhost:${PORT}`); } catch { return send(res, 400, { error: "Invalid URL" }); }
        if (target.protocol !== "http:" && target.protocol !== "https:") return send(res, 400, { error: "Only http and https URLs can be tested" });
        try {
          return send(res, 200, await startAgentSession(target.href, body.task.slice(0, 500), typeof body.model === "string" ? body.model : undefined));
        } catch (err) {
          return send(res, 502, { error: (err as Error).message });
        }
      }
      const call = /^\/api\/agent\/([a-z0-9-]+)\/([a-z_]+)$/i.exec(p);
      if (call) {
        try {
          return send(res, 200, { result: await callAgentSession(call[1], call[2], body) });
        } catch (err) {
          return send(res, 404, { error: (err as Error).message });
        }
      }
    }

    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed" });

    const shot = /^\/reports\/([a-z0-9-]+)\/(step-\d+\.png)$/i.exec(p);
    if (shot && (await serveStatic(res, reportDir(shot[1]), shot[2]))) return;
    if (p.startsWith("/demo/") && (await serveStatic(res, path.join(ROOT, "demo-site"), p.slice("/demo/".length)))) return;
    if (!p.startsWith("/api/") && (await serveStatic(res, path.join(ROOT, "report-ui"), p === "/" ? "index.html" : p.slice(1)))) return;

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: "Internal error" });
  }
});

// A report still "running" on disk belongs to a test that died with a previous server process.
await markInterruptedReports().catch((err) => console.error("Could not check for interrupted reports", err));

server.listen(PORT, HOST, () => {
  const shown = HOST === "0.0.0.0" || HOST === "::" ? "localhost" : HOST.includes(":") ? `[${HOST}]` : HOST;
  console.log(`BlindSpot running at http://${shown}:${PORT}`);
});
