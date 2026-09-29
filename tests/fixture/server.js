import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createSnapshotMiddleware } from '../../src/serve.js';

const APP_JS = readFileSync(new URL('./app.js', import.meta.url));

const SHELL = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Fixture Shop</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="/">
</head>
<body>
<div id="app"></div>
<script src="/app.js"></script>
</body>
</html>
`;

const SSR = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Server rendered | Fixture Shop</title>
<meta name="description" content="A page that is fully server rendered.">
<link rel="canonical" href="/ssr">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","name":"Server rendered"}</script>
</head>
<body>
<header><nav><a href="/">Home</a> <a href="/about">About</a> <a href="/products/widget">Widget</a></nav></header>
<main>
<h1>Server rendered</h1>
<p>This page arrives complete. A crawler that never runs JavaScript sees the same words a browser shows, which makes it the control case for every check in the test suite.</p>
<p>It has a heading, a paragraph of respectable length, three links and one JSON-LD block, all present in the first response.</p>
</main>
<footer><small>Fixture footer</small></footer>
</body>
</html>
`;

// Two chunks, like React streaming a Suspense boundary: a placeholder first, the real
// content later inside a hidden div, plus an inline script that swaps them.
const STREAM_HEAD = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Streamed | Fixture Shop</title>
<meta name="description" content="A streamed page.">
<link rel="canonical" href="/streamed">
</head>
<body>
<header><a href="/">Home</a></header>
<main><div id="B:0">Loading...</div></main>
<footer><h2>Footer Wordmark</h2></footer>
`;
const STREAM_TAIL = `<div hidden id="S:0"><h1>Streamed heading</h1><p>This is the real page content. It reached the browser in a later chunk, sat inside a hidden container after the footer, and only became visible when an inline script moved it into place.</p><p>A reader that does not run scripts sees a loading placeholder and a footer wordmark instead of this.</p></div><script>$RC=function(b,c){var a=document.getElementById(b),d=document.getElementById(c);a.replaceChildren.apply(a,d.childNodes);d.remove()};$RC("B:0","S:0")</script>
</body>
</html>
`;

const sitemap = (base) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${['/', '/about', '/products/widget', '/streamed', '/ssr'].map((p) => `  <url><loc>${base}${p}</loc></url>`).join('\n')}
  <url><loc>https://elsewhere.example/other</loc></url>
</urlset>
`;
const sitemapIndex = (base) => `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${base}/sitemap.xml</loc></sitemap>
</sitemapindex>
`;

const SPA_ROUTES = new Set(['/', '/about', '/about/team', '/products/widget', '/private/secret']);

/**
 * Start the fixture site on a random port.
 * With `snapshotDir` the snapshot middleware sits in front, like a real deployment.
 */
export async function startFixture({ snapshotDir, port: wantPort = 0 } = {}) {
  const seen = [];
  const app = (req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const send = (status, type, body, extra = {}) => {
      res.writeHead(status, { 'content-type': type, ...extra });
      res.end(body);
    };
    if (path === '/app.js') return send(200, 'text/javascript', APP_JS);
    if (path === '/api/content.json') return send(200, 'application/json', '{"ok":true}');
    if (path === '/robots.txt') return send(200, 'text/plain', 'User-agent: *\nDisallow: /private\n');
    if (path === '/sitemap.xml') return send(200, 'application/xml', sitemap(`http://${req.headers.host}`));
    if (path === '/sitemap-index.xml') return send(200, 'application/xml', sitemapIndex(`http://${req.headers.host}`));
    if (path === '/file.pdf') return send(200, 'application/pdf', '%PDF-1.4');
    if (path === '/ssr') return send(200, 'text/html; charset=utf-8', SSR);
    if (path === '/gone') return send(404, 'text/html', '<!doctype html><title>Gone</title><p>This page is gone.</p>');
    if (path === '/redirect-me') return send(302, 'text/plain', '', { location: '/about' });
    if (path === '/streamed') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.write(STREAM_HEAD);
      setTimeout(() => res.end(STREAM_TAIL), 150);
      return undefined;
    }
    if (SPA_ROUTES.has(path)) return send(200, 'text/html; charset=utf-8', SHELL);
    // SPA fallback for unknown routes, like many static hosts: the shell with a 200.
    return send(200, 'text/html; charset=utf-8', SHELL);
  };

  const mw = snapshotDir ? createSnapshotMiddleware({ dir: snapshotDir }) : null;
  const server = createServer((req, res) => {
    seen.push({ path: req.url, ua: req.headers['user-agent'] || '' });
    if (mw) return mw(req, res, () => app(req, res));
    return app(req, res);
  });
  await new Promise((r) => server.listen(wantPort, '127.0.0.1', r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    seen,
    close: () => new Promise((r) => server.close(r)),
  };
}
