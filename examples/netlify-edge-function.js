// Netlify Edge Function: netlify/edge-functions/crawler-snapshot.js
//
// 1. Run `crawler-prerender snapshot https://your-site.example --out public/_snapshots`
//    (or copy the snapshot folder into whatever directory Netlify publishes, under /_snapshots).
// 2. Save this file as netlify/edge-functions/crawler-snapshot.js.
// 3. Optional: keep people from landing on the raw snapshot files by adding to netlify.toml
//      [[headers]]
//        for = "/_snapshots/*"
//        [headers.values]
//          X-Robots-Tag = "noindex"
//
// Crawlers get the snapshot. Everyone else gets your normal site. Both carry Vary: User-Agent.

// The crawler list is generated from data/crawlers.json. To refresh it after the data file
// changes, run `node scripts/sync-examples.mjs`, or paste the output of
// `crawler-prerender agents --format regex`.
// BEGIN CRAWLERS
const CRAWLERS = /GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-User|Claude-SearchBot|PerplexityBot|Perplexity-User|CCBot|Googlebot|Google-InspectionTool|bingbot|Applebot|meta-externalagent|meta-externalfetcher|facebookexternalhit|Amazonbot|MistralAI-User|MistralAI-Index|MistralAI-Training|DuckAssistBot/i;
// END CRAWLERS

// Written by `crawler-prerender snapshot` at the top of every file. It is how we tell a real
// snapshot from your SPA fallback (a rule like "/* /index.html 200" answers a missing file
// with the app shell and a 200, which would otherwise be served to the bot as if it were a page).
const SNAPSHOT_MARK = '<!-- crawler-prerender';

const NON_PAGE = /\.(?!html?$)[a-z0-9]{1,8}$/i;

export default async (request, context) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return undefined;
  const url = new URL(request.url);
  if (NON_PAGE.test(url.pathname)) return undefined;

  if (CRAWLERS.test(request.headers.get('user-agent') || '')) {
    const route = url.pathname.replace(/\/+$/, '');
    const res = await fetch(new URL(`/_snapshots${route}/index.html`, url));
    if (res.ok) {
      const html = await res.text();
      if (html.includes(SNAPSHOT_MARK)) {
        return new Response(request.method === 'HEAD' ? null : html, {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'public, max-age=300',
            vary: 'User-Agent',
            'x-prerender': 'snapshot',
          },
        });
      }
    }
  }

  const res = await context.next();
  res.headers.append('vary', 'User-Agent');
  return res;
};

export const config = { path: '/*', excludedPath: ['/_snapshots/*'] };
