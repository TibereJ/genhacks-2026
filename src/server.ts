import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { runTest } from "./core/agent.js";
import { ClaudeBrain } from "./core/brains/claude.js";
import { ScriptedBrain, demoPlanFor } from "./core/brains/scripted.js";
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

/** True for an interface only this machine can reach: localhost, 127.0.0.0/8, ::1. */
function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || h === "0:0:0:0:0:0:0:1" || /^(::ffff:)?127\.\d+\.\d+\.\d+$/.test(h);
}

/** The hostname of a Host header value, lowercase, without the port (IPv6 keeps its brackets), or null if invalid. */
function hostnameOf(value: string): string | null {
  try {
    const { hostname, username, password, pathname, search, hash } = new URL(`http://${value.trim()}`);
    if (username || password || pathname !== "/" || search || hash) return null;
    return hostname;
  } catch {
    return null;
  }
}

/**
 * DNS rebinding: a hostile site can point its own domain at 127.0.0.1, so the visitor's browser sends it requests
 * that pass the Origin check (same origin, from the browser's point of view) and can read the answers. On a
 * loopback interface, only accept the Host names this machine uses, plus BLINDSPOT_ALLOWED_HOSTS.
 */
const ALLOWED_HOSTS: Set<string> | null = isLoopbackHost(HOST)
  ? new Set(
      ["localhost", "127.0.0.1", "[::1]", HOST.includes(":") && !HOST.startsWith("[") ? `[${HOST}]` : HOST, ...(process.env.BLINDSPOT_ALLOWED_HOSTS ?? "").split(",")]
        .map((h) => (h.trim() ? hostnameOf(h) : null))
        .filter((h): h is string => h !== null),
    )
  : null;

function isAllowedHost(req: http.IncomingMessage): boolean {
  if (!ALLOWED_HOSTS) return true; // listening on the network (Docker, public instance): any Host
  const hostname = typeof req.headers.host === "string" ? hostnameOf(req.headers.host) : null;
  return hostname !== null && ALLOWED_HOSTS.has(hostname);
}

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
    if (!isAllowedHost(req)) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      return void res.end("Forbidden: unknown Host header. To reach this server under another name, add it to BLINDSPOT_ALLOWED_HOSTS.\n");
    }
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
      const brain = brainName === "scripted" ? new ScriptedBrain(demoPlanFor(target.href)) : new ClaudeBrain();
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
