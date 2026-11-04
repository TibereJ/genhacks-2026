import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Starts the real HTTP server (src/server.ts) in a child process on a free port.

let child: ChildProcess;
let base = "";
let reports = "";
let output = "";

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });

beforeAll(async () => {
  reports = await mkdtemp(path.join(os.tmpdir(), "blindspot-server-"));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", BLINDSPOT_REPORTS_DIR: reports, BLINDSPOT_PUBLIC: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 20_000);
    const onData = (d: Buffer) => {
      output += d.toString();
      if (output.includes("BlindSpot running")) { clearTimeout(timer); resolve(); }
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    child.once("exit", (code) => reject(new Error(`server exited (${code}):\n${output}`)));
  });
}, 30_000);

afterAll(() => { child?.kill(); });

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

});
