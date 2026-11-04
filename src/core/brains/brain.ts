export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolOutcome {
  id: string;
  content: string;
  isError?: boolean;
}

export interface BrainTurn {
  calls: ToolCall[];
  /** Any free text the model wrote (not shown to the site, kept for debugging). */
  text: string;
}

/**
 * Decides the next actions. The first call receives the task and the first transcript;
 * later calls receive the outcome of every tool call from the previous turn, in order.
 */
export interface Brain {
  readonly model: string;
  start(task: string, transcript: string): Promise<BrainTurn>;
  continue(outcomes: ToolOutcome[]): Promise<BrainTurn>;
  /** Used when the previous turn contained no tool call. */
  nudge(message: string): Promise<BrainTurn>;
}
