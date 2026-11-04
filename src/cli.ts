import { runTest } from "./core/agent.js";
import { ClaudeBrain } from "./core/brains/claude.js";
import { ScriptedBrain, demoPlanFor } from "./core/brains/scripted.js";
import { reportDir } from "./core/report.js";

const args = process.argv.slice(2);
const scripted = args.includes("--scripted");
const [url, task] = args.filter((a) => !a.startsWith("--"));

if (!url || !task) {
  console.error('Usage: npm run blindspot -- <url> "<task>" [--scripted]');
  process.exit(1);
}

const brain = scripted ? new ScriptedBrain(demoPlanFor(url)) : new ClaudeBrain();
let printed = 0;

const report = await runTest({
  url,
  task,
  brain,
  onUpdate: (r) => {
    for (; printed < r.steps.length; printed++) {
      const s = r.steps[printed];
      const target = s.action.target ? ` ${s.action.target.role} "${s.action.target.name}"` : "";
      const value = s.action.value ? ` → ${s.action.value}` : "";
      console.log(`${s.ok ? "✓" : "✗"} ${s.index}. ${s.action.type}${target}${value}\n    ${s.result}`);
    }
  },
});

console.log(`\nStatus: ${report.status}   Score: ${report.score ?? "-"}/100`);
console.log(report.summary);
console.log(`\nIssues (${report.issues.length}):`);
for (const i of report.issues) console.log(`  [${i.severity}]${i.blocking ? " [BLOCKING]" : ""} ${i.title} (${i.wcag.join("; ")}) – ${i.source}`);
console.log(`\nReport: ${reportDir(report.id)}/report.json`);
if (report.error) process.exitCode = 1;
