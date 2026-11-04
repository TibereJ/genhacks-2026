import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Report, Severity } from "./types.js";

export const REPORTS_DIR = path.resolve(process.env.BLINDSPOT_REPORTS_DIR || "reports");

const PENALTY: Record<Severity, number> = { critical: 25, serious: 10, moderate: 5, minor: 2 };

/**
 * 0-100. Starts at 100 if the task was completed, 40 if not, then subtracts per issue
 * (capped so that many minor issues alone cannot bring a working site below 50).
 */
export function computeScore(report: Report): number {
  const completed = report.status === "success";
  let penalty = 0;
  for (const issue of report.issues) penalty += PENALTY[issue.severity];
  const base = completed ? 100 : 40;
  const floor = completed ? 50 : 0;
  return Math.max(floor, Math.min(100, base - Math.min(penalty, completed ? 50 : 40)));
}

export function reportDir(id: string): string {
  if (!/^[a-z0-9-]+$/i.test(id)) throw new Error("invalid report id");
  return path.join(REPORTS_DIR, id);
}

/**
 * Next to a running report: which process runs the test, as JSON {pid, host, startedAt}, so other processes leave
 * it alone. Older versions wrote the pid alone.
 */
export const OWNER_FILE = "running.pid";
const owned = new Set<string>();

export interface ReportOwner {
  pid: number;
  /** os.hostname() of the machine running the test: a pid only means something on that machine. */
  host?: string;
  startedAt?: string;
}

/** Reads running.pid in either format: JSON {pid, host, startedAt}, or a plain pid. */
export function parseOwner(text: string): ReportOwner | undefined {
  const raw = text.trim();
  let pid: unknown = Number(raw);
  let host: string | undefined;
  let startedAt: string | undefined;
  if (raw.startsWith("{")) {
    try {
      const o = JSON.parse(raw) as Record<string, unknown>;
      pid = o.pid;
      host = typeof o.host === "string" ? o.host : undefined;
      startedAt = typeof o.startedAt === "string" ? o.startedAt : undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return undefined;
  return { pid, ...(host !== undefined ? { host } : {}), ...(startedAt !== undefined ? { startedAt } : {}) };
}

export async function saveReport(report: Report): Promise<void> {
  const dir = reportDir(report.id);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "report.json");
  if (report.status === "running" && !owned.has(report.id)) {
    const owner: ReportOwner = { pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString() };
    await writeFile(path.join(dir, OWNER_FILE), JSON.stringify(owner));
    owned.add(report.id);
  }
  // Write then rename, so readers polling the file never see half a report.
  await writeFile(file + ".tmp", JSON.stringify(report, null, 2));
  await rename(file + ".tmp", file);
  if (report.status !== "running" && owned.delete(report.id)) await rm(path.join(dir, OWNER_FILE), { force: true });
}

export const INTERRUPTED_ERROR = "Interrupted: the BlindSpot server restarted during this test.";

const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** A running report not saved for this long is abandoned, whatever its owner file says (a test saves after every step). */
export const STALE_AFTER_MS = 30 * 60_000;

/**
 * True when the process in `owner` may still be running the test. An owner on another machine (a reports folder
 * shared over the network) cannot be checked, so it counts as alive; our own pid counts as dead, since a container
 * restart can hand the same pid to the new process.
 */
export function ownerAlive(owner: ReportOwner | undefined, isAlive: (pid: number) => boolean = processAlive, host = os.hostname()): boolean {
  if (!owner) return false;
  if (owner.host !== undefined && owner.host !== host) return true;
  return owner.pid !== process.pid && isAlive(owner.pid);
}

/**
 * Marks as "error" every report still "running" whose test died with its process (server or MCP restart),
 * so the UI does not show it as live forever. Reports owned by another live process (for example the MCP
 * server and the HTTP server sharing one reports folder) are left alone, unless the report was not saved for
 * STALE_AFTER_MS. Returns the ids it changed.
 */
export async function markInterruptedReports(isAlive: (pid: number) => boolean = processAlive, now = Date.now()): Promise<string[]> {
  let ids: string[] = [];
  try { ids = await readdir(REPORTS_DIR); } catch { return []; }
  const changed: string[] = [];
  for (const id of ids) {
    if (!/^[a-z0-9-]+$/i.test(id) || owned.has(id)) continue;
    const report = await loadReport(id);
    if (report?.status !== "running") continue;
    const owner = parseOwner(await readFile(path.join(reportDir(id), OWNER_FILE), "utf8").catch(() => ""));
    const savedAt = (await stat(path.join(reportDir(id), "report.json")).catch(() => undefined))?.mtimeMs ?? 0;
    if (now - savedAt <= STALE_AFTER_MS && ownerAlive(owner, isAlive)) continue;
    report.status = "error";
    report.error = INTERRUPTED_ERROR;
    report.summary ||= `The test stopped because of an error: ${INTERRUPTED_ERROR}`;
    report.finishedAt = new Date().toISOString();
    delete report.score;
    await saveReport(report);
    await rm(path.join(reportDir(id), OWNER_FILE), { force: true });
    changed.push(id);
  }
  return changed;
}

export async function loadReport(id: string): Promise<Report | undefined> {
  try {
    return JSON.parse(await readFile(path.join(reportDir(id), "report.json"), "utf8")) as Report;
  } catch {
    return undefined;
  }
}

export async function listReports(): Promise<Pick<Report, "id" | "url" | "task" | "status" | "score" | "startedAt">[]> {
  let ids: string[] = [];
  try { ids = await readdir(REPORTS_DIR); } catch { return []; }
  const reports = (await Promise.all(ids.map((id) => (/^[a-z0-9-]+$/i.test(id) ? loadReport(id) : undefined))))
    .filter((r): r is Report => r !== undefined)
    .map(({ id, url, task, status, score, startedAt }) => ({ id, url, task, status, score, startedAt }));
  return reports.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function newReportId(): string {
  const now = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `${now}-${Math.random().toString(36).slice(2, 8)}`;
}
