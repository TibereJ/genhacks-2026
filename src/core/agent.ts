import path from "node:path";
import { mkdir } from "node:fs/promises";
import { BrowserSession, type BrowserAction, type RequestGuard } from "./browser.js";
import type { Snapshot } from "./ax-tree.js";
import { scanPage } from "./scan.js";
import { computeScore, newReportId, reportDir, saveReport } from "./report.js";
import { ACTION_TOOLS, TOOL_INPUTS, type ToolName } from "./tools.js";
import type { Brain, BrainTurn, ToolOutcome } from "./brains/brain.js";
import type { Issue, Report, Step, StepAction } from "./types.js";

export interface RunOptions {
  url: string;
  task: string;
  brain: Brain;
  id?: string;
  maxSteps?: number;
  /** Blocks requests the browser must not make (see BrowserSession.open). */
  requestGuard?: RequestGuard;
  /** Called after every change to the report (it is also saved to disk). */
  onUpdate?: (report: Report) => void;
}

const transcriptBlock = (s: Snapshot) => `Screen reader transcript:\n${s.text}`;

/** Runs one test: the brain tries to complete the task using only the screen reader transcript. */
export async function runTest(opts: RunOptions): Promise<Report> {
  const maxSteps = opts.maxSteps ?? 30;
  const report: Report = {
    id: opts.id ?? newReportId(),
    url: opts.url,
    task: opts.task,
    model: opts.brain.model,
    status: "running",
    summary: "",
    startedAt: new Date().toISOString(),
    steps: [],
    issues: [],
  };
  const dir = reportDir(report.id);
  await mkdir(dir, { recursive: true });
  const publish = async () => { await saveReport(report); opts.onUpdate?.(report); };
  await publish();

  let session: BrowserSession | undefined;
  try {
    session = await BrowserSession.open(opts.url, opts.requestGuard);
    let snapshot = await session.snapshot();
    const scanned = new Set<string>();
    const scan = async (s: Snapshot, stepIndex: number) => {
      const key = s.url.split("#")[0];
      if (scanned.has(key)) return;
      scanned.add(key);
      const page = s.title || s.url;
      for (const f of await scanPage(session!.page, s)) {
        // The same rule failing on several pages (e.g. a shared header) is one issue, not one per page.
        const existing = report.issues.find((i) => i.source === "scan" && i.title === f.title);
        if (existing) {
          if (!existing.description.includes(`"${page}"`)) existing.description += ` The same problem is also on "${page}".`;
          continue;
        }
        report.issues.push({ ...f, id: `scan-${report.issues.length + 1}`, stepIndex, source: "scan", blocking: false });
      }
    };
    await scan(snapshot, 0);
    await publish();

    let turn: BrainTurn = await opts.brain.start(opts.task, snapshot.text);
    let idleTurns = 0;

    while (report.status === "running") {
      if (turn.calls.length === 0) {
        if (++idleTurns > 2) throw new Error("The agent stopped calling tools.");
        turn = await opts.brain.nudge("Please continue the test by calling one of the tools (an action, report_issue, or finish).");
        continue;
      }
      idleTurns = 0;

      const outcomes: ToolOutcome[] = [];
      const turnSnapshot = snapshot; // ids in this turn's calls refer to this transcript
      let actionDone = false;
      for (const call of turn.calls) {
        const name = call.name as ToolName;
        const schema = TOOL_INPUTS[name];
        const parsed = schema?.safeParse(call.input);
        if (!schema || !parsed?.success) {
          outcomes.push({ id: call.id, isError: true, content: `Invalid call to ${call.name}: ${parsed?.error?.message ?? "unknown tool"}` });
          continue;
        }
        const input = parsed.data as Record<string, unknown>;

        if (name === "report_issue") {
          const i = input as unknown as { severity: Issue["severity"]; title: string; description: string; wcag: string[]; fix: string; element_id: number | null; blocking: boolean };
          const el = i.element_id != null ? turnSnapshot.elements.get(i.element_id) : undefined;
          report.issues.push({
            id: `agent-${report.issues.length + 1}`,
            severity: i.severity, title: i.title, description: i.description, wcag: i.wcag, fix: i.fix,
            stepIndex: report.steps.length, element: el ? { role: el.role, name: el.name } : undefined,
            source: "agent", blocking: i.blocking,
          });
          outcomes.push({ id: call.id, content: "Issue recorded." });
          continue;
        }

        if (name === "finish") {
          const f = input as { status: "success" | "blocked"; summary: string };
          report.steps.push({
            index: report.steps.length, url: snapshot.url, reason: f.summary, heard: snapshot.text,
            action: { type: "finish", value: f.status }, result: f.status === "success" ? "Task completed." : "Task could not be completed.", ok: true,
          });
          report.status = f.status;
          report.summary = f.summary;
          outcomes.push({ id: call.id, content: "Test finished." });
          break;
        }

        if (!ACTION_TOOLS.includes(name)) continue;
        if (actionDone) {
          outcomes.push({ id: call.id, isError: true, content: "Only one action per turn. This action was not performed; look at the new transcript and decide again." });
          continue;
        }
        actionDone = true;

        const { action, stepAction } = toBrowserAction(name, input, snapshot);
        const step: Step = {
          index: report.steps.length, url: snapshot.url, reason: String(input.reason ?? ""), heard: snapshot.text,
          action: stepAction, result: "", ok: false, screenshot: `step-${report.steps.length}.png`,
        };
        await session.screenshot(path.join(dir, step.screenshot!), "id" in action ? snapshot.elements.get(action.id) : undefined);
        const outcome = await session.act(action, snapshot);
        step.ok = outcome.ok;
        step.result = outcome.result;
        report.steps.push(step);
        snapshot = outcome.snapshot;
        await scan(snapshot, step.index + 1);
        outcomes.push({ id: call.id, isError: !outcome.ok, content: `${outcome.result}\n\n${transcriptBlock(snapshot)}` });
      }
      await publish();
      if (report.status !== "running") break;

      if (report.steps.length >= maxSteps) {
        report.status = "step_limit";
        report.summary = `The agent used all ${maxSteps} steps without completing the task. This usually means the task is very hard to do with a screen reader.`;
        break;
      }
      // Answer every tool call of the turn, even those after "finish" or invalid ones.
      for (const call of turn.calls) {
        if (!outcomes.some((o) => o.id === call.id)) outcomes.push({ id: call.id, content: "Not performed." });
      }
      turn = await opts.brain.continue(outcomes);
    }
  } catch (err) {
    report.status = "error";
    report.error = (err as Error).message;
    report.summary ||= `The test stopped because of an error: ${report.error}`;
  } finally {
    await session?.close().catch(() => {});
  }

  report.finishedAt = new Date().toISOString();
  report.score = report.status === "error" ? undefined : computeScore(report);
  await publish();
  return report;
}

function toBrowserAction(name: ToolName, input: Record<string, unknown>, snapshot: Snapshot): { action: BrowserAction; stepAction: StepAction } {
  const target = (id: number) => {
    const el = snapshot.elements.get(id);
    return { id, role: el?.role ?? "unknown", name: el?.name ?? "" };
  };
  switch (name) {
    case "click": {
      const id = input.id as number;
      return { action: { type: "click", id }, stepAction: { type: "click", target: target(id) } };
    }
    case "type_text": {
      const id = input.id as number;
      const text = input.text as string;
      return { action: { type: "type", id, text }, stepAction: { type: "type", target: target(id), value: text } };
    }
    case "select_option": {
      const id = input.id as number;
      const option = input.option as string;
      return { action: { type: "select", id, option }, stepAction: { type: "select", target: target(id), value: option } };
    }
    case "press_key": {
      const key = input.key as string;
      return { action: { type: "press", key }, stepAction: { type: "press", value: key } };
    }
    default:
      return { action: { type: "back" }, stepAction: { type: "back" } };
  }
}
