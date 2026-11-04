import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Starts the real HTTP server (src/server.ts) in a child process on a free port.

let child: ChildProcess;
let base = "";
let reports = "";
let output = "";
const children: ChildProcess[] = [];

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });

const report = (id: string) => ({
  id, url: "http://example.com/", task: "t", model: "scripted", status: "running", summary: "",
  startedAt: new Date().toISOString(), steps: [], issues: [],
});

/** Starts src/server.ts with these environment variables; resolves once it listens, with its output so far. */
async function startServer(env: Record<string, string>, script = "src/server.ts"): Promise<{ child: ChildProcess; output: () => string }> {
  let out = "";
  const proc = spawn(process.execPath, ["--import", "tsx", script], {
    env: { ...process.env, BLINDSPOT_PUBLIC: "", BLINDSPOT_ALLOWED_HOSTS: "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(proc);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${out}`)), 20_000);
    const onData = (d: Buffer) => {
      out += d.toString();
      if (out.includes("BlindSpot running")) { clearTimeout(timer); resolve(); }
    };
    proc.stdout!.on("data", onData);
    proc.stderr!.on("data", onData);
    proc.once("exit", (code) => reject(new Error(`server exited (${code}):\n${out}`)));
  });
  return { child: proc, output: () => out };
}

beforeAll(async () => {
  reports = await mkdtemp(path.join(os.tmpdir(), "blindspot-server-"));
  // A test left "running" by a dead process, and one still owned by a live process (this test runner).
  for (const id of ["stale-run", "live-run"]) {
    await mkdir(path.join(reports, id));
    await writeFile(path.join(reports, id, "report.json"), JSON.stringify(report(id)));
  }
  await writeFile(path.join(reports, "live-run", "running.pid"), String(process.pid));

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const started = await startServer({
    PORT: String(port), HOST: "127.0.0.1", BLINDSPOT_REPORTS_DIR: reports, BLINDSPOT_ALLOWED_HOSTS: "blindspot.test, Other.Test:8080",
  });
  child = started.child;
  output = started.output();
}, 30_000);

afterAll(() => { for (const c of children) c.kill(); });

/** A request with a chosen Host header (fetch does not let you set it). */
const withHost = (url: string, host: string | undefined, method = "GET") =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(url, { method, headers: { ...(host === undefined ? {} : { host }), "content-type": "application/json" }, setHost: host !== undefined }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode!, body }));
    });
    req.on("error", reject);
    req.end(method === "POST" ? "{}" : undefined);
  });

const post = (p: string, body: string, headers: Record<string, string> = {}) =>
  fetch(base + p, { method: "POST", body, headers });

