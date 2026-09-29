import { defaultUserAgent, launchBrowser } from './browser.js';
import { userAgentFor } from './agents.js';
import { analyze } from './analyze.js';
import { fetchRaw } from './fetchRaw.js';
import { buildJob, runFrontier } from './job.js';
import { measureRawHtml, newRawContext, newRenderContext, renderUrl } from './render.js';
import { routeKey } from './routes.js';
import { streamMarkers } from './signals.js';
import { renderTable } from './table.js';
import { VERSION } from './version.js';

const brief = (s) => ({
  title: s.title,
  metaDescription: s.metaDescription,
  canonical: s.canonical,
  robotsMeta: s.robotsMeta,
  textLength: s.textLength,
  wordCount: s.wordCount,
  headings: s.headings,
  linkCount: s.linkCount,
  jsonLd: s.jsonLd,
  hiddenChars: s.hiddenChars,
});

/**
 * For each route: fetch the raw HTML as a crawler (no JavaScript), render the same URL in
 * a browser, and compare. Returns a report object; see `formatCheckTable` for the terminal view.
 */
export async function check(options = {}, { log = () => {} } = {}) {
  const opts = { concurrency: 2, delay: 250, timeout: 30000, settle: 500, as: 'GPTBot', ...options };
  opts.crawl = opts.crawl ?? false;

  const agent = opts.ua ? { ua: opts.ua, documented: true, known: false } : userAgentFor(opts.as);
  const crawlerName = opts.ua ? 'custom' : opts.as;

  const job = await buildJob(opts, { log });
  for (const n of job.notes) log(`note: ${n}`);
  if (job.seeds.length === 0) throw new Error('No routes to check.');

  const browser = await launchBrowser({ executablePath: opts.browserPath });
  const results = [];
  try {
    const renderCtx = await newRenderContext(browser, {
      userAgent: defaultUserAgent(browser, VERSION),
      loadAssets: opts.loadAssets,
    });
    const rawCtx = await newRawContext(browser);

    const worker = async ({ url, key }) => {
      const raw = await fetchRaw(url, { userAgent: agent.ua, timeout: opts.timeout });
      const r = await renderUrl(renderCtx, url, {
        timeout: opts.timeout,
        waitFor: opts.waitFor,
        settle: opts.settle,
        wantSignals: true,
        wantLinks: job.crawl,
      });

      const row = { route: key, url, renderMs: r.renderMs };
      if (r.error || !r.ok) {
        row.verdict = 'ERROR';
        row.issues = [{ severity: 'FAIL', code: 'render-failed', message: r.error || `The browser got HTTP ${r.status}.` }];
        row.raw = raw.ok ? { status: raw.status, bytes: raw.bytes, contentType: raw.contentType } : { error: raw.error };
      } else {
        const rawSig = raw.ok && /html|xml/i.test(raw.contentType) ? await measureRawHtml(rawCtx, raw.html) : null;
        const markers = raw.ok ? streamMarkers(raw.html) : [];
        const a = analyze({ raw, rawSig, markers, rendered: r.signals, url });
        row.verdict = a.verdict;
        row.issues = a.issues;
        row.textRatio = a.textRatio;
        row.raw = raw.ok
          ? { status: raw.status, bytes: raw.bytes, contentType: raw.contentType, vary: raw.vary, streamMarkers: markers, ...(rawSig ? brief(rawSig) : {}) }
          : { error: raw.error };
        row.rendered = { status: r.status, ...brief(r.signals) };
        const landed = r.finalUrl ? routeKey(r.finalUrl) : key;
        if (landed !== key) {
          row.issues.push({ severity: 'WARN', code: 'redirects', message: `This route ends up at ${landed}. Check the crawler-facing URL is the one you want indexed.` });
          if (row.verdict === 'OK') row.verdict = 'WARN';
        }
      }
      results.push(row);
      log(`${row.verdict.padEnd(5)} ${key}`);
      return { links: r.links || [] };
    };

    const frontier = await runFrontier(job, { concurrency: opts.concurrency, delayMs: opts.delay, worker });
    results.sort((a, b) => a.route.localeCompare(b.route));

    // Site level: a raw <title> shared by several routes whose rendered titles differ.
    const rawTitles = results.filter((r) => r.raw?.title && r.rendered?.title);
    if (rawTitles.length >= 3) {
      const counts = new Map();
      for (const r of rawTitles) counts.set(r.raw.title, (counts.get(r.raw.title) || 0) + 1);
      for (const r of rawTitles) {
        if (counts.get(r.raw.title) >= 3 && r.raw.title !== r.rendered.title && !r.issues.some((i) => i.code === 'title-differs')) {
          r.issues.push({ severity: 'WARN', code: 'title-shared-in-raw', message: `The crawler HTML gives ${counts.get(r.raw.title)} routes the same <title> ("${r.raw.title}").` });
          if (r.verdict === 'OK') r.verdict = 'WARN';
        }
      }
    }

    const count = (v) => results.filter((r) => r.verdict === v).length;
    return {
      tool: 'crawler-prerender',
      version: VERSION,
      generatedAt: new Date().toISOString(),
      base: job.origin,
      crawler: { name: crawlerName, userAgent: agent.ua, documentedString: agent.documented },
      capped: frontier.capped,
      summary: {
        routes: results.length,
        ok: count('OK'),
        warn: count('WARN'),
        fail: count('FAIL') + count('ERROR'),
      },
      routes: results,
    };
  } finally {
    await browser.close();
  }
}

