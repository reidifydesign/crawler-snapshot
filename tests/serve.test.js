import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp as createExpress } from '../examples/express.mjs';
import { createApp as createNodeApp } from '../examples/node-http.mjs';
import edge from '../examples/netlify-edge-function.js';
import { appendVary, createSnapshotMiddleware, findSnapshot } from '../src/serve.js';
import { get, tmp, writeSnapshot } from './helpers.js';

const GPT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let root;
let snaps;
let appDir;

before(() => {
  root = tmp('serve-');
  snaps = join(root, 'snaps');
  appDir = join(root, 'app');
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, 'index.html'), '<!doctype html><div id="root">APP SHELL</div>');
  writeFileSync(join(appDir, 'main.js'), 'console.log("app")');
  writeSnapshot(snaps, '/', '<h1>Home snapshot</h1>');
  writeSnapshot(snaps, '/about', '<h1>About snapshot</h1>');
  writeSnapshot(snaps, '/a/b', '<h1>Deep snapshot</h1>');
});
after(() => rmSync(root, { recursive: true, force: true }));

/** The same behaviour is expected from every server flavour. */
function behaves(name, start) {
  describe(name, () => {
    let srv;
    before(async () => {
      srv = await start();
    });
    after(() => srv.close());

    test('crawler gets the snapshot, with Vary: User-Agent and a marker header', async () => {
      const r = await get(`${srv.url}/about`, GPT);
      assert.equal(r.status, 200);
      assert.match(r.text, /About snapshot/);
      assert.match(r.headers.get('vary'), /User-Agent/i);
      assert.equal(r.headers.get('x-prerender'), 'snapshot');
      assert.match(r.headers.get('content-type'), /text\/html/);
    });

    test('the root and a nested route resolve, with or without a trailing slash and a query', async () => {
      assert.match((await get(`${srv.url}/`, GPT)).text, /Home snapshot/);
      assert.match((await get(`${srv.url}/a/b/`, GPT)).text, /Deep snapshot/);
      assert.match((await get(`${srv.url}/about?utm=x`, GPT)).text, /About snapshot/);
    });

    test('a browser gets the normal app, and the response still says Vary: User-Agent', async () => {
      const r = await get(`${srv.url}/about`, CHROME);
      assert.match(r.text, /APP SHELL/);
      assert.match(r.headers.get('vary') || '', /User-Agent/i);
      assert.equal(r.headers.get('x-prerender'), null);
    });

    test('a crawler asking for a route with no snapshot falls through to the app', async () => {
      const r = await get(`${srv.url}/not-snapshotted`, GPT);
      assert.match(r.text, /APP SHELL/);
    });

    test('asset requests are never answered with a snapshot', async () => {
      const r = await get(`${srv.url}/main.js`, GPT);
      assert.match(r.text, /console\.log/);
    });

    test('a request without a User-Agent gets the app', async () => {
      assert.match((await get(`${srv.url}/about`)).text, /APP SHELL/);
    });
  });
}

const listen = async (server) => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
};

behaves('plain Node http middleware', async () => {
  const mw = createSnapshotMiddleware({ dir: snaps });
  const app = (req, res) => {
    const f = req.url.endsWith('main.js') ? 'console.log("app")' : '<!doctype html><div id="root">APP SHELL</div>';
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(f);
  };
  return listen(createServer((req, res) => mw(req, res, () => app(req, res))));
});

behaves('examples/node-http.mjs', async () => listen(createNodeApp({ snapshotDir: snaps, appDir })));

behaves('examples/express.mjs (real Express 4)', async () => {
  const server = createServer(createExpress({ snapshotDir: snaps, appDir }));
  return listen(server);
});

describe('middleware details', () => {
  test('only GET and HEAD are considered', async () => {
    const mw = createSnapshotMiddleware({ dir: snaps });
    let passed = false;
    await mw({ method: 'POST', url: '/about', headers: { 'user-agent': GPT } }, {}, () => {
      passed = true;
    });
    assert.equal(passed, true);
  });

  test('HEAD returns headers and no body', async () => {
    const srv = await listen(createServer((req, res) => createSnapshotMiddleware({ dir: snaps })(req, res, () => res.end('APP'))));
    try {
      const res = await fetch(`${srv.url}/about`, { method: 'HEAD', headers: { 'user-agent': GPT } });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-prerender'), 'snapshot');
      assert.equal(await res.text(), '');
    } finally {
      await srv.close();
    }
  });

  test('extra user agents can be served', async () => {
    const mw = createSnapshotMiddleware({ dir: snaps, userAgents: ['AcmeBot'] });
    const srv = await listen(createServer((req, res) => mw(req, res, () => res.end('APP'))));
    try {
      assert.match((await get(`${srv.url}/about`, 'AcmeBot/2')).text, /About snapshot/);
    } finally {
      await srv.close();
    }
  });

  test('appendVary keeps an existing Vary value and does not repeat itself', () => {
    const headers = { Vary: 'Accept-Encoding' };
    const res = { getHeader: (k) => headers[k], setHeader: (k, v) => (headers[k] = v) };
    appendVary(res, 'User-Agent');
    appendVary(res, 'User-Agent');
    assert.equal(headers.Vary, 'Accept-Encoding, User-Agent');
  });

  test('findSnapshot refuses to leave the snapshot directory', () => {
    assert.equal(findSnapshot(snaps, '/../../etc/passwd'), null);
    assert.equal(findSnapshot(snaps, '/%2e%2e/%2e%2e/x'), null);
    assert.ok(findSnapshot(snaps, '/about'));
  });
});

describe('examples/netlify-edge-function.js', () => {
  let site;
  before(async () => {
    // A stand-in for the published site: it holds /_snapshots and, like a host with an SPA
    // fallback rule, answers a missing file with the app shell and a 200.
    site = await listen(
      createServer((req, res) => {
        const f = findSnapshot(snaps, req.url.replace(/^\/_snapshots/, '').replace(/\/index\.html$/, '') || '/');
        res.writeHead(200, { 'content-type': 'text/html' });
        if (req.url.startsWith('/_snapshots') && f) return res.end(readFileSync(f, 'utf8'));
        return res.end('<!doctype html><div id="root">SPA FALLBACK SHELL</div>');
      }),
    );
  });
  after(() => site.close());

  const context = { next: async () => new Response('<div id="root">APP SHELL</div>', { headers: { 'content-type': 'text/html' } }) };
  const call = (path, ua, method = 'GET') => edge(new Request(`${site.url}${path}`, { method, headers: { 'user-agent': ua } }), context);

  test('a crawler gets the snapshot', async () => {
    const res = await call('/about', GPT);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /About snapshot/);
    assert.match(res.headers.get('vary'), /User-Agent/i);
  });

  test('a browser passes through to the site and gets Vary appended', async () => {
    const res = await call('/about', CHROME);
    assert.match(await res.text(), /APP SHELL/);
    assert.match(res.headers.get('vary'), /User-Agent/i);
  });

  test('a crawler on a route with no snapshot is not handed the SPA fallback as if it were a snapshot', async () => {
    const res = await call('/not-snapshotted', GPT);
    assert.match(await res.text(), /APP SHELL/);
  });

  test('assets and non-GET requests are left alone', async () => {
    assert.equal(await call('/main.js', GPT), undefined);
    assert.equal(await call('/about', GPT, 'POST'), undefined);
  });
});
