import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, TOOLS } from "../tools.js";
import type { Brain, BrainTurn, ToolOutcome } from "./brain.js";

export const DEFAULT_MODEL = "claude-opus-5-5";

/** Brain backed by the Claude API, with a manual tool-use loop driven by the agent. */
export class ClaudeBrain implements Brain {
  private readonly client: Anthropic;
  private readonly messages: Anthropic.Beta.BetaMessageParam[] = [];

  constructor(readonly model: string = process.env.BLINDSPOT_MODEL || DEFAULT_MODEL, client?: Anthropic) {
    // A test is tens of calls: retry rate limits, overloads and network errors a few more times than the default 2.
    this.client = client ?? new Anthropic({ maxRetries: 4 });
  }

  start(task: string, transcript: string): Promise<BrainTurn> {
    this.messages.push({
      role: "user",
      content: `Task: ${task}\n\nThe page has just loaded. Screen reader transcript:\n\n${transcript}`,
    });
    return this.call();
  }

  continue(outcomes: ToolOutcome[]): Promise<BrainTurn> {
    this.messages.push({
      role: "user",
      content: outcomes.map((o) => ({ type: "tool_result" as const, tool_use_id: o.id, content: o.content, is_error: o.isError ?? false })),
    });
    return this.call();
  }

  nudge(message: string): Promise<BrainTurn> {
    this.messages.push({ role: "user", content: message });
    return this.call();
  }

  private async call(): Promise<BrainTurn> {
    for (;;) {
      const response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: this.messages,
        // The transcript history grows every step; cache the prefix so each step only pays for what is new.
        cache_control: { type: "ephemeral" },
        output_config: { effort: "medium" },
        // If a safety classifier declines a request, retry it server-side on the recommended model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });

      if (response.stop_reason === "refusal") {
        throw new Error(`The model declined to continue (${response.stop_details?.category ?? "no category"}).`);
      }
      // Keep the full content (thinking, fallback blocks…) so the history stays valid.
      this.messages.push({ role: "assistant", content: response.content });
      if (response.stop_reason === "pause_turn") continue;
      if (response.stop_reason === "max_tokens") {
        throw new Error("The model response was cut off (max_tokens).");
      }

      const calls = response.content
        .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
        .map((b) => ({ id: b.id, name: b.name, input: b.input }));
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return { calls, text };
    }
  }
}
