// Best-effort webpage adapter — the escape hatch for sources with no feed or API.
// Fetches the page, reduces it to plain text, and hands the agent a single
// snapshot candidate to mine for noteworthy items. The id is a content hash, so a
// page only re-surfaces for triage when its text actually changes.

function stripToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Tiny deterministic string hash (djb2). No Math.random / Date needed.
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export async function fetch_(cfg) {
  if (!cfg.url) throw new Error(`page source "${cfg.id}" is missing a url`);
  const res = await fetch(cfg.url, { headers: { accept: 'text/html' } });
  if (!res.ok) throw new Error(`${cfg.url} -> ${res.status}`);
  const text = stripToText(await res.text()).slice(0, 6000);

  return [
    {
      source: cfg.id,
      id: hash(text),
      title: `Snapshot: ${cfg.url}`,
      summary: text,
      url: cfg.url,
      date: null,
      type: 'page-snapshot',
      components: [],
      maturity: null,
      browsers: null,
      extra: { note: 'Page snapshot — extract individual noteworthy items from the summary text.' },
    },
  ];
}

export { fetch_ as fetch };
