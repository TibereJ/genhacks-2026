import { describe, expect, it } from "vitest";
import { BUSY_MESSAGE, ExternalBrain } from "../src/core/brains/external.js";

describe("external brain", () => {
  it("accepts one call at a time and refuses a second one until the first is answered", async () => {
    const brain = new ExternalBrain("test");
    const firstTurn = brain.start("task", "transcript");

    const click = brain.submit("click", { id: 1, reason: "r" });
    await expect(brain.submit("click", { id: 2, reason: "r" })).rejects.toThrow(BUSY_MESSAGE);
    await expect(brain.submit("report_issue", {})).rejects.toThrow(BUSY_MESSAGE);

    const turn = await firstTurn;
    expect(turn.calls.map((c) => c.input)).toEqual([{ id: 1, reason: "r" }]);

    // The loop answers the call and waits for the next turn: the caller gets the result, then may send again.
    const secondTurn = brain.continue([{ id: turn.calls[0].id, content: "clicked" }]);
    await expect(click).resolves.toBe("clicked");
    const next = brain.submit("finish", { status: "blocked", summary: "s" });
    expect((await secondTurn).calls[0].name).toBe("finish");

    brain.close("done");
    await expect(next).resolves.toBe("done");
    await expect(brain.submit("click", { id: 1 })).rejects.toThrow(/already ended/);
  });

  it("refuses a second call even before the run asked for its first turn", async () => {
    const brain = new ExternalBrain("test");
    const first = brain.submit("click", { id: 1, reason: "r" });
    await expect(brain.submit("click", { id: 1, reason: "r" })).rejects.toThrow(BUSY_MESSAGE);
    const turn = await brain.start("task", "transcript");
    expect(turn.calls).toHaveLength(1);
    void brain.continue([{ id: turn.calls[0].id, content: "ok", isError: true }]);
    await expect(first).resolves.toBe("Error: ok");
    brain.close("done");
  });
});
