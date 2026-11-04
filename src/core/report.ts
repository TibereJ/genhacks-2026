import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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

/** Next to a running report: the id of the process running the test, so other processes leave it alone. */
const OWNER_FILE = "running.pid";
const owned = new Set<string>();

export async function saveReport(report: Report): Promise<void> {
  const dir = reportDir(report.id);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "report.json");
  if (report.status === "running" && !owned.has(report.id)) {
    await writeFile(path.join(dir, OWNER_FILE), String(process.pid));
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

/**
 * Marks as "error" every report still "running" whose test died with its process (server or MCP restart),
 * so the UI does not show it as live forever. Reports owned by another live process (for example the MCP
 * server and the HTTP server sharing one reports folder) are left alone. Returns the ids it changed.
 */
export async function markInterruptedReports(isAlive: (pid: number) => boolean = processAlive): Promise<string[]> {
  let ids: string[] = [];
  try { ids = await readdir(REPORTS_DIR); } catch { return []; }
  const changed: string[] = [];
  for (const id of ids) {
    if (!/^[a-z0-9-]+$/i.test(id) || owned.has(id)) continue;
    const report = await loadReport(id);
    if (report?.status !== "running") continue;
    const owner = Number(await readFile(path.join(reportDir(id), OWNER_FILE), "utf8").catch(() => ""));
    // A container restart can hand the same pid to the new process, so our own pid counts as dead.
    if (Number.isInteger(owner) && owner > 0 && owner !== process.pid && isAlive(owner)) continue;
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
