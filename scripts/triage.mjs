// Send the new candidates + the interest profile to Claude and get back a small,
// ranked set of picks via a forced tool call (structured output). Writes triage.json.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = process.env.MODEL || 'claude-sonnet-4-6';
const MAX_PICKS = 8;

const fetched = JSON.parse(await readFile(join(root, 'candidates.json'), 'utf8'));
const profile = await readFile(join(root, 'prompts/interest-profile.md'), 'utf8');

// Only new or materially-changed topics are worth a (paid) triage call; unchanged
// ones already have whatever issue they deserve from a prior run.
const candidates = fetched.filter(c => c.changed);

if (candidates.length === 0) {
  await writeFile(join(root, 'triage.json'), JSON.stringify({ picks: [] }, null, 2));
  console.log('No new or changed candidates to triage.');
  process.exit(0);
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  // In a dry run we don't want to force a paid API call: skip with empty picks
  // so the rest of the pipeline can still be exercised. Real runs must fail.
  if (process.env.DRY_RUN === '1') {
    await writeFile(join(root, 'triage.json'), JSON.stringify({ picks: [], skipped: 'ANTHROPIC_API_KEY not set' }, null, 2));
    console.log('DRY_RUN: ANTHROPIC_API_KEY not set — skipping triage (0 picks).');
    process.exit(0);
  }
  console.error('ANTHROPIC_API_KEY is not set.');
  process.exit(1);
}

// Keep the payload lean: hand the model only what it needs to judge relevance.
const compact = candidates.map(c => ({
  ref: `${c.source}:${c.id}`,
  source: c.source,
  title: c.title,
  summary: c.summary,
  type: c.type,
  components: c.components,
  maturity: c.maturity,
  browsers: c.browsers,
  url: c.url,
}));

const tool = {
  name: 'report_picks',
  description: 'Report the browser-platform changes worth the SDK team’s attention.',
  input_schema: {
    type: 'object',
    properties: {
      picks: {
        type: 'array',
        maxItems: MAX_PICKS,
        items: {
          type: 'object',
          properties: {
            ref: { type: 'string', description: 'The candidate ref, exactly as given (source:id).' },
            title: { type: 'string' },
            source: { type: 'string' },
            impact: { type: 'string', enum: ['breaking', 'opportunity', 'watch'] },
            urgency: { type: 'string', enum: ['high', 'med', 'low'] },
            why: { type: 'string', description: 'Why this matters specifically to the Sentry Browser SDK. 1-3 sentences.' },
            url: { type: 'string' },
          },
          required: ['ref', 'title', 'source', 'impact', 'urgency', 'why', 'url'],
        },
      },
    },
    required: ['picks'],
  },
};

const prompt = `${profile}

Below are ${compact.length} new browser-platform items collected from various sources this week. Select only the ones genuinely worth the Sentry Browser SDK team's attention (at most ${MAX_PICKS}). Prefer fewer, higher-signal picks over padding the list. If a "page-snapshot" item contains several noteworthy things, pick the single most relevant and describe it.

ITEMS (JSON):
${JSON.stringify(compact, null, 2)}`;

const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    model: MODEL,
    max_tokens: 4096,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'report_picks' },
    messages: [{ role: 'user', content: prompt }],
  }),
});

if (!res.ok) {
  console.error(`Anthropic API error ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const data = await res.json();
const block = data.content?.find(b => b.type === 'tool_use');
const picks = block?.input?.picks ?? [];

await writeFile(join(root, 'triage.json'), JSON.stringify({ model: MODEL, picks }, null, 2));
console.log(`Triaged ${compact.length} candidate(s) -> ${picks.length} pick(s).`);