describe("HTTP server", () => {
  it("listens on 127.0.0.1 when HOST says so", () => {
    expect(output).toContain(`BlindSpot running at ${base}`);
  });

  it("only accepts JSON bodies on POST routes", async () => {
    expect((await post("/api/runs", "{}", { "content-type": "text/plain" })).status).toBe(415);
    expect((await post("/api/runs", "url=x", { "content-type": "application/x-www-form-urlencoded" })).status).toBe(415);
    expect((await post("/api/agent/start", "{}", { "content-type": "text/plain" })).status).toBe(415);
    const noType = await fetch(base + "/api/runs", { method: "POST", body: new Uint8Array([123, 125]) });
    expect(noType.status).toBe(415);
    // Parameters such as charset are fine: the body is checked next.
    expect((await post("/api/runs", "{}", { "content-type": "application/json; charset=utf-8" })).status).toBe(400);
    expect((await post("/api/runs", "{}", { "content-type": "Application/JSON" })).status).toBe(400);
  });

  it("refuses POSTs from another site's pages", async () => {
    const json = { "content-type": "application/json" };
    expect((await post("/api/runs", "{}", { ...json, origin: "https://evil.example" })).status).toBe(403);
    expect((await post("/api/runs", "{}", { ...json, origin: "null" })).status).toBe(403);
    expect((await post("/api/runs", "{}", { ...json, origin: base })).status).toBe(400);
    expect((await post("/api/runs", "{}", { ...json, origin: "https://blindspot.example", "x-forwarded-host": "blindspot.example" })).status).toBe(400);
  });

  it("answers 400 to malformed escapes in static paths", async () => {
    expect((await fetch(`${base}/demo/%E0%A4%A`)).status).toBe(400);
    expect((await fetch(`${base}/%E0%A4%A`)).status).toBe(400);
    expect((await fetch(`${base}/demo/bad/index.html`)).status).toBe(200);
  });

  it("refuses other Host names on a loopback interface (DNS rebinding)", async () => {
    const port = new URL(base).port;
    for (const host of ["evil.example", `evil.example:${port}`, "127.0.0.1.nip.io", "localhost.evil.example", "a b"]) {
      const get = await withHost(`${base}/api/reports`, host);
      expect(get.status, host).toBe(403);
      expect(get.body).toContain("BLINDSPOT_ALLOWED_HOSTS");
      expect((await withHost(`${base}/api/runs`, host, "POST")).status, host).toBe(403);
    }
    expect((await withHost(`${base}/demo/bad/index.html`, "evil.example")).status).toBe(403);
    // No Host header at all: Node itself answers 400 to HTTP/1.1 requests without one.
    expect([400, 403]).toContain((await withHost(`${base}/api/reports`, undefined)).status);
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, "LOCALHOST", `[::1]:${port}`, "blindspot.test", "blindspot.test:443", "other.test"]) {
      expect((await withHost(`${base}/api/reports`, host)).status, host).toBe(200);
    }
    // POSTs from an allowed host reach the body check.
    expect((await withHost(`${base}/api/runs`, `localhost:${port}`, "POST")).status).toBe(400);
  });

  it("accepts any Host name when listening on the network (Docker)", async () => {
    const port = await freePort();
    const other = await startServer({ PORT: String(port), HOST: "0.0.0.0", BLINDSPOT_REPORTS_DIR: reports });
    try {
      expect((await withHost(`http://127.0.0.1:${port}/api/reports`, "blindspot.example.com")).status).toBe(200);
    } finally {
      other.child.kill();
    }
  }, 30_000);

  it("marks tests interrupted by a restart as errors at startup", async () => {
    const stale = JSON.parse(await readFile(path.join(reports, "stale-run", "report.json"), "utf8"));
    expect(stale.status).toBe("error");
    expect(stale.error).toBe("Interrupted: the BlindSpot server restarted during this test.");
    expect(stale.finishedAt).toBeTruthy();
    const live = JSON.parse(await readFile(path.join(reports, "live-run", "report.json"), "utf8"));
    expect(live.status).toBe("running");
  });
});

describe("npm run examples", () => {
  it("serves a temporary copy of examples/reports, so new runs never land in the repository", async () => {
    const shipped = readdirSync("examples/reports").filter((d) => /^[a-z0-9-]+$/i.test(d)).sort();
    const port = await freePort();
    const examples = await startServer({ PORT: String(port), HOST: "127.0.0.1", BLINDSPOT_REPORTS_DIR: "" }, "src/examples.ts");
    let dir = "";
    try {
      const match = /Serving a copy of the example reports from (\S+)\. New runs are saved there/.exec(examples.output());
      expect(match, examples.output()).not.toBeNull();
      dir = match![1];
      expect(path.resolve(dir).startsWith(path.resolve(os.tmpdir()))).toBe(true);
      expect(readdirSync(dir).sort()).toEqual(shipped);
      const list = (await (await fetch(`http://127.0.0.1:${port}/api/reports`)).json()) as { id: string }[];
      expect(list.map((r) => r.id).sort()).toEqual(shipped);
    } finally {
      examples.child.kill();
      if (dir && existsSync(dir)) await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
