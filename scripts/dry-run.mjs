// End-to-end dry run: exercise the whole weekly pipeline against live sources
// and print a reliability verdict, WITHOUT any irreversible side effect —
// no GitHub issue is opened and state/topics.json is never written.
//
//   npm run dry-run
//
// The triage step makes a real Claude call only when ANTHROPIC_API_KEY is set;
// otherwise it is skipped so you can still validate that every source fetches
// and the digest renders. Exits non-zero if any source hard-fails or a step
// errors, so it doubles as a pre-flight check before enabling the schedule.

import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { collect } from './fetch-candidates.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function step(script) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [join(here, script)], {
      stdio: 'inherit',
      env: { ...process.env, DRY_RUN: '1' },
    });
    child.on('exit', code => resolve(code ?? 1));
  });
}

console.log('=== browser-updates-radar dry run ===\n');

// 1. Fetch — the most fragile part, so report each source individually.
console.log('▸ Fetching sources…\n');
const { candidates, health, counts } = await collect();

const failed = health.filter(h => !h.ok);
for (const h of health) {
  if (h.ok) console.log(`  ✓ ${h.id.padEnd(16)} ${h.count} item(s)`);
  else console.log(`  ✗ ${h.id.padEnd(16)} ${h.error}`);
}
console.log(`\n  ${counts.total} fetched — ${counts.new} new, ${counts.changed} changed, ${counts.unchanged} unchanged.`);
if (failed.length) {
  console.log(`  ${failed.length} source(s) failed. (Note: in CI a single source failure does not abort the run.)`);
}

// Hand off to the real triage + publish scripts via candidates.json, exactly
// as CI does — this exercises the on-disk contract between the steps too.
await writeFile(join(root, 'candidates.json'), JSON.stringify(candidates, null, 2));

// 2. Triage — real Claude call if a key is present, graceful skip otherwise.
console.log('\n▸ Triaging' + (process.env.ANTHROPIC_API_KEY ? ' (live Claude call)…' : ' (no API key — will skip)…') + '\n');
const triageCode = await step('triage.mjs');

// 3. Publish — prints the planned per-topic issue actions; never touches GitHub.
console.log('\n▸ Planning issue actions…\n');
const publishCode = await step('publish.mjs');

// Verdict.
const ok = failed.length === 0 && triageCode === 0 && publishCode === 0;
console.log('\n=== ' + (ok ? 'PASS — pipeline looks healthy' : 'ISSUES DETECTED — see above') + ' ===');
process.exit(ok ? 0 : 1);
