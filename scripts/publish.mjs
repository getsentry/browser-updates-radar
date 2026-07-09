// Turn each triage pick into its own GitHub issue — one issue per topic, keyed
// deterministically by `source:id` via the state/topics.json ledger:
//
//   - new topic          -> create an issue (labels: triage, impact:<x>,
//                           urgency:<y>) with a hidden radar-key marker.
//   - changed topic that  -> add an "updated" comment + label, so the topic
//     already has an issue    receives its history independently. Limited to
//                             breaking/opportunity; watch items are file-once.
//   - unchanged topic     -> nothing.
//
// The ledger (not GitHub search) is the dedup authority, so two runs can never
// open two issues for the same topic. Set DRY_RUN=1 to print the planned actions
// and touch nothing (no issues, no ledger write).

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { readTopics } from './fetch-candidates.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.env.DRY_RUN === '1';
const today = new Date().toISOString().slice(0, 10);

const candidates = JSON.parse(await readFile(join(root, 'candidates.json'), 'utf8'));
const { picks = [] } = JSON.parse(await readFile(join(root, 'triage.json'), 'utf8'));

const byRef = new Map(candidates.map(c => [`${c.source}:${c.id}`, c]));

// Tiers whose issues keep receiving update comments as the topic evolves.
const UPDATE_TIERS = new Set(['breaking', 'opportunity']);

const LABELS = [
  ['triage', 'fbca04', 'Needs human review / prioritization'],
  ['updated', '0e8a16', 'Topic changed upstream since it was filed'],
  ['impact:breaking', 'b60205', 'Breaking risk to the SDK'],
  ['impact:opportunity', '0e8a16', 'New primitive the SDK could adopt'],
  ['impact:watch', 'c5def5', 'Standards-track, not yet actionable'],
  ['urgency:high', 'd93f0b', ''],
  ['urgency:med', 'fbca04', ''],
  ['urgency:low', 'c2e0c6', ''],
];

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;

// Team to @mention on newly filed issues so they get notified. Defaults to the
// JS Browser SDK team; set the NOTIFY_TEAM repo variable to another "@org/team"
// handle to override, or to "none" to disable the mention. An unset repo
// variable arrives as an empty string, so `||` (not `??`) keeps the default.
const rawTeam = (process.env.NOTIFY_TEAM || '@getsentry/team-javascript-sdks-browser').trim();
const notifyTeam = rawTeam === 'none' ? '' : rawTeam;

async function gh(method, path, body) {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'browser-updates-radar',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

// Create any missing labels once. Re-creating an existing label 422s, which we ignore.
async function ensureLabels() {
  for (const [name, color, description] of LABELS) {
    try {
      await gh('POST', '/labels', { name, color, description });
    } catch {
      /* already exists */
    }
  }
}

function detailLines(c) {
  const lines = [];
  const meta = [];
  if (c.type) meta.push(`type: ${c.type}`);
  if (c.maturity) meta.push(`maturity: ${c.maturity}`);
  if (c.extra?.milestone) meta.push(`chrome milestone: ${c.extra.milestone} (${c.extra.channel})`);
  if (meta.length) lines.push(meta.join(' · '));
  if (c.browsers) {
    lines.push(`browsers: chrome ${c.browsers.chrome ?? '—'} · firefox ${c.browsers.firefox ?? '—'} · safari ${c.browsers.safari ?? '—'}`);
  }
  return lines;
}

function issueBody(c, pick) {
  const lines = [pick.why, ''];
  const details = detailLines(c);
  if (details.length) lines.push(details.join('\n'), '');
  lines.push(`🔗 ${c.url}`);
  if (notifyTeam) lines.push('', `cc ${notifyTeam}`);
  lines.push('', `<!-- radar-key: ${pick.ref} -->`);
  return lines.join('\n');
}

function updateComment(c, pick) {
  const lines = [`🔄 Updated upstream — re-triaged ${today} as **${pick.impact}** / urgency **${pick.urgency}**.`, '', pick.why];
  const details = detailLines(c);
  if (details.length) lines.push('', details.join('\n'));
  lines.push('', `🔗 ${c.url}`);
  return lines.join('\n');
}

const actions = [];
for (const pick of picks) {
  const c = byRef.get(pick.ref);
  if (!c) continue; // pick must correspond to a fetched candidate
  const labels = ['triage', `impact:${pick.impact}`, `urgency:${pick.urgency}`];

  if (c.prevIssue == null) {
    actions.push({ kind: 'create', pick, c, labels });
  } else if (UPDATE_TIERS.has(pick.impact)) {
    actions.push({ kind: 'update', pick, c, issue: c.prevIssue });
  } else {
    actions.push({ kind: 'skip-update', pick, c, issue: c.prevIssue });
  }
}

// Persist the ledger: keep every existing topic, refresh fingerprints for
// everything fetched this run, and record freshly created issue numbers.
async function writeLedger(created) {
  const topics = await readTopics();
  for (const c of candidates) {
    const ref = `${c.source}:${c.id}`;
    const prev = topics[ref] ?? {};
    topics[ref] = { issue: prev.issue ?? null, fingerprint: c.fingerprint, impact: prev.impact ?? null };
  }
  for (const { pick, issue } of created) {
    topics[pick.ref] = { ...topics[pick.ref], issue, impact: pick.impact };
  }
  await writeFile(join(root, 'state/topics.json'), JSON.stringify(topics, null, 2));
  console.log(`topics.json now tracks ${Object.keys(topics).length} topic(s).`);
}

if (actions.length === 0) {
  console.log('Nothing new or notable — no issues to file.');
  if (!dryRun) await writeLedger([]);
  else console.log('(dry run — ledger left unchanged)');
  process.exit(0);
}

if (dryRun) {
  console.log(`Would apply ${actions.length} action(s):\n`);
  for (const a of actions) {
    if (a.kind === 'create') console.log(`  + CREATE  #new   [${a.labels.join(', ')}]  ${a.pick.title}`);
    else if (a.kind === 'update') console.log(`  ~ COMMENT #${a.issue}        (+updated)  ${a.pick.title}`);
    else console.log(`  · SKIP    #${a.issue}   (watch tier, file-once)  ${a.pick.title}`);
  }
  console.log('\n(dry run — no issues created or updated, state/topics.json left unchanged)');
  process.exit(0);
}

if (!token || !repo) {
  console.error('GH_TOKEN/GITHUB_TOKEN and GITHUB_REPOSITORY must be set to create issues.');
  process.exit(1);
}

if (actions.some(a => a.kind === 'create')) await ensureLabels();

const created = [];
for (const a of actions) {
  if (a.kind === 'create') {
    const issue = await gh('POST', '/issues', {
      title: a.pick.title,
      body: issueBody(a.c, a.pick),
      labels: a.labels,
    });
    created.push({ pick: a.pick, issue: issue.number });
    console.log(`Created #${issue.number}: ${issue.html_url}`);
  } else if (a.kind === 'update') {
    await gh('POST', `/issues/${a.issue}/comments`, { body: updateComment(a.c, a.pick) });
    try {
      await gh('POST', `/issues/${a.issue}/labels`, { labels: ['updated'] });
    } catch {
      /* label may already be present */
    }
    console.log(`Commented on #${a.issue} (${a.pick.impact}).`);
  } else {
    console.log(`Skipped update for #${a.issue} (watch tier).`);
  }
}

await writeLedger(created);
