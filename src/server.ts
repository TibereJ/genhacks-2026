import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { runTest } from "./core/agent.js";
import { ClaudeBrain } from "./core/brains/claude.js";
import { ScriptedBrain, clinicDemoPlan } from "./core/brains/scripted.js";
import { listReports, loadReport, newReportId, reportDir } from "./core/report.js";
import { checkPublicTarget, claudeAllowed, isPublicInstance } from "./core/url-guard.js";

const PORT = Number(process.env.PORT || 3000);
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

/** Serve a file from `base`, refusing anything that resolves outside it. */
async function serveStatic(res: http.ServerResponse, base: string, rel: string): Promise<boolean> {
  const decoded = decodeURIComponent(rel);
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const p = url.pathname;

    if (req.method === "GET" && p === "/api/reports") return send(res, 200, await listReports());

    const reportMatch = /^\/api\/reports\/([a-z0-9-]+)$/i.exec(p);
    if (req.method === "GET" && reportMatch) {
      const report = await loadReport(reportMatch[1]);
      return report ? send(res, 200, report) : send(res, 404, { error: "Report not found" });
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
      runTest({ id, url: target.href, task: body.task.trim().slice(0, 500), brain })
        .catch((err) => console.error("run failed", err))
        .finally(() => { activeRuns--; });
      return send(res, 202, { id });
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

server.listen(PORT, () => {
  console.log(`BlindSpot running at http://localhost:${PORT}`);
});
