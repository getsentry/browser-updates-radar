// Loop every configured source, normalize into a common candidate shape, and
// diff each against state/topics.json by a content fingerprint so we can tell
// new / changed / unchanged apart. Writes candidates.json (all fetched items,
// annotated). Nothing is filtered for relevance here — that's triage's job.

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

// djb2 — a tiny deterministic hash (no Math.random / Date needed).
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// Fingerprint the fields that mean "this topic materially changed" — e.g. a
// chromestatus feature advancing dev -> beta, or its summary being rewritten.
function fingerprint(c) {
  return hash(
    JSON.stringify([c.title, c.summary, c.type, c.maturity, c.browsers, c.extra?.milestone ?? null, c.extra?.channel ?? null]),
  );
}

// The topic ledger is the source of truth for "have we filed this, and what did
// it look like last time". Falls back to migrating a legacy seen.json (an array
// of keys) into the new shape so upgrades don't re-file everything.
export async function readTopics() {
  try {
    return JSON.parse(await readFile(join(root, 'state/topics.json'), 'utf8'));
  } catch {
    /* fall through to migration */
  }
  try {
    const seen = JSON.parse(await readFile(join(root, 'state/seen.json'), 'utf8'));
    const topics = {};
    for (const k of seen) topics[k] = { issue: null, fingerprint: null, impact: null };
    return topics;
  } catch {
    return {};
  }
}

// Fetch every source and annotate each candidate against the ledger. Pure —
// writes nothing — so the dry-run harness can reuse it.
export async function collect() {
  const topics = await readTopics();
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

  // Dedup within this run, then annotate against the ledger.
  const byKey = new Map();
  for (const c of all) byKey.set(key(c), c);

  const candidates = [...byKey.values()].map(c => {
    const fp = fingerprint(c);
    const prev = topics[key(c)];
    // A null stored fingerprint means "known but never fingerprinted" (legacy
    // seen.json) — leave those alone rather than re-triaging the whole backlog.
    const changed = !prev || (prev.fingerprint != null && prev.fingerprint !== fp);
    return { ...c, fingerprint: fp, changed, prevIssue: prev?.issue ?? null };
  });

  const counts = {
    total: candidates.length,
    new: candidates.filter(c => c.changed && c.prevIssue == null && !topics[key(c)]).length,
    changed: candidates.filter(c => c.changed && topics[key(c)]).length,
    unchanged: candidates.filter(c => !c.changed).length,
  };

  return { candidates, health, counts };
}

// CLI entry: run the fetch and persist candidates.json. Skipped when imported.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { candidates, health, counts } = await collect();
  for (const h of health) {
    if (h.ok) console.log(`${h.id}: ${h.count} item(s)`);
    else console.error(`Source "${h.id}" failed: ${h.error}`);
  }
  await writeFile(join(root, 'candidates.json'), JSON.stringify(candidates, null, 2));
  console.log(`\n${counts.total} fetched — ${counts.new} new, ${counts.changed} changed, ${counts.unchanged} unchanged.`);
}
