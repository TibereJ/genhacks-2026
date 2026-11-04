# Deploying BlindSpot

BlindSpot ships as a standard container (`Dockerfile` at the repository root). It runs `src/server.ts`: the
HTTP API, the report UI and the demo clinic, on one port. Any container host works (Deployxa, Fly.io, Render,
Cloud Run, a VM with Docker...).

The image is based on the official Playwright image `mcr.microsoft.com/playwright:v1.63.0-noble`, which already
contains Chromium and its system libraries. Its version must match the `playwright` npm package: when you upgrade
`playwright` in `package.json`, change the `FROM` line too.

## Static read-only demo (GitHub Pages)

The live demo at https://tiberej.github.io/genhacks-2026/ is a static build, not a server: the report UI, the
demo sites and the example reports from `examples/reports/`. Visitors can browse the runs, every step and
screenshot, Listen, compare before / after and download the Markdown export, but cannot start a test (the form is
replaced by a notice pointing to the quick start).

```bash
npm run build:static            # or: npx tsx src/build-static.ts [outDir], default dist-static/
```

Serve the folder with any static file server, at the root or under a sub-path: every URL in it is relative.

`src/build-static.ts` copies `report-ui/` (without `fixtures/` and `format.d.ts`) and adds
`<meta name="blindspot-static" content="1">` to `index.html`, which makes the UI read `data/reports.json`,
`data/reports/<id>/report.json` and `data/reports/<id>/step-N.png` instead of the API. It copies `demo-site/` to
`demo/`, and writes `data/reports/<id>/report.md` (the Markdown export, made with `reportToMarkdown`) for
"Download Markdown" and "Copy as GitHub issue". Report data is published as it is. A report still `running` is
refused: wait for it to finish, or delete it.

The output folder is emptied before each build, so the script refuses a folder that is outside the repository, is
the repository itself, or overlaps (as the same folder, a parent or a child) `src/`, `report-ui/`, `demo-site/`,
`examples/`, `tests/`, `docs/`, `node_modules/`, `.git/` or `.github/` (compared case-insensitively on Windows,
after resolving symbolic links). Every build writes a `.blindspot-static` file in it; an existing non-empty folder
without that file is never deleted.

`.github/workflows/pages.yml` builds and deploys it on every push to `main` (and on demand from the Actions tab).
**The repository owner must enable Pages once:** Settings → Pages → Build and deployment → Source:
**GitHub Actions**. Until then the deploy job fails.

## Run locally with Docker

```bash
docker build -t blindspot .
docker run --rm --init --ipc=host -p 3000:3000 --env-file .env blindspot
# open http://localhost:3000
```

- `--init` reaps Chromium's child processes; `--ipc=host` avoids Chromium crashes caused by Docker's small
  default `/dev/shm` (recommended by Playwright). If your host does not allow `--ipc=host`, use `--shm-size=1gb`.
- The container runs as the image's non-root user `pwuser`.
- Reports are written to `/app/reports` inside the container and are lost when it is removed. Mount a volume to
  keep them: `-v blindspot-reports:/app/reports`.
- A `HEALTHCHECK` polls `GET /api/reports`.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Interface the server listens on. The default only accepts connections from the same machine; the Docker image sets `0.0.0.0` so the published port works. Anyone who can reach the port can start tests, so only listen on `0.0.0.0` behind `BLINDSPOT_PUBLIC=1` or authentication |
| `ANTHROPIC_API_KEY` | none | Claude API key for the AI agent. Without it only the scripted demo works |
| `BLINDSPOT_MODEL` | `claude-opus-5-5` | Model used by the agent (`claude-haiku-5-5` is much cheaper) |
| `BLINDSPOT_MAX_RUNS` | `2` | Maximum number of tests running at the same time (each one is a Chromium instance) |
| `BLINDSPOT_PUBLIC` | unset | `1` for an internet-facing instance: turns on the protections below |
| `BLINDSPOT_ALLOW_CLAUDE` | unset | With `BLINDSPOT_PUBLIC=1`, `1` re-enables the Claude agent |
| `BLINDSPOT_REPORTS_DIR` | `reports` | Where reports are written |

Pass secrets through your host's secret manager or `--env-file`, never in the image: `.env` is excluded by
`.dockerignore`.

## Request checks

Every `POST` route (start a test, the external agent API) only accepts `content-type: application/json` (other
types get `415`), and refuses with `403` a request whose `Origin` header names another host than the request's
`Host` (or `X-Forwarded-Host`, for reverse proxies that rewrite `Host`). Together they stop other websites from
starting tests through a visitor's browser (CSRF). Clients without an `Origin` header, like `curl`, are not
affected.

## Security warning: public instances

**A BlindSpot server makes a real browser visit whatever URL it is given, and spends your Claude API key on every
test.** On a public instance, without protection, anyone can:

- **SSRF**: make the server's browser load internal addresses such as `http://169.254.169.254/` (cloud metadata,
  which can leak credentials), `http://localhost:...` or services on your private network, and read the result in
  the report (transcript and screenshots);
- **spend your API key**: every test is tens of Claude calls.

So for a public deployment (for example the hackathon demo):

1. Set `BLINDSPOT_PUBLIC=1`. The server then:
   - refuses URLs whose hostname resolves to a private, loopback, link-local or otherwise non-public address
     (IPv4 `0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.168/16`, multicast...;
     IPv6 `::1`, `fc00::/7`, `fe80::/10`, multicast, and IPv4-mapped forms like `::ffff:127.0.0.1`), except its
     own `/demo/` pages. The same check runs on every request the test browser makes: page loads, assets,
     links the agent follows, new tabs, and each hop of a redirect chain;
   - only allows the scripted agent (the demo clinic before/after), unless `BLINDSPOT_ALLOW_CLAUDE=1`.
2. Keep the Claude agent disabled publicly. If you need it, put the instance behind authentication (your host's
   access control, a reverse proxy with basic auth, or a VPN) before setting `BLINDSPOT_ALLOW_CLAUDE=1`, and set a
   spending limit on the API key in the Anthropic console.
3. Keep `BLINDSPOT_MAX_RUNS` low.

### Known limits

The URL guard (`src/core/url-guard.ts`) does not cover everything:

- **DNS rebinding**: the guard resolves a hostname, then Chromium resolves it again by itself when it connects.
  A hostile DNS server can answer with a public address the first time and a private one the second time.
- **WebSockets**: Playwright's request interception does not see WebSocket connections, so a page can open one
  to a private address.

So a public deployment must also block private ranges at the network level: an egress firewall, or a container
network policy, that stops the container from reaching `10/8`, `172.16/12`, `192.168/16`, `100.64/10`,
`169.254/16` (cloud metadata) and the IPv6 private ranges (`fc00::/7`, `fe80::/10`). Run nothing else in the
container, and run it on a host or network where it cannot reach anything sensitive.

## Deployxa

For the "Best Use of Deployxa" prize: Deployxa-specific steps will be added here once we have their docs. The image
is a standard container listening on `$PORT`, so it should only need the image (or this repository with the
`Dockerfile`), the port, and the environment variables above, with `BLINDSPOT_PUBLIC=1`.