/** The terminal view of a check report. */
export function formatCheckTable(report) {
  const rows = report.routes.map((r) => {
    const d = r.rendered;
    const w = r.raw;
    const ld = (s) => (s?.jsonLd ? s.jsonLd.filter((b) => b.valid).length : '-');
    return {
      route: r.route,
      raw: w && w.textLength != null ? w.textLength : w?.error ? 'error' : '-',
      rendered: d ? d.textLength : '-',
      seen: r.textRatio != null ? `${Math.round(r.textRatio * 100)}%` : '-',
      h1: d ? `${w?.headings ? w.headings.filter((h) => h.level === 1).length : '-'}/${d.headings.filter((h) => h.level === 1).length}` : '-',
      links: d ? `${w?.linkCount ?? '-'}/${d.linkCount}` : '-',
      ld: d ? `${ld(w)}/${ld(d)}` : '-',
      verdict: r.verdict,
    };
  });
  const table = renderTable(
    [
      { key: 'route', title: 'ROUTE', max: 38 },
      { key: 'raw', title: 'RAW TEXT', align: 'right' },
      { key: 'rendered', title: 'RENDERED', align: 'right' },
      { key: 'seen', title: 'SEEN', align: 'right' },
      { key: 'h1', title: 'H1', align: 'right' },
      { key: 'links', title: 'LINKS', align: 'right' },
      { key: 'ld', title: 'JSON-LD', align: 'right' },
      { key: 'verdict', title: 'VERDICT' },
    ],
    rows,
  );

  const lines = [
    `crawler-prerender check   ${report.base}`,
    `crawler request as ${report.crawler.name}${report.crawler.documentedString ? '' : ' (UA string not published by the vendor, so a generic one was used)'}`,
    '',
    table,
    '',
    'Columns: RAW TEXT and RENDERED are visible characters. SEEN is raw as a share of rendered.',
    'H1, LINKS and JSON-LD read raw/rendered.',
  ];

  const noisy = report.routes.filter((r) => r.issues.length);
  if (noisy.length) {
    lines.push('');
    for (const r of noisy) {
      lines.push(r.route);
      for (const i of r.issues) lines.push(`  ${i.severity}  ${i.code}: ${i.message}`);
    }
  }
  const s = report.summary;
  lines.push('', `${s.routes} route(s): ${s.ok} ok, ${s.warn} warn, ${s.fail} fail`);
  if (report.capped) lines.push('Stopped at --max-pages. Raise it to check more.');
  return lines.join('\n');
}
