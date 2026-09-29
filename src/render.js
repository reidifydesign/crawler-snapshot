import { extractSignals } from './signals.js';

const BLOCKED_TYPES = new Set(['image', 'media', 'font']);

/** A browser context for rendering. Images, media and fonts are blocked unless loadAssets is set. */
export async function newRenderContext(browser, { userAgent, loadAssets = false } = {}) {
  const context = await browser.newContext({ userAgent, viewport: { width: 1280, height: 900 } });
  if (!loadAssets) {
    await context.route('**/*', (route) =>
      BLOCKED_TYPES.has(route.request().resourceType()) ? route.abort() : route.continue(),
    );
  }
  return context;
}

/** A context with JavaScript off, used to parse raw HTML exactly as a non-rendering reader would see it. */
export async function newRawContext(browser) {
  const context = await browser.newContext({ javaScriptEnabled: false });
  await context.route('**/*', (route) => route.abort());
  return context;
}

/** Measure raw HTML: parse it with JavaScript off and run the shared extractor. */
export async function measureRawHtml(rawContext, html) {
  const page = await rawContext.newPage();
  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    return await page.evaluate(extractSignals);
  } finally {
    await page.close();
  }
}

async function waitForDomToSettle(page, quietMs, maxMs) {
  await page.evaluate(
    ({ quietMs: q, maxMs: m }) =>
      new Promise((resolve) => {
        let timer;
        const finish = () => {
          obs.disconnect();
          clearTimeout(timer);
          clearTimeout(cap);
          resolve();
        };
        const obs = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(finish, q);
        });
        obs.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
        timer = setTimeout(finish, q);
        const cap = setTimeout(finish, m);
      }),
    { quietMs, maxMs },
  );
}

/**
 * Render one URL.
 *
 * Waits, in order: the load event, network idle (best effort), an optional selector,
 * then until the DOM has been quiet for `settle` ms. That last step catches content that
 * a timer or a streamed chunk adds after the network goes quiet.
 *
 * Options: timeout, waitFor, settle, stripScripts, wantHtml, wantSignals, wantLinks.
 */
export async function renderUrl(context, url, opts = {}) {
  const {
    timeout = 30000,
    waitFor,
    settle = 500,
    stripScripts = true,
    wantHtml = false,
    wantSignals = false,
    wantLinks = false,
  } = opts;
  const t0 = performance.now();
  const warnings = [];
  const page = await context.newPage();
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout });
    const status = response ? response.status() : 0;

    try {
      await page.waitForLoadState('networkidle', { timeout: Math.min(timeout, 15000) });
    } catch {
      warnings.push('network never went idle; rendered after the timeout');
    }

    if (waitFor) {
      try {
        await page.waitForSelector(waitFor, { timeout, state: 'attached' });
      } catch {
        return {
          ok: false,
          status,
          finalUrl: page.url(),
          error: `selector "${waitFor}" did not appear within ${timeout} ms`,
          renderMs: Math.round(performance.now() - t0),
          warnings,
        };
      }
    }

    if (settle > 0) await waitForDomToSettle(page, settle, Math.min(timeout, 5000));

    const result = { ok: status > 0 && status < 400, status, finalUrl: page.url(), warnings };

    if (wantSignals) result.signals = await page.evaluate(extractSignals);
    if (wantLinks) {
      result.links = await page.evaluate(() =>
        [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => /^https?:/i.test(h)),
      );
    }
    result.title = await page.title();
    result.jsonLdBlocks = await page.evaluate(
      () => document.querySelectorAll('script[type="application/ld+json"]').length,
    );

    if (wantHtml) {
      if (stripScripts) {
        await page.evaluate(() => {
          document
            .querySelectorAll(
              'script:not([type="application/ld+json"]), link[rel="modulepreload"], link[rel="preload"][as="script"]',
            )
            .forEach((n) => n.remove());
        });
      }
      result.html = await page.content();
    }
    result.renderMs = Math.round(performance.now() - t0);
    return result;
  } catch (e) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      error: e.message.split('\n')[0],
      renderMs: Math.round(performance.now() - t0),
      warnings,
    };
  } finally {
    await page.close().catch(() => {});
  }
}
