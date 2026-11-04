// Starts the BlindSpot server on the example reports shipped in examples/reports/:
// seven real runs where an AI agent (Claude, through the MCP/HTTP external-agent API) tested the demo sites and three real websites.
// Usage: npm run examples   (then open http://localhost:3000)
//
// The examples are copied to a temporary folder first and served from there, so new runs started from this
// server never land in examples/reports/ (which is published with the static demo).
import { cp, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const examples = fileURLToPath(new URL("../examples/reports/", import.meta.url));
const dir = await mkdtemp(path.join(os.tmpdir(), "blindspot-examples-"));
await cp(examples, dir, { recursive: true });
process.env.BLINDSPOT_REPORTS_DIR = dir;
console.log(`Serving a copy of the example reports from ${dir}. New runs are saved there too, not in examples/reports/.`);
await import("./server.js");
