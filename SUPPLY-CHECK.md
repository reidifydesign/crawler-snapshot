# Supply check

Run on 2026-09-29, before any code was written. Every count and date below was read that day.

## Verdict

**Continue.** No maintained, free, self-hosted tool covers the whole job (render routes with
headless Chrome, save the HTML, serve it to crawler user agents, and show what a crawler sees
before and after). Several partial tools exist. Read this file for what they are, because the
field is more crowded than the first research suggested.

## What exists now

| Tool | Stars | Last push | Licence | What it does | What it does not do |
|---|---:|---|---|---|---|
| lukapozega/renderready | 2 | 2026-09-21 | MIT | Playwright render server: send a URL, get rendered HTML. npm package. Created 2026-08-06 | States "No crawler detection" by design. No snapshot-to-files CLI. No raw-versus-rendered diagnostic (its author's own launch post, 2026-08-10) |
| haku-d/prerender | 1 | 2026-04-10 | none stated | Nginx bot match, disk cache, Puppeteer, sitemap cache warmer | Needs PostgreSQL. No licence file, so not reusable. No diagnostic |
| Shesek11/prerender-server | 1 | 2026-03-04 | none stated | Express plus Puppeteer render server, nginx proxy recipe | No snapshot files, no diagnostic, no licence |
| spacetab-io/prerender-go | 3 | 2026-08-12 | MIT | Go CLI: read sitemap, render through Chrome, store to S3 or disk | No crawler serving layer in the box, no diagnostic |
| kopachlager/prerenderbuddy-engine | 0 | 2026-09-27 | Apache-2.0 | Docker render engine that is the free half of a hosted platform | Token-gated API, hosted platform is the product |
| giacomorebonato/fastify-prerender-plugin | 0 | 2026-09-28 | none stated | Fastify plugin, bot detection, Lightpanda browser | Fastify only, Node 22 |
| solidjs/prerender-crawler | 5 | 2026-09-06 | MIT | Build-time crawl of a fetch-shaped handler | Not a browser, framework specific |
| lzwme/prerender-kit (@lzwme/prerender-kit) | 1 | 2026-09-08 | MIT | Headless-browser SPA route snapshots to static HTML, CLI and Vite/webpack/rollup plugins, incremental. Documentation is in Chinese. Found during the naming check | No crawler serving layer, no diagnostic |
| Trident PRISM (trident-prism.com) | n/a | n/a | commercial | Rust dynamic rendering proxy, 70+ bot patterns, self-hosted | Sold at a one-off price on its own page, not free, no repo link |
| prerender-node / prerender_rails | 921 / 358 | 2026-06 | MIT | Middleware for the paid Prerender.io service | The render engine is not open |
| rendertron | 5,950 | archived 2022 | Apache-2.0 | Original render server | Archived |
| react-snap, prerender-spa-plugin | 5,119 / 7,264 | 2026-02 / archived 2023 | MIT | Build-time snapshotting | Stale or archived |

The diagnostic half is covered by hosted single-URL checkers (LLM Pulse GEO Crawlability
Checker, SEOmator, Encited) and by MerqryLabs/ai-crawler-visibility (4 stars, pushed
2026-06-30), an open-source CLI. That finding comes from the earlier supply-g4 pass and was not
re-run here. None of them write a snapshot, and none is packaged with a serving layer.

## Where this repo differs

- One CLI that does the loop: `check` (what a crawler sees), `snapshot` (render to files),
  `serve` examples (hand the files to crawlers).
- Static files plus a manifest, resumable, not a long-running render server.
- `check` looks for content that arrives late in streamed chunks and stays hidden without
  JavaScript, which is the failure behind the reidify.design incident.
- The crawler list is a data file with a source URL per entry, and it says which entries were
  and were not verified.
- Free, MIT, no hosted tier, no database.

The risk is real. renderready is a similar-looking, current, MIT-licensed, npm-published tool
that appeared seven weeks ago and has the same "replace the abandoned tools" pitch. What it
declines to do (crawler detection, snapshots, diagnosis) is what this repo does, but a reader
who does not look closely will file the two together.

## Searches run

GitHub repository search (`gh api search/repositories`, 3 seconds between calls):

1. `prerender crawler user agent headless chrome pushed:>2026-03-29` (0)
2. `dynamic rendering bots headless chromium self-hosted pushed:>2026-03-29` (0)
3. `spa snapshot static html seo playwright pushed:>2026-03-29` (0)
4. `serve prerendered html to gptbot claudebot pushed:>2026-03-29` (0)
5. `prerender ai crawlers javascript spa in:name,description,readme pushed:>2026-03-29` (192, all noise)
6. `rendertron alternative in:name,description,readme` (44, dockette/rendertron Docker wrapper)
7. `topic:prerender pushed:>2026-03-29` (48, solidjs/prerender-crawler, Trinovantes/puppeteer-prerender-plugin)
8. `topic:prerendering pushed:>2026-03-29` (46, kopachlager/*, seo4ajax/connect-s4a)
9. `react-snap alternative in:readme pushed:>2026-03-29` (239, noise)
10. `crawler prerender middleware nginx bot user-agent snapshot pushed:>2026-03-29` (0)
11. `prerender spa bots` (5, spacetab-io/prerender-go, haku-d/prerender, rendermw, fastify plugin)
12. `prerender playwright seo` (5, renderready, prerenderbuddy-engine)
13. `rendering proxy crawlers spa` (0)
14. `prerender in:name pushed:>2026-04-01` (174, all near zero stars)
15. `renderready OR prerender-server OR rendermw in:name` (59)
16. `ai crawlers javascript rendering static snapshot` (0)

npm registry search (`registry.npmjs.org/-/v1/search`): `prerender spa`, `prerender crawler`,
`rendertron`, `dynamic rendering bots`, `spa prerender headless chrome`, `prerender ai crawlers`.
Fresh packages of note: `prerender-crawler` and `@solidjs/prerender` (0.2.0, 2026-09-06),
`fastify-prerender-plugin` (2026-01-05), `vite-prerender-plugin` (build-time, framework side),
`@lownoise-studio/rendershield` 1.2.4 (2026-09-25, not inspected in depth, described as
bot-aware prerendering), `crawlview` 1.4.2 (2026-08-30, diagnostic, not inspected in depth).
`prerender` (the server package) was last published 2024-09-12.

Web search: `open source self-hosted prerender for SPA crawlers AI bots GPTBot headless Chrome
alternative to Prerender.io 2026`, and `rendertron archived replacement self-hosted dynamic
rendering serve static html to bots 2026`. New names surfaced: Trident PRISM (commercial) and
the renderready launch post on dev.to (2026-08-10, zero comments when read).

## Two more found late and read

- `crawlview` (npm, VictorCreciun/crawlview, 1 star, MIT, last published 2026-08-30): a CLI that
  requests one URL as 15 named crawlers and, with `--render`, compares against a rendered
  browser. **This overlaps the `check` command directly.** It is single-URL, needs no snapshot,
  and its README does not mention content hidden in streamed chunks. It does not write
  snapshots or serve anything. The diagnostic half of this repo is therefore not unique. What
  is different: multi-route runs from a sitemap or crawl, the hidden streamed chunk finding,
  a JSON report, and the same tool then fixing what it found.
- `@lownoise-studio/rendershield` (MIT, 0 stars, published 2026-09-25): its own README says it
  does not run a browser or capture a rendered DOM. It builds static HTML from Markdown. Not a
  competitor for JavaScript-heavy sites.

The plan already requires a second supply check the day before launch. Re-read crawlview then.
