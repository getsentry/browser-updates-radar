// Generic RSS / Atom feed adapter. Add a feed by dropping one line into
// sources.config.mjs — no code changes needed.

import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

const MAX_ENTRIES = 20; // newest N per feed; seen.json suppresses repeats after that
const MAX_AGE_DAYS = 45; // ignore stale entries on first run

const asArray = v => (Array.isArray(v) ? v : v == null ? [] : [v]);

function textOf(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return v['#text'] ?? '';
}

function stripHtml(s) {
  return String(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

function linkOf(entry) {
  // Atom: <link href="..."> (possibly several); RSS: <link>text</link>
  const link = entry.link;
  if (typeof link === 'string') return link;
  for (const l of asArray(link)) {
    if (l?.['@_href'] && (!l['@_rel'] || l['@_rel'] === 'alternate')) return l['@_href'];
  }
  return entry.guid ? textOf(entry.guid) : '';
}

export async function fetch_(cfg) {
  if (!cfg.url) throw new Error(`feed source "${cfg.id}" is missing a url`);
  const res = await fetch(cfg.url, { headers: { accept: 'application/rss+xml, application/atom+xml, application/xml' } });
  if (!res.ok) throw new Error(`${cfg.url} -> ${res.status}`);
  const xml = parser.parse(await res.text());

  const items = xml?.rss?.channel?.item ?? xml?.feed?.entry ?? [];
  const cutoff = Date.parse(new Date().toISOString()) - MAX_AGE_DAYS * 86400000;

  const out = [];
  for (const item of asArray(items).slice(0, MAX_ENTRIES)) {
    const title = textOf(item.title);
    const url = linkOf(item);
    const rawDate = textOf(item.pubDate) || textOf(item.published) || textOf(item.updated);
    const ts = rawDate ? Date.parse(rawDate) : NaN;
    if (!Number.isNaN(ts) && ts < cutoff) continue;

    out.push({
      source: cfg.id,
      id: url || title,
      title: title || '(untitled)',
      summary: stripHtml(textOf(item.summary) || textOf(item.description) || textOf(item.content) || textOf(item['content:encoded'])),
      url,
      date: rawDate || null,
      type: null,
      components: [],
      maturity: null,
      browsers: null,
      extra: { feed: cfg.url },
    });
  }
  return out;
}

export { fetch_ as fetch };
