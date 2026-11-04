import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { ClaudeBrain } from "../src/core/brains/claude.js";

const clientOf = (b: ClaudeBrain) => (b as unknown as { client: Anthropic }).client;

describe("Claude brain", () => {
  it("retries failed API calls up to 4 times by default", () => {
    expect(clientOf(new ClaudeBrain("claude-opus-5-5")).maxRetries).toBe(4);
  });

  it("keeps an injected client as is", () => {
    const client = new Anthropic({ apiKey: "test", maxRetries: 0 });
    expect(clientOf(new ClaudeBrain("claude-opus-5-5", client))).toBe(client);
  });
});
