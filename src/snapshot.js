import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { defaultUserAgent, launchBrowser } from './browser.js';
import { buildJob, runFrontier } from './job.js';
import { newRenderContext, renderUrl } from './render.js';
import { routeKey, routeToFile } from './routes.js';
import { VERSION } from './version.js';

const MANIFEST = 'manifest.json';

async function loadManifest(outDir) {
  try {
    const m = JSON.parse(await readFile(join(outDir, MANIFEST), 'utf8'));
    return new Map((m.routes || []).map((r) => [r.route, r]));
  } catch {
    return new Map();
  }
}

async function saveManifest(outDir, base, entries) {
  const routes = [...entries.values()].sort((a, b) => a.route.localeCompare(b.route));
  const body = {
    tool: 'crawler-prerender',
    version: VERSION,
    base,
    updatedAt: new Date().toISOString(),
    routes,
  };
  const tmp = join(outDir, `${MANIFEST}.tmp`);
  await writeFile(tmp, JSON.stringify(body, null, 2) + '\n');
  await rename(tmp, join(outDir, MANIFEST));
}

const kb = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

/**
 * Render routes with a local browser and write out/<route>/index.html plus manifest.json.
 * Safe to run again: routes already saved are skipped unless `force` is set.
 */
export async function snapshot(options = {}, { log = () => {} } = {}) {
  const opts = {
    out: 'out',
    concurrency: 2,
    delay: 250,
    timeout: 30000,
    settle: 500,
    ...options,
  };
  const outDir = opts.out;
  opts.crawl = opts.crawl ?? !(opts.sitemap || opts.routesFile);

  const job = await buildJob(opts, { log });
  for (const n of job.notes) log(`note: ${n}`);
  if (job.seeds.length === 0) throw new Error('No routes to snapshot. Check the URL, sitemap or routes file.');

  await mkdir(outDir, { recursive: true });
  const entries = await loadManifest(outDir);
  const browser = await launchBrowser({ executablePath: opts.browserPath });
  const stats = { rendered: 0, skipped: 0, failed: 0, redirected: 0, bytes: 0 };

  try {
    const context = await newRenderContext(browser, {
      userAgent: opts.userAgent || defaultUserAgent(browser, VERSION),
      loadAssets: opts.loadAssets,
    });

    const worker = async ({ url, key }) => {
      const prev = entries.get(key);
      if (!opts.force && prev && prev.ok && prev.file && existsSync(join(outDir, prev.file))) {
        stats.skipped++;
        log(`skip  ${key}  (already saved)`);
        return { links: (prev.links || []).map((p) => new URL(p, job.origin).href) };
      }

      const r = await renderUrl(context, url, {
        timeout: opts.timeout,
        waitFor: opts.waitFor,
        settle: opts.settle,
        stripScripts: !opts.keepScripts,
        wantHtml: true,
        wantLinks: job.crawl,
      });

      const entry = {
        route: key,
        url,
        status: r.status,
        ok: false,
        file: null,
        bytes: 0,
        title: r.title ?? null,
        jsonLdBlocks: r.jsonLdBlocks ?? 0,
        renderMs: r.renderMs,
        renderedAt: new Date().toISOString(),
      };
      if (r.warnings?.length) entry.warnings = r.warnings;

      const landed = r.finalUrl ? routeKey(r.finalUrl) : key;
      if (r.error) {
        entry.error = r.error;
        stats.failed++;
        log(`FAIL  ${key}  ${r.error}`);
      } else if (!r.ok) {
        entry.error = `HTTP ${r.status}`;
        stats.failed++;
        log(`FAIL  ${key}  HTTP ${r.status}`);
      } else if (landed !== key) {
        entry.error = `redirected to ${landed}, not saved`;
        entry.redirectedTo = landed;
        stats.redirected++;
        log(`skip  ${key}  redirected to ${landed}`);
      } else {
        const banner = `<!-- crawler-prerender ${VERSION}: snapshot of ${url} taken ${entry.renderedAt} -->\n`;
        const html = r.html.replace(/^(<!doctype[^>]*>\s*)?/i, (m) => `${m}${banner}`);
        const file = routeToFile(outDir, key);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, html);
        entry.ok = true;
        entry.file = relative(outDir, file).split('\\').join('/');
        entry.bytes = Buffer.byteLength(html);
        stats.rendered++;
        stats.bytes += entry.bytes;
        log(`ok    ${key}  ${r.status}  ${kb(entry.bytes)}  ${r.renderMs} ms${r.warnings?.length ? '  (' + r.warnings[0] + ')' : ''}`);
      }

      if (job.crawl && r.links && entry.ok) {
        entry.links = [
          ...new Set(
            r.links
              .map((l) => {
                try {
                  const u = new URL(l);
                  return u.origin === job.origin ? routeKey(u.href) : null;
                } catch {
                  return null;
                }
              })
              .filter(Boolean),
          ),
        ];
      }
      entries.set(key, entry);
      await saveManifest(outDir, job.origin, entries);
      return { links: r.links || [] };
    };

    const frontier = await runFrontier(job, { concurrency: opts.concurrency, delayMs: opts.delay, worker });
    await saveManifest(outDir, job.origin, entries);
    return { ...stats, visited: frontier.visited, capped: frontier.capped, outDir, manifest: join(outDir, MANIFEST) };
  } finally {
    await browser.close();
  }
}
