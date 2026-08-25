# browser-updates-radar

A weekly GitHub Action that pulls upcoming browser-platform changes from several sources, asks Claude to pick the ones the **Sentry Browser SDK team** should care about, and files **one GitHub issue per topic** so each change can be prioritized, discussed, and tracked independently. Deduped so nothing is ever filed twice — low noise by design.

## How it works

```
sources.config.mjs ──► fetch-candidates ──► triage (Claude) ──► publish (1 issue / topic)
       │                      │                   │                    │
   list of links        normalize +          rank & filter to     create / update issues
   to pull from         diff vs ledger        the interest profile  + commit topic ledger
```

1. **fetch** — every source in `sources.config.mjs` is normalized to a common shape and each item is fingerprinted and diffed against `state/topics.json` (the ledger), so it knows what's **new**, **changed**, or **unchanged**.
2. **triage** — the new/changed items + `prompts/interest-profile.md` go to Claude (through OpenRouter, via `@openrouter/agent`) in one call; it returns ≤8 ranked picks (`breaking` / `opportunity` / `watch`) via structured output. This is the relevance gate — irrelevant items (e.g. CSS paint features) never become issues.
3. **publish** — one issue per topic, keyed deterministically by `source:id` via the ledger:
   - **new topic** → creates an issue labeled `triage`, `impact:<x>`, `urgency:<y>`, with a hidden `<!-- radar-key: source:id -->` marker.
   - **changed topic** that already has an issue → adds an "updated" comment + label so the topic accrues its history in place (limited to `breaking`/`opportunity`; `watch` items are file-once).
   - then commits the refreshed ledger.

The ledger — not GitHub search — is the dedup authority, so two runs can never open two issues for the same topic. Triage the relevant set with the `triage` label, then re-prioritize with your own labels; that's the intended workflow.

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
2. Add a repository secret **`OPENROUTER_API_KEY`** (from <https://openrouter.ai/keys>).
3. (Optional) Add a repository variable **`MODEL`** to override the triage model (default `anthropic/claude-sonnet-4.6`). Any [OpenRouter model slug](https://openrouter.ai/models) works.
4. The built-in `GITHUB_TOKEN` handles issue creation and the state commit — no PAT needed.
5. Trigger a manual run from the Actions tab (**Run workflow**) to verify; it otherwise runs Mondays 08:00 UTC.

New issues `cc` the **`@getsentry/team-javascript-sdks-browser`** team so they're notified. Override the team with a repository variable **`NOTIFY_TEAM`** (e.g. `@getsentry/some-team`), or set it to `none` to disable the mention. Note: team-mention notifications can be unreliable when the mention comes from the built-in `GITHUB_TOKEN`; if the team isn't getting pinged, publish with a PAT/GitHub App token from an org member instead (swap `secrets.GITHUB_TOKEN` on the *Publish issues* step).

## Local testing

The fastest way to check everything works before enabling the schedule:

```bash
npm install
npm run dry-run                             # source health report only (skips the paid triage call)
OPENROUTER_API_KEY=sk-or-... npm run dry-run # full pipeline incl. a live triage call
```

`dry-run` runs the whole pipeline against the live sources and prints a per-source
✓/✗ health report plus the **planned per-topic issue actions** (create / comment / skip)
— but **never touches GitHub and never writes `state/topics.json`**, so it's safe to run
repeatedly. It exits non-zero if any source fails or a step errors. The triage call only
happens when `OPENROUTER_API_KEY` is set; without it, triage is skipped so you can still
validate fetching and action planning.

To run the individual steps by hand:

```bash
npm run fetch
OPENROUTER_API_KEY=sk-or-... npm run triage
DRY_RUN=1 npm run publish   # prints the digest instead of opening an issue
```
