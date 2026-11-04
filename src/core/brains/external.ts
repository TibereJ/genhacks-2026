import { runTest } from "../agent.js";
import { newReportId } from "../report.js";
import type { Report } from "../types.js";
import type { Brain, BrainTurn, ToolCall, ToolOutcome } from "./brain.js";

// A brain driven from outside: another AI agent (for example Claude Code through MCP) makes
// the decisions one tool call at a time. BlindSpot still owns the browser, the transcript,
// the scan and the report, so the external agent only ever gets what a screen reader says.

const IDLE_TIMEOUT_MS = Number(process.env.BLINDSPOT_EXTERNAL_TIMEOUT_MS || 15 * 60_000);

export const BUSY_MESSAGE = "Wait for the result of your previous action before sending another one.";

interface Deferred<T> { promise: Promise<T>; resolve(v: T): void; reject(e: Error): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export class ExternalBrain implements Brain {
  readonly model: string;
  /** Resolves with the first transcript once the page is open. */
  readonly ready = deferred<string>();
  private turnWaiter?: Deferred<BrainTurn>;
  private queue: ToolCall[] = [];
  private waiting = new Map<string, Deferred<string>>();
  private counter = 0;
  private timer?: NodeJS.Timeout;
  private closedMessage?: string;

  constructor(model = "external agent") {
    this.model = model;
    this.ready.promise.catch(() => {});
  }

  start(_task: string, transcript: string): Promise<BrainTurn> {
    this.ready.resolve(transcript);
    return this.awaitTurn();
  }

  continue(outcomes: ToolOutcome[]): Promise<BrainTurn> {
    for (const o of outcomes) {
      const w = this.waiting.get(o.id);
      if (w) { this.waiting.delete(o.id); w.resolve(o.isError ? `Error: ${o.content}` : o.content); }
    }
    return this.awaitTurn();
  }

  nudge(): Promise<BrainTurn> {
    return this.awaitTurn();
  }

  /**
   * Called by the external agent. Resolves with the tool result text. One call at a time: a second call sent
   * before the first is answered would act on a transcript the caller has not seen yet, so it is refused.
   */
  submit(name: string, input: unknown): Promise<string> {
    if (this.closedMessage !== undefined) return Promise.reject(new Error(`This test has already ended. ${this.closedMessage}`));
    if (this.waiting.size > 0) return Promise.reject(new Error(BUSY_MESSAGE));
    const call: ToolCall = { id: `ext_${++this.counter}`, name, input };
    const result = deferred<string>();
    this.waiting.set(call.id, result);
    if (this.turnWaiter) {
      const w = this.turnWaiter;
      this.turnWaiter = undefined;
      clearTimeout(this.timer);
      w.resolve({ calls: [call], text: "" });
    } else {
      this.queue.push(call);
    }
    return result.promise;
  }

  /** The run ended (finish, step limit or error): answer whoever is still waiting. */
  close(message: string): void {
    this.closedMessage = message;
    clearTimeout(this.timer);
    this.queue = [];
    for (const w of this.waiting.values()) w.resolve(message);
    this.waiting.clear();
    this.ready.reject(new Error(message));
  }

  private awaitTurn(): Promise<BrainTurn> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve({ calls: [queued], text: "" });
    const turn = deferred<BrainTurn>();
    this.turnWaiter = turn;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.turnWaiter = undefined;
      turn.reject(new Error("The external agent stopped sending actions (timed out)."));
    }, IDLE_TIMEOUT_MS);
    this.timer.unref?.();
    return turn.promise;
  }
}

export interface AgentSession {
  id: string;
  brain: ExternalBrain;
  done: Promise<Report>;
}

const sessions = new Map<string, AgentSession>();

const finalMessage = (r: Report) =>
  `Test finished with status "${r.status}"${r.score !== undefined ? `, score ${r.score}/100` : ""}. ${r.issues.length} issue(s) recorded.${r.error ? ` Error: ${r.error}` : ""}`;

/** Opens the page and returns the run id plus the first screen reader transcript. */
export async function startAgentSession(url: string, task: string, model?: string): Promise<{ id: string; transcript: string }> {
  const id = newReportId();
  const brain = new ExternalBrain(model);
  const done = runTest({ id, url, task, brain });
  const session: AgentSession = { id, brain, done };
  sessions.set(id, session);
  done.then((r) => brain.close(finalMessage(r)), (e: Error) => brain.close(`Test stopped: ${e.message}`))
    .finally(() => setTimeout(() => sessions.delete(id), 60_000).unref?.());
  try {
    const transcript = await brain.ready.promise;
    return { id, transcript };
  } catch (err) {
    const report = await done;
    throw new Error(report.error ?? (err as Error).message);
  }
}

/** Sends one tool call (click, type_text, …, report_issue, finish) to a running session. */
export async function callAgentSession(id: string, name: string, input: unknown): Promise<string> {
  const session = sessions.get(id);
  if (!session) throw new Error(`No running BlindSpot session "${id}". Start one first.`);
  return session.brain.submit(name, input);
}
