// BlindSpot CI mode: run the journeys of blindspot.config.json and fail the build on regressions.
// Usage: npx tsx src/ci.ts [config] [--brain scripted|claude] [--serve]   (see docs/CI.md)
import { runCi } from "./core/ci.js";

process.exitCode = await runCi(process.argv.slice(2));
