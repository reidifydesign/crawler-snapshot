import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { check, formatCheckTable } from '../src/check.js';
import { snapshot } from '../src/snapshot.js';
import { startFixture } from './fixture/server.js';
import { browserSkip, tmp } from './helpers.js';

const skip = browserSkip();

describe('check against the plain fixture site', { skip }, () => {
  let fx;
  let report;
  const row = (route) => report.routes.find((r) => r.route === route);
  const codes = (route) => row(route).issues.map((i) => i.code);

  before(async () => {
    fx = await startFixture();
    report = await check({ url: fx.url, crawl: true, delay: 0 });
  });
  after(() => fx.close());

  test('sends the crawler user agent on the raw request and a browser user agent on the render', () => {
    const rawHit = fx.seen.find((s) => s.path === '/about' && /GPTBot/.test(s.ua));
    const browserHit = fx.seen.find((s) => s.path === '/about' && /Chrome\/.*crawler-snapshot/.test(s.ua));
    assert.ok(rawHit, 'a GPTBot request for /about');
    assert.ok(browserHit, 'a browser request for /about');
    assert.equal(report.crawler.name, 'GPTBot');
  });

  test('a client-rendered page fails: no text, h1, links or JSON-LD in the raw HTML', () => {
    assert.equal(row('/').verdict, 'FAIL');
    for (const c of ['content-js-only', 'h1-js-only', 'jsonld-js-only', 'links-js-only']) assert.ok(codes('/').includes(c), c);
    assert.equal(row('/').raw.textLength, 0);
    assert.ok(row('/').rendered.textLength > 400);
  });

  test('head tags that only JavaScript sets are reported', () => {
    for (const c of ['title-differs', 'meta-description-js-only', 'canonical-differs']) assert.ok(codes('/about').includes(c), c);
  });

  test('the server-rendered control page is clean', () => {
    assert.equal(row('/ssr').verdict, 'OK');
    assert.deepEqual(row('/ssr').issues, []);
    assert.equal(row('/ssr').raw.textLength, row('/ssr').rendered.textLength);
  });

  test('a streamed page with content in a hidden chunk is flagged, with the markers named', () => {
    const r = row('/streamed');
    assert.equal(r.verdict, 'FAIL');
    assert.ok(codes('/streamed').includes('hidden-streamed-content'));
    assert.ok(codes('/streamed').includes('h1-js-only'));
    const h = r.issues.find((i) => i.code === 'hidden-streamed-content');
    assert.match(h.message, /S:0/);
    assert.match(h.message, /\$RC/);
    assert.ok(r.raw.hiddenChars > 250);
    assert.ok(r.raw.streamMarkers.length >= 2);
  });

  test('content that arrives late is included in the rendered side', () => {
    assert.ok(row('/products/widget').rendered.headings.some((h) => h.text === 'Reviews'));
  });

  test('a 404 route is an ERROR, a redirect is warned about', () => {
    assert.equal(row('/gone').verdict, 'ERROR');
    assert.ok(codes('/redirect-me').includes('redirects'));
  });

  test('summary counts add up', () => {
    const s = report.summary;
    assert.equal(s.ok + s.warn + s.fail, s.routes);
    assert.equal(s.ok, 1);
  });

  test('the terminal table has every route and the verdicts', () => {
    const out = formatCheckTable(report);
    assert.match(out, /ROUTE\s+RAW TEXT\s+RENDERED\s+SEEN/);
    assert.match(out, /\/ssr\s+\d+\s+\d+\s+100%.*OK/);
    assert.match(out, /\/streamed.*FAIL/);
    assert.match(out, /route\(s\): 1 ok/);
  });

  test('the report is JSON serialisable and carries the crawler used', () => {
    const round = JSON.parse(JSON.stringify(report));
    assert.equal(round.tool, 'crawler-snapshot');
    assert.equal(round.crawler.userAgent.includes('GPTBot'), true);
    assert.ok(round.routes.every((r) => typeof r.verdict === 'string' && Array.isArray(r.issues)));
  });
});

describe('the whole loop: snapshot, serve, check again', { skip }, () => {
  let site;
  let dir;
  before(async () => {
    dir = tmp('loop-');
    // The site serves snapshots from `dir` as they appear, like a real deployment. The
    // snapshot is taken from the same origin it is served on, so absolute canonical URLs match.
    site = await startFixture({ snapshotDir: dir });
    await snapshot({ url: site.url, out: dir, delay: 0, depth: 1 });
  });
  after(async () => {
    await site.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('after the snapshot is served to crawlers, the routes that failed now pass', async () => {
    const report = await check({ url: site.url, sitemap: `${site.url}/sitemap.xml`, delay: 0 });
    const find = (route) => report.routes.find((r) => r.route === route);
    for (const route of ['/', '/about', '/products/widget', '/streamed', '/ssr']) {
      assert.equal(find(route).verdict, 'OK', `${route}: ${JSON.stringify(find(route).issues)}`);
    }
    assert.equal(report.summary.fail, 0);
    assert.ok(site.seen.some((s) => s.path === '/streamed' && /GPTBot/.test(s.ua)));
  });
});
