// Chrome Platform Status adapter.
// Pulls the features shipping in the current stable/beta/dev milestones via the
// public JSON API (https://chromestatus.com/api/v0). Responses are prefixed with
// an XSSI guard ")]}'" that has to be stripped before JSON.parse.

const BASE = 'https://chromestatus.com/api/v0';

async function getJSON(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const text = await res.text();
  const brace = text.indexOf('{');
  const bracket = text.indexOf('[');
  const start = bracket === -1 ? brace : brace === -1 ? bracket : Math.min(brace, bracket);
  return JSON.parse(text.slice(start));
}

// The features-by-milestone endpoint returns an object keyed by category
// ("Enabled by default", "Deprecated", "Removed", ...). Flatten every array of
// feature-like objects we find, regardless of the exact key names.
function flattenFeatures(payload) {
  const out = [];
  // The endpoint wraps the category buckets under `features_by_type`.
  const root = payload?.features_by_type ?? payload;
  const buckets = Array.isArray(root) ? [root] : Object.values(root ?? {});
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    for (const f of bucket) {
      if (f && typeof f === 'object' && f.id != null) out.push(f);
    }
  }
  return out;
}

const TYPE_LABELS = { 0: 'new feature', 1: 'enhancement', 2: 'change', 3: 'deprecation' };

export async function fetch_(_cfg) {
  const channels = await getJSON(`${BASE}/channels`);

  const milestones = new Map(); // mstone -> channel label
  for (const key of ['stable', 'beta', 'dev']) {
    const m = channels?.[key]?.mstone;
    if (typeof m === 'number') milestones.set(m, key);
  }

  const seenIds = new Set();
  const candidates = [];

  for (const [mstone, channel] of milestones) {
    let features;
    try {
      features = flattenFeatures(await getJSON(`${BASE}/features?milestone=${mstone}`));
    } catch (err) {
      console.error(`chromestatus: milestone ${mstone} failed: ${err.message}`);
      continue;
    }

    for (const f of features) {
      if (seenIds.has(f.id)) continue; // a feature can span channels
      seenIds.add(f.id);

      candidates.push({
        source: 'chromestatus',
        id: String(f.id),
        title: f.name ?? '(unnamed feature)',
        summary: f.summary ?? '',
        url: `https://chromestatus.com/feature/${f.id}`,
        date: null,
        type: TYPE_LABELS[f.feature_type_int] ?? f.feature_type ?? null,
        components: f.blink_components ?? [],
        maturity: f.standards?.maturity?.text ?? null,
        browsers: {
          chrome: f.browsers?.chrome?.status?.text ?? null,
          firefox: f.browsers?.ff?.view?.text ?? null,
          safari: f.browsers?.safari?.view?.text ?? null,
        },
        extra: { milestone: mstone, channel },
      });
    }
  }

  return candidates;
}

export { fetch_ as fetch };
