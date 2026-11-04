// Shared data types for BlindSpot. The report JSON written to disk and served by the
// API follows `Report` exactly, so the report UI can rely on it.

export type Severity = "critical" | "serious" | "moderate" | "minor";

export type RunStatus = "running" | "success" | "blocked" | "step_limit" | "error";

/** An element as a screen reader user would perceive it. */
export interface ElementRef {
  /** Short-lived id shown to the agent in the transcript, e.g. [12]. Only valid for one snapshot. */
  id: number;
  role: string;
  name: string;
}

export type ActionType = "click" | "type" | "select" | "press" | "back" | "finish";

export interface StepAction {
  type: ActionType;
  target?: ElementRef;
  /** Text typed, option selected or key pressed. */
  value?: string;
}

export interface Step {
  index: number;
  /** URL of the page when the action was taken. */
  url: string;
  /** Why the agent chose this action, in its own words. */
  reason: string;
  action: StepAction;
  /** What the screen reader announced as a result (focus change, alerts, new page). */
  result: string;
  /** False if the action could not be performed (e.g. element not operable). */
  ok: boolean;
  /** Screenshot path relative to the report folder, e.g. "step-3.png". For human readers only: the agent never sees it. */
  screenshot?: string;
  /** Screen reader transcript of the page the agent saw before acting (what a blind user would hear). */
  heard: string;
}

export interface Issue {
  id: string;
  severity: Severity;
  title: string;
  description: string;
  /** WCAG 2.2 success criteria, e.g. ["4.1.2 Name, Role, Value"]. */
  wcag: string[];
  /** Concrete fix for developers, ideally with a code snippet. */
  fix: string;
  /** Step during which the issue was found. */
  stepIndex: number;
  element?: { role: string; name: string; html?: string };
  /** "agent": found by the AI while doing the task. "scan": found by the deterministic checks. */
  source: "agent" | "scan";
  /** True when this issue prevented the task from being completed. */
  blocking: boolean;
}

export interface Report {
  id: string;
  url: string;
  task: string;
  model: string;
  status: RunStatus;
  /** Agent's final summary, in plain language. */
  summary: string;
  startedAt: string;
  finishedAt?: string;
  steps: Step[];
  issues: Issue[];
  /** 0-100, see scoring in report.ts. Present once the run has finished. */
  score?: number;
  /** Error message when status is "error". */
  error?: string;
}
