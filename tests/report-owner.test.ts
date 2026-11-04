// Who owns a running report (running.pid), and when markInterruptedReports may mark it as interrupted.
import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = await mkdtemp(path.join(os.tmpdir(), "blindspot-owner-"));
process.env.BLINDSPOT_REPORTS_DIR = dir;
const { OWNER_FILE, STALE_AFTER_MS, markInterruptedReports, ownerAlive, parseOwner, saveReport } = await import("../src/core/report.js");
type Report = import("../src/core/types.js").Report;

const running = (id: string): Report => ({
  id, url: "http://example.com/", task: "t", model: "scripted", status: "running", summary: "",
  startedAt: new Date().toISOString(), steps: [], issues: [],
});

/** A running report left on disk by another process, with this owner file (or none). */
async function leftBehind(id: string, owner?: string, savedMinutesAgo = 0) {
  await mkdir(path.join(dir, id), { recursive: true });
  const file = path.join(dir, id, "report.json");
  await writeFile(file, JSON.stringify(running(id)));
  if (owner !== undefined) await writeFile(path.join(dir, id, OWNER_FILE), owner);
  if (savedMinutesAgo) {
    const t = new Date(Date.now() - savedMinutesAgo * 60_000);
    await utimes(file, t, t);
  }
}

const statusOf = async (id: string) => JSON.parse(await readFile(path.join(dir, id, "report.json"), "utf8")).status as string;

describe("running.pid", () => {
  it("is written as JSON with the pid, host name and start time", async () => {
    await saveReport(running("mine"));
    const owner = JSON.parse(await readFile(path.join(dir, "mine", OWNER_FILE), "utf8"));
    expect(owner).toMatchObject({ pid: process.pid, host: os.hostname() });
    expect(Date.parse(owner.startedAt)).not.toBeNaN();
  });

  it("is read in the new and the old (plain pid) format", () => {
    expect(parseOwner('{"pid":42,"host":"box","startedAt":"2026-11-04T10:00:00.000Z"}')).toEqual({ pid: 42, host: "box", startedAt: "2026-11-04T10:00:00.000Z" });
    expect(parseOwner("42\n")).toEqual({ pid: 42 });
    for (const bad of ["", "abc", "-1", "0", "{", '{"pid":"42"}', "{}"]) expect(parseOwner(bad), bad).toBeUndefined();
  });

  it("counts an owner on another machine as alive, and our own pid as dead", () => {
    const never = () => false;
    const always = () => true;
    expect(ownerAlive({ pid: 42, host: "other-box" }, never, "this-box")).toBe(true);
    expect(ownerAlive({ pid: 42, host: "this-box" }, never, "this-box")).toBe(false);
    expect(ownerAlive({ pid: 42, host: "this-box" }, always, "this-box")).toBe(true);
    expect(ownerAlive({ pid: 42 }, always, "this-box")).toBe(true); // old format: assumed to be this machine
    expect(ownerAlive({ pid: process.pid, host: "this-box" }, always, "this-box")).toBe(false);
    expect(ownerAlive(undefined, always)).toBe(false);
  });
});

describe("markInterruptedReports", () => {
  it("leaves live owners alone and marks dead, unknown and stale ones as interrupted", async () => {
    const live = 999_999;
    const isAlive = (pid: number) => pid === live;
    await leftBehind("live-json", JSON.stringify({ pid: live, host: os.hostname(), startedAt: new Date().toISOString() }));
    await leftBehind("live-plain", String(live));
    await leftBehind("dead-json", JSON.stringify({ pid: 123, host: os.hostname() }));
    await leftBehind("dead-plain", "123");
    await leftBehind("no-owner");
    await leftBehind("other-host", JSON.stringify({ pid: 123, host: `not-${os.hostname()}` }));
    await leftBehind("stale-live", JSON.stringify({ pid: live, host: os.hostname() }), STALE_AFTER_MS / 60_000 + 1);
    await leftBehind("stale-other-host", JSON.stringify({ pid: 123, host: `not-${os.hostname()}` }), 31);
    await leftBehind("recent-live", String(live), 29);

    const changed = await markInterruptedReports(isAlive);
    expect(changed.sort()).toEqual(["dead-json", "dead-plain", "no-owner", "stale-live", "stale-other-host"]);
    for (const id of ["live-json", "live-plain", "other-host", "recent-live", "mine"]) expect(await statusOf(id), id).toBe("running");
    for (const id of changed) expect(await statusOf(id), id).toBe("error");
  });
});
