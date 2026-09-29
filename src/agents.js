import { readFileSync } from 'node:fs';

const DATA_URL = new URL('../data/crawlers.json', import.meta.url);

let cache;

/** Load the crawler list from data/crawlers.json. */
export function loadAgents() {
  if (!cache) cache = JSON.parse(readFileSync(DATA_URL, 'utf8'));
  return cache;
}

/**
 * Entries that should receive a snapshot: real crawlers, not robots.txt control tokens.
 * Pass `extra` (strings or {name, token}) to add your own.
 */
export function serveList({ extra = [], includeUnverified = false } = {}) {
  const base = loadAgents().agents.filter(
    (a) => a.serve && a.crawls && (includeUnverified || a.verification !== 'unverified'),
  );
  const added = extra.map((e) => (typeof e === 'string' ? { name: e, token: e } : e));
  return [...base, ...added];
}

export const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One case-insensitive RegExp that matches any served crawler token. */
export function crawlerRegex(opts) {
  return new RegExp(serveList(opts).map((a) => escapeRe(a.token)).join('|'), 'i');
}

/** True when a User-Agent header belongs to a served crawler. */
export function isCrawler(userAgent, opts) {
  if (!userAgent) return false;
  return crawlerRegex(opts).test(userAgent);
}

/** Find a data entry by name (case-insensitive). */
export function findAgent(name) {
  const n = String(name).toLowerCase();
  return loadAgents().agents.find((a) => a.name.toLowerCase() === n) || null;
}

/**
 * The User-Agent string used when `check` pretends to be a crawler.
 * Entries with a documented string use it. Otherwise the token is wrapped in a plain
 * compatible-style string, and the caller is told it was made up.
 */
export function userAgentFor(name) {
  const a = findAgent(name);
  if (!a) return { ua: String(name), documented: false, known: false };
  if (a.userAgent) {
    return { ua: a.userAgent.replace(/W\.X\.Y\.Z/g, '131.0.0.0'), documented: true, known: true };
  }
  return { ua: `Mozilla/5.0 (compatible; ${a.token}/1.0)`, documented: false, known: true };
}

/** Render the list for the `agents` command and the copy-paste examples. */
export function formatAgents(format, opts) {
  const list = serveList(opts);
  const alternation = list.map((a) => escapeRe(a.token)).join('|');
  switch (format) {
    case 'regex':
      return alternation;
    case 'nginx':
      return [
        'map $http_user_agent $crawler_snapshot {',
        '    default "/_no_snapshot";',
        `    "~*(${alternation})" "/_snapshots";`,
        '}',
      ].join('\n');
    case 'json':
      return JSON.stringify(list, null, 2);
    case 'tokens':
      return list.map((a) => a.token).join('\n');
    default:
      throw new Error(`Unknown format "${format}". Use table, regex, nginx, json or tokens.`);
  }
}
