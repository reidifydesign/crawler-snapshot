import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { formatAgents, loadAgents, serveList } from './agents.js';
import { check, formatCheckTable } from './check.js';
import { snapshot } from './snapshot.js';
import { renderTable } from './table.js';
import { VERSION } from './version.js';

const HELP = `crawler-prerender ${VERSION}

Usage
  crawler-prerender check    <url> [options]   what crawlers see, against what a browser sees
  crawler-prerender snapshot <url> [options]   render routes with your own Chrome, save the HTML
  crawler-prerender agents   [--format table|regex|nginx|json|tokens]

Where the routes come from (check and snapshot)
  <url>                 a single page. snapshot follows same-origin links by default, check does not
  --sitemap <url>       read routes from a sitemap or sitemap index
  --routes <file>       one route or URL per line, or a JSON array
  --crawl               follow same-origin links in the rendered DOM
  --depth <n>           crawl depth, default 2
  --max-pages <n>       page limit, default 100 for a crawl and 1000 for a list
  --include <regex>     only paths that match
  --exclude <regex>     skip paths that match
  --ignore-robots       crawl without reading robots.txt

Rendering
  --wait-for <selector> also wait for this selector to appear
  --settle <ms>         wait until the DOM is quiet this long, default 500
  --timeout <ms>        per page, default 30000
  --concurrency <n>     pages at once, default 2
  --delay <ms>          pause after each page per worker, default 250
  --load-assets         load images, media and fonts (blocked by default)
  --user-agent <ua>     UA for the browser (default: Chrome plus a crawler-prerender suffix)

snapshot only
  --out <dir>           output directory, default out
  --force               render again even when a route is already saved
  --keep-scripts        keep <script> tags in the saved HTML (removed by default; JSON-LD is always kept)

check only
  --as <name>           crawler to imitate, default GPTBot (see: agents)
  --ua <string>         send this exact User-Agent instead
  --json <file>         also write the full report as JSON
  --fail-on <level>     fail (default), warn or never: when to exit with code 1

Browser
  Uses an existing Chrome, Edge or Chromium. Set CHROME_PATH to choose one.
  Nothing is downloaded. In a root container set CRAWLER_PRERENDER_NO_SANDBOX=1.
`;

const ROUTE_OPTS = {
  sitemap: { type: 'string' },
  routes: { type: 'string' },
  crawl: { type: 'boolean' },
  depth: { type: 'string' },
  'max-pages': { type: 'string' },
  include: { type: 'string' },
  exclude: { type: 'string' },
  'ignore-robots': { type: 'boolean' },
  'wait-for': { type: 'string' },
  settle: { type: 'string' },
  timeout: { type: 'string' },
  concurrency: { type: 'string' },
  delay: { type: 'string' },
  'load-assets': { type: 'boolean' },
  'user-agent': { type: 'string' },
};

const num = (v, name) => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} must be a non-negative number, got "${v}".`);
  return n;
};

function commonOptions(values, url) {
  return {
    url,
    sitemap: values.sitemap,
    routesFile: values.routes,
    crawl: values.crawl,
    depth: num(values.depth, 'depth'),
    maxPages: num(values['max-pages'], 'max-pages'),
    include: values.include,
    exclude: values.exclude,
    ignoreRobots: values['ignore-robots'],
    waitFor: values['wait-for'],
    settle: num(values.settle, 'settle'),
    timeout: num(values.timeout, 'timeout'),
    concurrency: num(values.concurrency, 'concurrency'),
    delay: num(values.delay, 'delay'),
    loadAssets: values['load-assets'],
    userAgent: values['user-agent'],
  };
}

const strip = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** Run the CLI. Returns the exit code. `io` lets tests capture output. */
export async function main(argv, io = { out: (s) => console.log(s), err: (s) => console.error(s) }) {
  const [cmd, ...rest] = argv;
  try {
    if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
      io.out(HELP);
      return cmd ? 0 : 1;
    }
    if (cmd === '--version' || cmd === '-v') {
      io.out(VERSION);
      return 0;
    }

    if (cmd === 'agents') {
      const { values } = parseArgs({
        args: rest,
        options: { format: { type: 'string', default: 'table' }, all: { type: 'boolean' } },
      });
      if (values.format !== 'table') {
        io.out(formatAgents(values.format));
        return 0;
      }
      const list = values.all ? loadAgents().agents : serveList();
      io.out(
        renderTable(
          [
            { key: 'name', title: 'TOKEN' },
            { key: 'operator', title: 'OPERATOR' },
            { key: 'kind', title: 'KIND' },
            { key: 'js', title: 'RUNS JS' },
            { key: 'verification', title: 'CHECKED' },
            { key: 'serve', title: 'SERVED' },
          ],
          list.map((a) => ({
            ...a,
            js: a.runsJavaScript || '',
            serve: a.serve ? 'yes' : 'no (control token)',
          })),
        ),
      );
      io.out('\nEach entry has a source URL in data/crawlers.json.');
      return 0;
    }

    if (cmd === 'snapshot') {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { ...ROUTE_OPTS, out: { type: 'string' }, force: { type: 'boolean' }, 'keep-scripts': { type: 'boolean' } },
      });
      const opts = strip({
        ...commonOptions(values, positionals[0]),
        out: values.out,
        force: values.force,
        keepScripts: values['keep-scripts'],
      });
      const r = await snapshot(opts, { log: (m) => io.err(m) });
      io.out(
        `\nSnapshot done: ${r.rendered} saved, ${r.skipped} skipped, ${r.redirected} redirected, ${r.failed} failed.\n` +
          `Files: ${r.outDir}\nManifest: ${r.manifest}` +
          (r.capped ? '\nStopped at --max-pages. Raise it to save more.' : ''),
      );
      return r.failed > 0 && r.rendered + r.skipped === 0 ? 1 : 0;
    }

    if (cmd === 'check') {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          ...ROUTE_OPTS,
          as: { type: 'string' },
          ua: { type: 'string' },
          json: { type: 'string' },
          'fail-on': { type: 'string', default: 'fail' },
        },
      });
      if (!['fail', 'warn', 'never'].includes(values['fail-on'])) {
        throw new Error('--fail-on must be fail, warn or never.');
      }
      const opts = strip({ ...commonOptions(values, positionals[0]), as: values.as, ua: values.ua });
      const report = await check(opts, { log: (m) => io.err(m) });
      io.out(formatCheckTable(report));
      if (values.json) {
        await writeFile(values.json, JSON.stringify(report, null, 2) + '\n');
        io.out(`\nJSON report: ${values.json}`);
      }
      const level = values['fail-on'];
      if (level === 'never') return 0;
      if (report.summary.fail > 0) return 1;
      if (level === 'warn' && report.summary.warn > 0) return 1;
      return 0;
    }

    io.err(`Unknown command "${cmd}".\n\n${HELP}`);
    return 2;
  } catch (e) {
    io.err(`error: ${e.message}`);
    return 2;
  }
}
