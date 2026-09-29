import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { buildJob, runFrontier } from '../src/job.js';
import { parseRobots } from '../src/robots.js';
import { looksLikePage, normalizeUrl, parseRoutesText, parseSitemapXml, routeKey, routeToFile } from '../src/routes.js';

test('normalizeUrl drops hash and query, resolves relative links, rejects other schemes', () => {
  assert.equal(normalizeUrl('/a?x=1#top', 'https://e.com/base'), 'https://e.com/a');
  assert.equal(normalizeUrl('/a?x=1', 'https://e.com', { keepQuery: true }), 'https://e.com/a?x=1');
  assert.equal(normalizeUrl('mailto:a@b.c', 'https://e.com'), null);
  assert.equal(normalizeUrl('javascript:void(0)', 'https://e.com'), null);
});

test('routeKey treats a trailing slash as the same route', () => {
  assert.equal(routeKey('https://e.com/about/'), '/about');
  assert.equal(routeKey('https://e.com/about'), '/about');
  assert.equal(routeKey('https://e.com/'), '/');
});

test('looksLikePage rejects files and accepts routes', () => {
  assert.equal(looksLikePage('https://e.com/file.pdf'), false);
  assert.equal(looksLikePage('https://e.com/logo.SVG'), false);
  assert.equal(looksLikePage('https://e.com/about'), true);
  assert.equal(looksLikePage('https://e.com/page.html'), true);
  assert.equal(looksLikePage('https://e.com/v1.2/docs'), true);
});

test('routeToFile maps routes to index.html files under the output directory', () => {
  const out = resolve('out-test');
  assert.equal(routeToFile(out, '/'), join(out, 'index.html'));
  assert.equal(routeToFile(out, '/about'), join(out, 'about', 'index.html'));
  assert.equal(routeToFile(out, '/a/b/c'), join(out, 'a', 'b', 'c', 'index.html'));
  assert.equal(routeToFile(out, '/legacy.html'), join(out, 'legacy.html'));
});

test('routeToFile cannot escape the output directory', () => {
  const out = resolve('out-test');
  assert.throws(() => routeToFile(out, '/../etc/passwd'), /Unsafe/);
  assert.throws(() => routeToFile(out, '/a/%2e%2e/%2e%2e/x'), /Unsafe/);
  const odd = routeToFile(out, '/a:b/c?d');
  assert.ok(odd.startsWith(out));
  assert.doesNotMatch(odd.slice(out.length), /[:?]/);
});

test('parseSitemapXml reads urlsets, sitemap indexes, entities and CDATA', () => {
  const set = parseSitemapXml('<urlset><url><loc>https://e.com/a?x=1&amp;y=2</loc></url><url><loc><![CDATA[https://e.com/b]]></loc></url></urlset>');
  assert.deepEqual(set.urls, ['https://e.com/a?x=1&y=2', 'https://e.com/b']);
  const idx = parseSitemapXml('<sitemapindex><sitemap><loc>https://e.com/s1.xml</loc></sitemap></sitemapindex>');
  assert.deepEqual(idx, { urls: [], sitemaps: ['https://e.com/s1.xml'] });
});

test('parseRoutesText accepts lines with comments and JSON arrays', () => {
  const base = 'https://e.com';
  assert.deepEqual(parseRoutesText('/\n# skip\n/about  # trailing\n\nhttps://e.com/x', base), ['https://e.com/', 'https://e.com/about', 'https://e.com/x']);
  assert.deepEqual(parseRoutesText('["/a","/b"]', base), ['https://e.com/a', 'https://e.com/b']);
});

test('robots.txt: the longest matching rule wins and wildcards work', () => {
  const r = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /*.json$\n');
  assert.equal(r.isAllowed('/about'), true);
  assert.equal(r.isAllowed('/private/x'), false);
  assert.equal(r.isAllowed('/private/public/x'), true);
  assert.equal(r.isAllowed('/data.json'), false);
  assert.equal(r.isAllowed('/data.jsonx'), true);
  assert.equal(parseRobots('').isAllowed('/anything'), true);
});

test('robots.txt: a group naming this tool beats the * group', () => {
  const r = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: crawler-prerender\nAllow: /\n');
  assert.equal(r.isAllowed('/x'), true);
});

test('buildJob dedupes routes, drops other origins and applies include and exclude', async () => {
  const dir = resolve('tests');
  const fakeFetch = async () => new Response('User-agent: *\nDisallow: /nope\n');
  const job = await buildJob(
    { url: 'https://e.com/', routesFile: join(dir, 'fixture', 'routes.txt'), exclude: '^/skip', crawl: true },
    { fetchImpl: fakeFetch },
  );
  const routes = job.seeds.map(routeKey);
  assert.deepEqual(routes.sort(), ['/', '/about', '/keep']);
  assert.ok(job.notes.some((n) => /other origins/.test(n)));
  assert.equal(job.acceptLink('https://e.com/nope'), false, 'robots.txt applies to discovered links');
  assert.equal(job.acceptLink('https://e.com/ok'), true);
  assert.equal(job.acceptLink('https://other.com/ok'), false);
  assert.equal(job.acceptLink('https://e.com/file.pdf'), false);
  assert.equal(job.acceptLink('https://e.com/skip/me'), false);
});

test('runFrontier respects depth, page limit and visits each route once', async () => {
  const graph = { '/': ['/a', '/b'], '/a': ['/c', '/'], '/b': ['/c'], '/c': ['/d'], '/d': [] };
  const make = (over) => ({
    seeds: ['https://e.com/'],
    crawl: true,
    maxDepth: 2,
    maxPages: 100,
    acceptLink: () => true,
    ...over,
  });
  const run = async (job) => {
    const visited = [];
    await runFrontier(job, {
      concurrency: 2,
      worker: async ({ url }) => {
        const key = routeKey(url);
        visited.push(key);
        return { links: (graph[key] || []).map((p) => `https://e.com${p}`) };
      },
    });
    return visited.sort();
  };
  assert.deepEqual(await run(make({})), ['/', '/a', '/b', '/c'], 'depth 2 stops before /d');
  assert.deepEqual(await run(make({ maxDepth: 0 })), ['/']);
  assert.equal((await run(make({ maxPages: 2 }))).length, 2);
});
