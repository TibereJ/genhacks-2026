// Starts the BlindSpot server on the example reports shipped in examples/reports/:
// six real runs where an AI agent (Claude, through the MCP/HTTP external-agent API) tested the demo sites and two real websites.
// Usage: npm run examples   (then open http://localhost:3000)
import path from "node:path";

process.env.BLINDSPOT_REPORTS_DIR ||= path.resolve("examples/reports");
await import("./server.js");
