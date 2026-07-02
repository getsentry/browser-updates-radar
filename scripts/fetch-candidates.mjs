// Loop every configured source, normalize into a common candidate shape, drop
// anything already reported (state/seen.json), and write candidates.json.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

import sources from '../sources.config.mjs';
import * as chromestatus from '../sources/chromestatus.mjs';
import * as feed from '../sources/feed.mjs';
import * as page from '../sources/page.mjs';

const adapters = { chromestatus, feed, page };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const key = c => `${c.source}:${c.id}`;

async function readSeen() {
  try {
    return new Set(JSON.parse(await readFile(join(root, 'state/seen.json'), 'utf8')));
  } catch {
    return new Set();
  }
}

// Fetch every source, dedup within the run and against seen.json, and report
// per-source health. Pure — writes nothing — so the dry-run harness can reuse it.
export async function collect() {
  const seen = await readSeen();
  const all = [];
  const health = [];

  for (const cfg of sources) {
    const adapter = adapters[cfg.type];
    if (!adapter) {
      health.push({ id: cfg.id, ok: false, error: `unknown source type "${cfg.type}"` });
      continue;
    }
    try {
      const items = await adapter.fetch(cfg);
      all.push(...items);
      health.push({ id: cfg.id, ok: true, count: items.length });
    } catch (err) {
      health.push({ id: cfg.id, ok: false, error: err.message });
    }
  }

  const byKey = new Map();
  for (const c of all) byKey.set(key(c), c);
  const candidates = [...byKey.values()].filter(c => !seen.has(key(c)));

  return { candidates, health, fetched: byKey.size };
}

// CLI entry: run the fetch and persist candidates.json. Skipped when imported.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { candidates, health, fetched } = await collect();
  for (const h of health) {
    if (h.ok) console.log(`${h.id}: ${h.count} item(s)`);
    else console.error(`Source "${h.id}" failed: ${h.error}`);
  }
  await writeFile(join(root, 'candidates.json'), JSON.stringify(candidates, null, 2));
  console.log(`\n${candidates.length} new candidate(s) after dedup (of ${fetched} fetched).`);
}
