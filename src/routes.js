import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

const NON_PAGE_EXT =
  /\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp|mp4|webm|mov|mp3|wav|pdf|zip|gz|tar|xml|txt|json|js|mjs|css|map|woff2?|ttf|otf|eot|rss|atom)$/i;

/**
 * Turn any link into an absolute URL string with no hash. The query string is dropped
 * unless keepQuery is set, because most SPA routes do not depend on it and it would
 * otherwise explode a crawl. Returns null for anything that is not http(s).
 */
export function normalizeUrl(input, base, { keepQuery = false } = {}) {
  let u;
  try {
    u = new URL(input, base);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  if (!keepQuery) u.search = '';
  return u.href;
}

/** The identity of a route: its pathname, with "/about/" and "/about" treated as one. */
export function routeKey(urlString) {
  const u = new URL(urlString);
  let p = u.pathname || '/';
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p || '/';
}

/** True for URLs that look like pages rather than files. */
export function looksLikePage(urlString) {
  const { pathname } = new URL(urlString);
  return !NON_PAGE_EXT.test(pathname);
}

const ILLEGAL = /[<>:"|?*\u0000-\u001f]/g;

/**
 * Map a route to its file under outDir: /about -> out/about/index.html, / -> out/index.html,
 * /page.html -> out/page.html. Never returns a path outside outDir.
 */
export function routeToFile(outDir, route) {
  let p = route;
  try {
    p = decodeURIComponent(route);
  } catch {
    // keep the raw value if it is not valid percent-encoding
  }
  const segments = p.split('/').filter((s) => s && s !== '.').map((s) => s.replace(ILLEGAL, '_'));
  if (segments.some((s) => s === '..')) throw new Error(`Unsafe route "${route}"`);
  const last = segments[segments.length - 1];
  const parts = last && /\.html?$/i.test(last) ? segments : [...segments, 'index.html'];
  const root = resolve(outDir);
  const file = resolve(join(root, ...parts));
  if (file !== root && !file.startsWith(root + sep)) throw new Error(`Unsafe route "${route}"`);
  return file;
}

const decodeXml = (s) =>
  s
    .replace(/^<!\[CDATA\[|\]\]>$/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();

/** Read <loc> entries from a sitemap or sitemap index. */
export function parseSitemapXml(xml) {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const locs = [...xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map((m) => decodeXml(m[1])).filter(Boolean);
  return isIndex ? { urls: [], sitemaps: locs } : { urls: locs, sitemaps: [] };
}

/** Fetch a sitemap, following sitemap indexes two levels deep. Gzipped sitemaps are not supported. */
export async function urlsFromSitemap(sitemapUrl, { fetchImpl = fetch, userAgent, limit = 5000, maxDepth = 2 } = {}) {
  const out = [];
  const seen = new Set();
  async function walk(u, depth) {
    if (seen.has(u) || out.length >= limit) return;
    seen.add(u);
    const res = await fetchImpl(u, {
      headers: userAgent ? { 'user-agent': userAgent } : {},
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`Sitemap ${u} returned HTTP ${res.status}`);
    const { urls, sitemaps } = parseSitemapXml(await res.text());
    out.push(...urls);
    if (depth < maxDepth) for (const s of sitemaps) await walk(s, depth + 1);
  }
  await walk(sitemapUrl, 0);
  return out.slice(0, limit);
}

/** Parse a routes file: one route or URL per line, # for comments. A .json file may hold an array. */
export function parseRoutesText(text, base) {
  const trimmed = text.trim();
  let items;
  if (trimmed.startsWith('[')) {
    items = JSON.parse(trimmed);
    if (!Array.isArray(items)) throw new Error('Routes JSON must be an array of strings.');
  } else {
    items = trimmed.split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim());
  }
  return items
    .filter(Boolean)
    .map((r) => normalizeUrl(String(r), base))
    .filter(Boolean);
}

export async function readRoutesFile(path, base) {
  return parseRoutesText(await readFile(path, 'utf8'), base);
}
