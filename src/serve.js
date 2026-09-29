import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { crawlerRegex, isCrawler, serveList } from './agents.js';
import { looksLikePage, routeKey, routeToFile } from './routes.js';

export { isCrawler, serveList };

/** Add a value to the Vary header without dropping what is already there. */
export function appendVary(res, value) {
  const current = res.getHeader('Vary');
  if (!current) return res.setHeader('Vary', value);
  const list = String(current).split(',').map((s) => s.trim().toLowerCase());
  if (list.includes('*') || list.includes(value.toLowerCase())) return undefined;
  return res.setHeader('Vary', `${current}, ${value}`);
}

/**
 * Find the snapshot file for a request path, or null. Files are the ones `snapshot` wrote:
 * /about -> <dir>/about/index.html.
 */
export function findSnapshot(dir, pathname) {
  let route;
  try {
    route = routeKey(new URL(pathname, 'http://local').href);
  } catch {
    return null;
  }
  let file;
  try {
    file = routeToFile(dir, route);
  } catch {
    return null;
  }
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

/**
 * Connect-style middleware: `(req, res, next)`. Works with Express, Fastify's middie, and a
 * plain `http.createServer` handler (pass your app as `next`).
 *
 * - Every page request gets `Vary: User-Agent`, because the answer depends on it.
 * - A request from a listed crawler for a route that has a snapshot gets the snapshot.
 * - Everyone else, and any route without a snapshot, falls through to your app.
 */
export function createSnapshotMiddleware({
  dir = 'out',
  userAgents = [],
  includeUnverified = false,
  cacheControl = 'public, max-age=300',
} = {}) {
  const regex = crawlerRegex({ extra: userAgents, includeUnverified });

  return async function snapshotMiddleware(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const rawUrl = req.originalUrl || req.url || '/';
    const pathname = rawUrl.split('?')[0];
    if (!looksLikePage(new URL(pathname, 'http://local').href)) return next();

    appendVary(res, 'User-Agent');
    const ua = req.headers['user-agent'] || '';
    if (!regex.test(ua)) return next();

    const file = findSnapshot(dir, pathname);
    if (!file) return next();

    try {
      const body = await readFile(file);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Length', body.length);
      res.setHeader('Cache-Control', cacheControl);
      res.setHeader('X-Prerender', 'snapshot');
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (err) {
      next(err);
    }
    return undefined;
  };
}
