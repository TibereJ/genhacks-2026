# Example reports

Four real BlindSpot runs, viewable with `npm run examples` (then open http://localhost:3000).

| Report | Site | Result |
|---|---|---|
| `20261104164439-947unj` | Maple Grove Clinic, inaccessible | blocked, 0/100, 15 issues |
| `20261104164505-l2g8gy` | Maple Grove Clinic, fixed | success, 100/100 |
| `20261104164652-tbhon8` | GreenCart shop, inaccessible | blocked, 0/100, 8 issues |
| `20261104165344-bsrrv6` | GreenCart shop, fixed | success, 100/100 |

**How they were made.** The agent was Claude, running in Claude Code, driving BlindSpot through its
external-agent HTTP API (`POST /api/agent/start`, then one tool call per request — the same tools the MCP server
exposes). It only received the screen reader transcripts BlindSpot returned, and chose each action and issue
itself. The model field in these reports reads "Claude Code (session brain)".

The two clinic reports were re-executed with the same decisions as the first live runs, after a fix that merges
repeated scan findings across pages, so the issue list has no duplicates. The two shop reports are the original
live runs (the fixed shop was re-run after a scan false positive was fixed).

The screenshots inside each report are for human readers; the agent never saw them.
