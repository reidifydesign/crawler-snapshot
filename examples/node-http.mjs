// Plain Node http server. Crawlers get the snapshot, everyone else gets the app.
//
//   crawler-snapshot snapshot https://your-site.example --out out
//   SNAPSHOT_DIR=out APP_DIR=dist node examples/node-http.mjs
//
// Every page response carries "Vary: User-Agent", so a cache in front never hands a
// snapshot to a person or the app to a bot.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createSnapshotMiddleware } from 'crawler-snapshot/serve';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

/** Serve the normal single page app: a real file if there is one, otherwise index.html. */
function spa(appDir) {
  return (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = join(appDir, normalize(pathname).replace(/^(\.\.[\\/])+/, ''));
    if (!existsSync(file) || !statSync(file).isFile()) file = join(appDir, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  };
}

export function createApp({ snapshotDir = 'out', appDir = 'dist' } = {}) {
  const snapshots = createSnapshotMiddleware({ dir: snapshotDir });
  const app = spa(appDir);
  return createServer((req, res) => snapshots(req, res, () => app(req, res)));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const port = Number(process.env.PORT || 3000);
  createApp({ snapshotDir: process.env.SNAPSHOT_DIR, appDir: process.env.APP_DIR }).listen(port, () =>
    console.log(`listening on http://localhost:${port}`),
  );
}
