// launchBrowser (src/core/browser.ts): which browser build starts, and which errors are shown. No real browser here.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Browser, LaunchOptions } from "playwright";
import { launchBrowser } from "../src/core/browser.js";

const fakeBrowser = { fake: true } as unknown as Browser;
const MISSING = "browserType.launch: Executable doesn't exist at /ms-playwright/chromium-1234/chrome-linux/chrome\n╔════╗";

/** A launch function that fails (or succeeds) per call, recording the options it got. */
function launcher(...outcomes: (Error | "ok")[]) {
  const calls: (LaunchOptions | undefined)[] = [];
  const launch = async (options?: LaunchOptions) => {
    calls.push(options);
    const outcome = outcomes[calls.length - 1] ?? "ok";
    if (outcome === "ok") return fakeBrowser;
    throw outcome;
  };
  return { launch, calls };
}

afterEach(() => vi.restoreAllMocks());

describe("launchBrowser", () => {
  it("starts full Chromium by default", async () => {
    const { launch, calls } = launcher("ok");
    await expect(launchBrowser(launch, {})).resolves.toBe(fakeBrowser);
    expect(calls).toEqual([{ channel: "chromium" }]);
  });

  it("falls back to the default build when full Chromium is not installed, and says why on stderr", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { launch, calls } = launcher(new Error(MISSING), "ok");
    await expect(launchBrowser(launch, {})).resolves.toBe(fakeBrowser);
    expect(calls).toEqual([{ channel: "chromium" }, undefined]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("Executable doesn't exist at /ms-playwright/chromium-1234");
    expect(log.mock.calls[0][0]).not.toContain("╔");
  });

  it("throws other launch errors instead of hiding them behind the fallback", async () => {
    const { launch, calls } = launcher(new Error("browserType.launch: Target page, context or browser has been closed"));
    await expect(launchBrowser(launch, {})).rejects.toThrow(/has been closed/);
    expect(calls).toHaveLength(1);
  });

  it("throws both messages when the fallback fails too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { launch } = launcher(new Error(MISSING), new Error("Host system is missing dependencies: libnss3"));
    const err = await launchBrowser(launch, {}).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("Executable doesn't exist");
    expect((err as Error).message).toContain("missing dependencies: libnss3");
  });

  it("never falls back from a channel set in BLINDSPOT_BROWSER_CHANNEL", async () => {
    const { launch, calls } = launcher(new Error("Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome"));
    await expect(launchBrowser(launch, { BLINDSPOT_BROWSER_CHANNEL: "chrome" })).rejects.toThrow(/"chrome".*BLINDSPOT_BROWSER_CHANNEL.*not found/s);
    expect(calls).toEqual([{ channel: "chrome" }]);

    const explicit = launcher(new Error(MISSING));
    await expect(launchBrowser(explicit.launch, { BLINDSPOT_BROWSER_CHANNEL: "chromium" })).rejects.toThrow(/Executable doesn't exist/);
    expect(explicit.calls).toHaveLength(1);
  });

  it('uses the headless shell for "default"', async () => {
    const { launch, calls } = launcher("ok");
    await launchBrowser(launch, { BLINDSPOT_BROWSER_CHANNEL: "default" });
    expect(calls).toEqual([undefined]);
  });
});
