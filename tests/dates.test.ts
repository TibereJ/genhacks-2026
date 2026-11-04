import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { normalizeDateValue } from "../src/core/browser.js";

// The time zone is read when the process starts, so check other zones in a child process.
function inZone(tz: string, inputs: [string, string][]): (string | null)[] {
  const code = `import { normalizeDateValue as n } from "./src/core/browser.ts";
    console.log(JSON.stringify(${JSON.stringify(inputs)}.map(([t, v]) => n(t, v) ?? null)));`;
  const out = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
    env: { ...process.env, TZ: tz },
    encoding: "utf8",
  });
  return JSON.parse(out.trim().split("\n").at(-1)!) as (string | null)[];
}

describe("normalizeDateValue", () => {
  it("keeps the calendar day of free-form dates east and west of UTC", () => {
    const inputs: [string, string][] = [["date", "December 15, 2026"], ["date", "2026/12/15"], ["date", "15 Dec 2026"], ["date", "2026-12-15"]];
    for (const tz of ["Europe/Paris", "Pacific/Auckland", "America/Los_Angeles", "UTC"]) {
      expect(inZone(tz, inputs), tz).toEqual(["2026-12-15", "2026-12-15", "2026-12-15", "2026-12-15"]);
    }
  });

  it("parses times and rejects what it cannot read", () => {
    expect(normalizeDateValue("time", "9:30 pm")).toBe("21:30");
    expect(normalizeDateValue("time", "12:05 am")).toBe("00:05");
    expect(normalizeDateValue("time", "25:00")).toBeUndefined();
    expect(normalizeDateValue("date", "next tuesday-ish")).toBeUndefined();
    expect(normalizeDateValue("month", "2026-12")).toBe("2026-12");
    expect(normalizeDateValue("datetime-local", "2026-12-15T09:00")).toBe("2026-12-15T09:00");
  });
});
