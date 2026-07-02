# browser-updates-radar

A weekly GitHub Action that pulls upcoming browser-platform changes from several sources, asks Claude to pick the ones the **Sentry Browser SDK team** should care about, and files them as a single GitHub issue. One issue per week, deduped so nothing repeats — low noise by design.

## How it works

```
sources.config.mjs ──► fetch-candidates ──► triage (Claude) ──► publish (1 issue)
       │                      │                   │                    │
   list of links        normalize +          rank & filter to     render digest +
   to pull from         dedup vs seen        the interest profile  commit seen.json
```

1. **fetch** — every source in `sources.config.mjs` is normalized to a common shape and diffed against `state/seen.json`, so only genuinely new items move on.
2. **triage** — the new items + `prompts/interest-profile.md` go to Claude in one call; it returns ≤8 ranked picks (`breaking` / `opportunity` / `watch`) via structured output.
3. **publish** — renders one markdown digest, opens an issue labeled `browser-radar`, then marks every item from this run as seen.

## Adding a source

Edit `sources.config.mjs`. For most things, one line is enough:

```js
{ type: 'feed', id: 'v8', url: 'https://v8.dev/blog.atom' },   // any RSS/Atom feed
{ type: 'page', id: 'tc39', url: 'https://github.com/tc39/proposals' }, // any webpage
```

- `feed` — RSS or Atom. The cheapest way to add a link.
- `page` — best-effort text snapshot of a page; the agent mines it. Use when there's no feed.
- `chromestatus` — the rich Chrome Platform Status API adapter (already wired in).

For a new *structured* source with its own API, add `sources/<type>.mjs` exporting `fetch(cfg)` that returns the common candidate shape (see existing adapters), then reference its `type` in the config.

## Tuning what gets surfaced

Edit `prompts/interest-profile.md`. That file is the entire definition of "interesting" — adjust the priority buckets and the ignore list there.

## Setup

1. Create the repo on GitHub and push this code.
2. Add a repository secret **`ANTHROPIC_API_KEY`**.
3. (Optional) Add a repository variable **`MODEL`** to override the triage model (default `claude-sonnet-4-6`).
4. The built-in `GITHUB_TOKEN` handles issue creation and the state commit — no PAT needed.
5. Trigger a manual run from the Actions tab (**Run workflow**) to verify; it otherwise runs Mondays 08:00 UTC.

## Local testing

The fastest way to check everything works before enabling the schedule:

```bash
npm install
npm run dry-run                          # source health report only (skips the paid triage call)
ANTHROPIC_API_KEY=sk-... npm run dry-run # full pipeline incl. a live Claude triage call
```

`dry-run` runs the whole pipeline against the live sources and prints a per-source
✓/✗ health report plus the rendered digest — but **never opens an issue and never
writes `state/seen.json`**, so it's safe to run repeatedly. It exits non-zero if any
source fails or a step errors. The triage call only happens when `ANTHROPIC_API_KEY`
is set; without it, triage is skipped so you can still validate fetching and rendering.

To run the individual steps by hand:

```bash
npm run fetch
ANTHROPIC_API_KEY=sk-... npm run triage
DRY_RUN=1 npm run publish   # prints the digest instead of opening an issue
```
