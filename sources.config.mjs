// Add data sources here. One entry = one place we pull from.
//
// Types:
//   - 'chromestatus' : rich Chrome Platform Status adapter (no url needed).
//   - 'feed'         : any RSS or Atom feed. Just give it a url.
//   - 'page'         : any webpage. Best-effort text snapshot; the agent reads it.
//
// `id` must be unique and stable — it namespaces the dedup state in state/seen.json.

export default [
  { type: 'chromestatus', id: 'chromestatus' },

  { type: 'feed', id: 'webkit', url: 'https://webkit.org/feed/atom/' },
  { type: 'feed', id: 'whatwg', url: 'https://blog.whatwg.org/feed' },
  { type: 'feed', id: 'mozilla-hacks', url: 'https://hacks.mozilla.org/feed/' },

  // Examples of more links you can add — uncomment or add your own:
  // { type: 'feed', id: 'chrome-developer', url: 'https://developer.chrome.com/static/blog/feed.xml' },
  // { type: 'feed', id: 'v8',               url: 'https://v8.dev/blog.atom' },
  // { type: 'page', id: 'tc39-proposals',   url: 'https://github.com/tc39/proposals' },
];
