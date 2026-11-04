# BlindSpot in CI: accessibility regression tests for real user journeys

Linters tell you a button has no label. BlindSpot's CI mode tells you **"a screen reader user can no longer
book an appointment"**, and fails the build when that happens.

You describe the journeys that matter (sign up, check out, book an appointment) in `blindspot.config.json`.
On every push or pull request, the agent tries each journey using only what a screen reader announces, and the
job fails if a journey that must work is now blocked, or if its score drops below a threshold.

## Running it

```bash
npx tsx src/ci.ts [config] [--brain scripted|claude] [--serve] [--base-url <url>] [--summary <file>]
```

| Option | Meaning |
|---|---|
| `config` | Config file, default `blindspot.config.json` |
| `--brain` | `claude` (the AI agent, needs `ANTHROPIC_API_KEY`) or `scripted` (fixed plan, only for the bundled demo sites: clinic and GreenCart shop). Default: the config's `brain`, else `claude` |
| `--serve` | Serve the bundled `demo-site/` on a free local port and use it as `baseUrl` (no need to start `src/server.ts`) |
| `--base-url` | Base URL for relative journey URLs, e.g. your preview deployment. Overrides the config's `baseUrl` |
| `--summary` | Where to write the Markdown summary, default `blindspot-summary.md` |

Try it on the demo, without an API key:

```bash
npx tsx src/ci.ts blindspot.config.json --brain scripted --serve
```

Output:

- a compact table in the log, one line per journey;
- `blindspot-summary.md`: a Markdown table (status, score, number of blocking issues, top blocking issue), the
  failure reasons and the path of each full report;
- if `GITHUB_STEP_SUMMARY` is set (it is on GitHub Actions), the same Markdown is appended to the job summary;
- one full report per journey in `reports/<id>/report.json` (with screenshots), readable in the report UI.

Exit codes:

| Code | Meaning |
|---|---|
| `0` | Every journey met its requirements |
| `1` | At least one journey failed (see the summary for why) |
| `2` | Invalid config file or command line (nothing was run) |

## Config file

```json
{
  "baseUrl": "https://preview.example.com",
  "minScore": 70,
  "brain": "claude",
  "journeys": [
    { "name": "Sign up", "url": "/signup", "task": "Create an account as Alex Doe, alex@example.com" },
    { "name": "Checkout", "url": "/cart", "task": "Buy the item in the cart and pay with the test card 4242 4242 4242 4242", "minScore": 85 },
    { "name": "Legacy search", "url": "/old-search", "task": "Search for 'boots'", "mustSucceed": false, "note": "Known broken, tracked in #123" }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `baseUrl` | URL, optional | Relative journey URLs are appended to its path (`/signup` with `https://x.dev/app` gives `https://x.dev/app/signup`). Absolute journey URLs are used as-is |
| `minScore` | 0-100, optional | Default minimum score for every journey |
| `brain` | `"claude"` \| `"scripted"`, optional | Default agent |
| `journeys[].name` | string | Shown in the summary, must be unique |
| `journeys[].url` | string | Start page (absolute, or relative to `baseUrl`) |
| `journeys[].task` | string | What a user wants to do, in plain language (max 500 characters) |
| `journeys[].minScore` | 0-100, optional | Overrides the global `minScore` |
| `journeys[].mustSucceed` | boolean, default `true` | `false` for journeys known to be broken: they are still tested and reported, but being blocked does not fail the build (a `minScore`, if set, still applies) |
| `note` / `journeys[].note` | string, optional | Free comment (JSON has no comments) |

Unknown keys are rejected, so a typo like `mustsucceed` is caught instead of silently ignored. Errors list every
problem with its path, e.g. `journeys[1].minScore: must be between 0 and 100`.

A journey **fails** when:

- its run crashed (site unreachable, browser error), always, even with `mustSucceed: false`;
- `mustSucceed` is true (the default) and the agent did not complete the task (`blocked` or `step_limit`);
- a minimum score applies and the score is below it.

The repository's own `blindspot.config.json` has four journeys, two per demo site (clinic booking and GreenCart
checkout): each fixed version must succeed with a score of at least 90, and each inaccessible version is a
**known-bad example** (`mustSucceed: false`): it shows up in the summary as blocked, with its blocking issue,
without failing the build.

## BlindSpot's own pipeline

`.github/workflows/blindspot.yml` runs on every push and pull request: `npm ci`, install Chromium, type check,
`vitest`, then the CI mode on the demo clinic with the scripted agent (no secret needed), and uploads `reports/`
and `blindspot-summary.md` as the `blindspot-reports` artifact.

## Adding BlindSpot to your own repository

The example below tests every preview deployment of your app (Vercel, Netlify, Render and others report previews
through GitHub's `deployment_status` event) with the Claude agent.

1. Add `blindspot.config.json` at the root of your repository, with relative journey URLs and no `baseUrl`.
2. Add your Claude API key as a repository secret named `ANTHROPIC_API_KEY`
   (Settings, Secrets and variables, Actions).
3. Add `.github/workflows/accessibility.yml`:

```yaml
name: Accessibility journeys

on:
  deployment_status:

permissions:
  contents: read

jobs:
  blindspot:
    # Only when a preview deployment has finished successfully.
    if: github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: Check out your app (for blindspot.config.json)
        uses: actions/checkout@v4
        with:
          path: app

      - name: Check out BlindSpot
        uses: actions/checkout@v4
        with:
          repository: TibereJ/genhacks-2026   # BlindSpot's repository; pin a tag or commit with `ref:`
          path: blindspot

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install BlindSpot
        working-directory: blindspot
        run: |
          npm ci
          npx playwright install --with-deps chromium

      - name: Run the journeys against the preview
        working-directory: blindspot
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          # Optional: a cheaper model for frequent runs.
          # BLINDSPOT_MODEL: claude-haiku-5-5
          PREVIEW_URL: ${{ github.event.deployment_status.environment_url }}
        run: npx tsx src/ci.ts ../app/blindspot.config.json --brain claude --base-url "$PREVIEW_URL"

      - name: Upload reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: blindspot-reports
          path: |
            blindspot/reports/
            blindspot/blindspot-summary.md
          if-no-files-found: ignore
```

If you deploy previews yourself inside the same workflow, run the BlindSpot steps after your deploy step and pass
its URL to `--base-url` instead.

Notes:

- **Cost**: each journey is one agent run (a few to ~30 Claude calls). Keep the list to the journeys that matter,
  or set `BLINDSPOT_MODEL` to a smaller model.
- **Secrets and forks**: GitHub does not give secrets to workflows triggered by pull requests from forks, so the
  Claude agent cannot run there. Do not work around this with `pull_request_target`: it would run untrusted code
  with your API key.
- **Test data**: the agent really fills in and submits forms. Point it at a preview or staging environment with
  test accounts and test payment cards, never at production.
- **Non-determinism**: an AI agent can occasionally take a different path. Thresholds like `minScore` should leave a
  little margin; the full report shows exactly what the agent heard and did at each step.
