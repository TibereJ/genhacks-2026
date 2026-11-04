# Example reports

Seven real BlindSpot runs: four on the bundled demo sites and three on real public websites, viewable with `npm run examples` (then open http://localhost:3000).

| Report | Site | Result |
|---|---|---|
| `20261104164439-947unj` | Maple Grove Clinic, inaccessible | blocked, 0/100, 15 issues |
| `20261104164505-l2g8gy` | Maple Grove Clinic, fixed | success, 100/100 |
| `20261104164652-tbhon8` | GreenCart shop, inaccessible | blocked, 0/100, 8 issues |
| `20261104165344-bsrrv6` | GreenCart shop, fixed | success, 100/100 |
| `20261104172502-oh6mrq` | **nodejs.org** (real site): find the LTS version and the Windows download | success, 91/100, 3 issues |
| `20261104173322-401re7` | **jsr.io** (real site): find a package's latest version | success, 78/100, 4 issues (long, repetitive result link names; unnamed copy buttons) |
| `20261104172549-si9xd8` | **pypi.org** (real site): find a package's version and license | inconclusive: a bot check (CAPTCHA with an audio alternative) appeared after searching; BlindSpot does not bypass CAPTCHAs |

**How they were made.** The agent was Claude, running in Claude Code, driving BlindSpot through its
external-agent HTTP API (`POST /api/agent/start`, then one tool call per request — the same tools the MCP server
exposes). It only received the screen reader transcripts BlindSpot returned, and chose each action and issue
itself. The model field in these reports reads "Claude Code (session brain)".

The two clinic reports were re-executed with the same decisions as the first live runs, after a fix that merges
repeated scan findings across pages, so the issue list has no duplicates. The shop and real-site reports are the original
live runs (the fixed shop was re-run after a scan false positive was fixed).

The screenshots inside each report are for human readers; the agent never saw them.
