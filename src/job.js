import { loadRobots } from './robots.js';
import { looksLikePage, normalizeUrl, readRoutesFile, routeKey, urlsFromSitemap } from './routes.js';

/**
 * Work out what to visit. Shared by `snapshot` and `check`.
 *
 * Inputs, any mix: a base URL, a sitemap URL, a routes file. `crawl: true` follows
 * same-origin links found in the rendered DOM up to `depth` and `maxPages`.
 */
export async function buildJob(opts, { fetchImpl = fetch, log = () => {} } = {}) {
  const { url, sitemap, routesFile, crawl = false } = opts;
  if (!url && !sitemap) throw new Error('Give a base URL, or --sitemap <url>.');

  const baseUrl = url ? normalizeUrl(url, undefined, { keepQuery: true }) : new URL('/', sitemap).href;
  if (!baseUrl) throw new Error(`"${url}" is not an http(s) URL.`);
  const origin = new URL(baseUrl).origin;

  const include = opts.include ? new RegExp(opts.include) : null;
  const exclude = opts.exclude ? new RegExp(opts.exclude) : null;
  const notes = [];

  const pathOk = (u) => {
    const { pathname } = new URL(u);
    if (include && !include.test(pathname)) return false;
    if (exclude && exclude.test(pathname)) return false;
    return true;
  };

  let raw = [];
  if (url && !sitemap && !routesFile) raw.push(baseUrl);
  if (sitemap) {
    const fromMap = await urlsFromSitemap(sitemap, { fetchImpl, userAgent: opts.sitemapUserAgent });
    raw.push(...fromMap.map((u) => normalizeUrl(u, sitemap)).filter(Boolean));
    log(`sitemap: ${fromMap.length} URLs`);
  }
  if (routesFile) raw.push(...(await readRoutesFile(routesFile, baseUrl)));
  if (url && (sitemap || routesFile) && crawl) raw.push(baseUrl);

  const sameOrigin = raw.filter((u) => new URL(u).origin === origin);
  if (sameOrigin.length !== raw.length) {
    notes.push(`${raw.length - sameOrigin.length} URL(s) on other origins were skipped (only ${origin} is visited).`);
  }
  const seeds = sameOrigin.filter((u) => pathOk(u));
  if (seeds.length !== sameOrigin.length) {
    notes.push(`${sameOrigin.length - seeds.length} URL(s) removed by --include/--exclude.`);
  }
  // dedupe by route
  const seenKeys = new Set();
  const uniqueSeeds = seeds.filter((u) => {
    const k = routeKey(u);
    if (seenKeys.has(k)) return false;
    seenKeys.add(k);
    return true;
  });

  const listMode = Boolean(sitemap || routesFile);
  const maxPages = opts.maxPages ?? (crawl && !listMode ? 100 : 1000);
  const maxDepth = crawl ? (opts.depth ?? 2) : 0;

  let robots = null;
  if (crawl && !opts.ignoreRobots) robots = await loadRobots(origin, fetchImpl);

  /** Should a link found while crawling be followed? */
  const acceptLink = (u) => {
    if (new URL(u).origin !== origin) return false;
    if (!looksLikePage(u)) return false;
    if (!pathOk(u)) return false;
    if (robots && !robots.isAllowed(new URL(u).pathname)) return false;
    return true;
  };

  return { origin, baseUrl, seeds: uniqueSeeds, crawl, maxDepth, maxPages, acceptLink, notes };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Visit seeds, and links the worker returns, with a fixed number of parallel workers.
 * `worker({url, key, depth})` returns `{links?: string[]}`.
 * Each worker waits `delayMs` after every page, which is the politeness knob.
 */
export async function runFrontier(job, { concurrency = 2, delayMs = 0, worker }) {
  const seen = new Set();
  const queue = [];
  let active = 0;
  let capped = false;

  const add = (url, depth) => {
    const key = routeKey(url);
    if (seen.has(key)) return;
    if (seen.size >= job.maxPages) {
      capped = true;
      return;
    }
    seen.add(key);
    queue.push({ url, key, depth });
  };
  job.seeds.forEach((u) => add(u, 0));

  async function loop() {
    for (;;) {
      const item = queue.shift();
      if (!item) {
        if (active === 0) return;
        await sleep(20);
        continue;
      }
      active++;
      try {
        const res = (await worker(item)) || {};
        if (job.crawl && item.depth < job.maxDepth) {
          for (const l of res.links || []) {
            const n = normalizeUrl(l, item.url);
            if (n && job.acceptLink(n)) add(n, item.depth + 1);
          }
        }
      } finally {
        active--;
      }
      if (delayMs) await sleep(delayMs);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, loop));
  return { visited: seen.size, capped };
}
