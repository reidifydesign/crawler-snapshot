import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { findBrowser } from '../src/browser.js';
import { snapshot } from '../src/snapshot.js';
import { startFixture } from './fixture/server.js';
import { browserSkip, tmp } from './helpers.js';

const skip = browserSkip();

test('findBrowser honours CHROME_PATH and refuses a wrong one', () => {
  const here = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  assert.equal(findBrowser({ CHROME_PATH: here }, 'linux', () => true), here);
  assert.throws(() => findBrowser({ CHROME_PATH: '/nope/chrome' }, 'linux', () => false), /CHROME_PATH/);
  assert.equal(findBrowser({ PATH: '' }, 'linux', () => false), null);
});

describe('snapshot', { skip }, () => {
  let fx;
  let out;
  let result;
  const manifest = () => JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  const entry = (route) => manifest().routes.find((r) => r.route === route);
  const html = (rel) => readFileSync(join(out, rel), 'utf8');

  before(async () => {
    fx = await startFixture();
    out = tmp('snap-');
    result = await snapshot({ url: fx.url, out, delay: 0 });
  });
  after(async () => {
    await fx.close();
    rmSync(out, { recursive: true, force: true });
  });

  test('writes out/<route>/index.html with the JavaScript-rendered DOM', () => {
    assert.ok(existsSync(join(out, 'index.html')));
    assert.ok(existsSync(join(out, 'about', 'index.html')));
    assert.ok(existsSync(join(out, 'products', 'widget', 'index.html')));
    const home = html('index.html');
    assert.match(home, /<h1>Fixture Shop<\/h1>/);
    assert.match(home, /Every sentence on this page is added by JavaScript/);
  });

  test('keeps client-injected JSON-LD, title, description and canonical', () => {
    const home = html('index.html');
    assert.match(home, /<script type="application\/ld\+json">\{"@context":"https:\/\/schema.org","@type":"Organization"/);
    assert.match(home, /<title>Fixture Shop \| Home<\/title>/);
    assert.match(home, /<meta name="description" content="A fixture shop used to test crawler-snapshot.">/);
    assert.match(home, /<link rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/">/);
  });

  test('removes application scripts by default', () => {
    for (const f of ['index.html', 'about/index.html', 'streamed/index.html']) {
      assert.doesNotMatch(html(f), /<script(?![^>]*ld\+json)/i, f);
    }
  });

  test('waits for content that arrives after the network goes quiet', () => {
    assert.match(html('products/widget/index.html'), /This paragraph arrives late on purpose/);
  });

  test('captures a streamed Suspense-style route with its content in place', () => {
    const s = html('streamed/index.html');
    assert.match(s, /<h1>Streamed heading<\/h1>/);
    assert.doesNotMatch(s, /<[^>]*\shidden[\s>=]/, 'no hidden container left');
    assert.doesNotMatch(s, /Loading\.\.\./);
  });

  test('follows same-origin links, skips files and robots.txt disallows', () => {
    assert.ok(existsSync(join(out, 'about', 'team', 'index.html')), 'depth 2 page');
    assert.ok(!existsSync(join(out, 'private')), 'robots.txt disallowed /private');
    assert.ok(!fx.seen.some((s) => s.path === '/file.pdf'), 'non-page files are not visited');
    assert.ok(!fx.seen.some((s) => s.path.startsWith('/private')), '/private was never requested');
  });

  test('does not save error pages or redirects, and records why', () => {
    assert.ok(!existsSync(join(out, 'gone')));
    assert.ok(!existsSync(join(out, 'redirect-me')));
    assert.equal(entry('/gone').ok, false);
    assert.equal(entry('/gone').status, 404);
    assert.equal(entry('/redirect-me').redirectedTo, '/about');
  });

  test('manifest records route, status, bytes, title, JSON-LD count and render time', () => {
    const m = manifest();
    assert.equal(m.tool, 'crawler-snapshot');
    const home = entry('/');
    assert.equal(home.status, 200);
    assert.equal(home.ok, true);
    assert.equal(home.file, 'index.html');
    assert.equal(home.bytes, statSync(join(out, 'index.html')).size);
    assert.equal(home.title, 'Fixture Shop | Home');
    assert.equal(home.jsonLdBlocks, 1);
    assert.ok(home.renderMs > 0);
    assert.equal(entry('/ssr').jsonLdBlocks, 1);
    assert.equal(entry('/about/team').jsonLdBlocks, 0);
  });

  test('is resumable: a second run renders nothing that is already saved', async () => {
    const before = readFileSync(join(out, 'index.html'), 'utf8');
    const again = await snapshot({ url: fx.url, out, delay: 0 });
    assert.equal(again.rendered, 0);
    assert.ok(again.skipped >= 6);
    assert.equal(readFileSync(join(out, 'index.html'), 'utf8'), before);
  });

  test('--force renders again', async () => {
    const r = await snapshot({ url: fx.url, out, delay: 0, force: true, crawl: false });
    assert.equal(r.rendered, 1);
    assert.equal(r.skipped, 0);
  });

  test('first run counted its pages', () => {
    assert.equal(result.rendered, 6);
    assert.equal(result.redirected, 1);
    assert.equal(result.failed, 1);
  });

  test('a sitemap drives the run, and other origins in it are ignored', async () => {
    const dir = tmp('snap-map-');
    try {
      const r = await snapshot({ sitemap: `${fx.url}/sitemap.xml`, out: dir, delay: 0 });
      assert.equal(r.rendered, 5);
      assert.ok(existsSync(join(dir, 'ssr', 'index.html')));
      assert.ok(!existsSync(join(dir, 'about', 'team')), 'no crawling when a sitemap is given');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a sitemap index is followed', async () => {
    const dir = tmp('snap-idx-');
    try {
      const r = await snapshot({ sitemap: `${fx.url}/sitemap-index.xml`, out: dir, delay: 0, include: '^/(ssr|about)$' });
      assert.equal(r.rendered, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--wait-for fails a route whose selector never appears, and does not save it', async () => {
    const dir = tmp('snap-wait-');
    try {
      const r = await snapshot({ url: `${fx.url}/ssr`, out: dir, delay: 0, crawl: false, waitFor: '#never-here', timeout: 2500 });
      assert.equal(r.rendered, 0);
      assert.equal(r.failed, 1);
      assert.ok(!existsSync(join(dir, 'ssr')));
      const e = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).routes[0];
      assert.match(e.error, /#never-here/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--keep-scripts leaves the application script in the file', async () => {
    const dir = tmp('snap-keep-');
    try {
      await snapshot({ url: `${fx.url}/about`, out: dir, delay: 0, crawl: false, keepScripts: true });
      assert.match(readFileSync(join(dir, 'about', 'index.html'), 'utf8'), /<script src="\/app\.js">/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a depth-1 crawl stops before the depth-2 page', async () => {
    const dir = tmp('snap-depth-');
    try {
      await snapshot({ url: fx.url, out: dir, delay: 0, depth: 1 });
      assert.ok(existsSync(join(dir, 'about', 'index.html')));
      assert.ok(!existsSync(join(dir, 'about', 'team')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--max-pages caps the run', async () => {
    const dir = tmp('snap-max-');
    try {
      const r = await snapshot({ url: fx.url, out: dir, delay: 0, maxPages: 2 });
      assert.equal(r.visited, 2);
      assert.equal(r.capped, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
