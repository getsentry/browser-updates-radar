// Send the new candidates + the interest profile to Claude (via OpenRouter) and get
// back a small, ranked set of picks via a forced tool call (structured output).
// Writes triage.json.
//
// The tool is declared with `execute: false` (a "manual" tool): we never want the
// agent loop to run anything, we just want the model's validated arguments. Paired
// with stopWhen/allowFinalResponse below that keeps this to exactly one billed call.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { OpenRouter, tool, stepCountIs } from '@openrouter/agent';
import { z } from 'zod';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = process.env.MODEL || 'anthropic/claude-sonnet-4.6';
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

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  // In a dry run we don't want to force a paid API call: skip with empty picks
  // so the rest of the pipeline can still be exercised. Real runs must fail.
  if (process.env.DRY_RUN === '1') {
    await writeFile(join(root, 'triage.json'), JSON.stringify({ picks: [], skipped: 'OPENROUTER_API_KEY not set' }, null, 2));
    console.log('DRY_RUN: OPENROUTER_API_KEY not set, skipping triage (0 picks).');
    process.exit(0);
  }
  console.error('OPENROUTER_API_KEY is not set.');
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

const reportPicks = tool({
  name: 'report_picks',
  description: 'Report the browser-platform changes worth the SDK team’s attention.',
  inputSchema: z.object({
    picks: z
      .array(
        z.object({
          ref: z.string().describe('The candidate ref, exactly as given (source:id).'),
          title: z.string(),
          source: z.string(),
          impact: z.enum(['breaking', 'opportunity', 'watch']),
          urgency: z.enum(['high', 'med', 'low']),
          why: z.string().describe('Why this matters specifically to the Sentry Browser SDK. 1-3 sentences.'),
          url: z.string(),
        }),
      )
      .max(MAX_PICKS),
  }),
  execute: false,
});

const prompt = `${profile}

Below are ${compact.length} new browser-platform items collected from various sources this week. Select only the ones genuinely worth the Sentry Browser SDK team's attention (at most ${MAX_PICKS}). Prefer fewer, higher-signal picks over padding the list. If a "page-snapshot" item contains several noteworthy things, pick the single most relevant and describe it.

ITEMS (JSON):
${JSON.stringify(compact, null, 2)}`;

const openrouter = new OpenRouter({ apiKey });

let picks = [];
try {
  const result = openrouter.callModel({
    model: MODEL,
    input: prompt,
    maxOutputTokens: 4096,
    tools: [reportPicks],
    toolChoice: { type: 'function', name: 'report_picks' },
    // One model turn, and no follow-up text turn: the tool arguments are the
    // entire answer, so a second round trip would just burn tokens.
    stopWhen: stepCountIs(1),
    allowFinalResponse: false,
  });

  const call = (await result.getToolCalls()).find(c => c.name === 'report_picks');
  picks = call?.arguments?.picks ?? [];
} catch (err) {
  console.error(`OpenRouter request failed: ${err?.message ?? err}`);
  process.exit(1);
}

await writeFile(join(root, 'triage.json'), JSON.stringify({ model: MODEL, picks }, null, 2));
console.log(`Triaged ${compact.length} candidate(s) -> ${picks.length} pick(s).`);
