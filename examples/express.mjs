// Express. Put the snapshot middleware before your static files and your SPA fallback.
//
//   npm install express crawler-prerender
//   crawler-prerender snapshot https://your-site.example --out out
//   node examples/express.mjs
import path from 'node:path';
import express from 'express';
import { createSnapshotMiddleware } from 'crawler-prerender/serve';

export function createApp({ snapshotDir = 'out', appDir = 'dist' } = {}) {
  const app = express();

  // Crawler user agents get out/<route>/index.html. Everyone else falls through.
  app.use(createSnapshotMiddleware({ dir: snapshotDir }));

  app.use(express.static(appDir));
  // Express 4 syntax. On Express 5 use app.get('/{*splat}', ...).
  app.get('*', (req, res) => res.sendFile(path.resolve(appDir, 'index.html')));
  return app;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const port = Number(process.env.PORT || 3000);
  createApp({ snapshotDir: process.env.SNAPSHOT_DIR, appDir: process.env.APP_DIR }).listen(port, () =>
    console.log(`listening on http://localhost:${port}`),
  );
}
