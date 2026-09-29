/**
 * Compare what a crawler receives against what a browser ends up with.
 * Pure function: no browser, no network. The thresholds are exported so tests and
 * readers can see exactly where the lines are.
 */
export const THRESHOLDS = {
  /** Below this many rendered characters the page is too thin to judge by ratio. */
  minRenderedText: 200,
  /** Raw text under this share of rendered text is a FAIL. */
  textRatioFail: 0.5,
  /** Raw text under this share of rendered text is a WARN. */
  textRatioWarn: 0.85,
  /** Hidden characters in the raw HTML at or above this count are reported. */
  hiddenMin: 100,
  /** Raw links under this share of rendered links is a WARN. */
  linkRatioWarn: 0.7,
  /** Only judge link ratio when the rendered page has at least this many links. */
  linkMin: 5,
};

const same = (a, b) => (a || '').trim() === (b || '').trim();

function resolveUrl(href, base) {
  if (!href) return null;
  try {
    const u = new URL(href, base);
    u.hash = '';
    let s = u.href;
    if (u.pathname.length > 1) s = s.replace(/\/(\?|$)/, '$1');
    return s;
  } catch {
    return href;
  }
}

const validBlocks = (s) => s.jsonLd.filter((b) => b.valid);
const typeSet = (s) => new Set(validBlocks(s).flatMap((b) => b.types));

/**
 * @param {object} input
 * @param {object} input.raw       result of fetchRaw (status, bytes, contentType, finalUrl)
 * @param {object} input.rawSig    signals measured on the raw HTML, or null
 * @param {string[]} input.markers streaming markers found in the raw HTML
 * @param {object} input.rendered  signals measured on the rendered DOM
 * @param {string} input.url       the URL that was checked
 * @returns {{verdict: 'OK'|'WARN'|'FAIL', issues: Array<{severity:'FAIL'|'WARN', code:string, message:string}>, textRatio:number|null}}
 */
export function analyze({ raw, rawSig, markers = [], rendered, url }) {
  const T = THRESHOLDS;
  const issues = [];
  const add = (severity, code, message) => issues.push({ severity, code, message });

  if (!raw.ok) {
    add('FAIL', 'raw-fetch-failed', `A crawler request failed: ${raw.error}.`);
    return { verdict: 'FAIL', issues, textRatio: null };
  }
  if (raw.status >= 400) {
    add('FAIL', 'raw-status', `A crawler gets HTTP ${raw.status} for a page the browser renders.`);
  }
  if (!/html|xml/i.test(raw.contentType)) {
    add('FAIL', 'raw-not-html', `A crawler gets "${raw.contentType || 'no content type'}", not HTML.`);
    return { verdict: 'FAIL', issues, textRatio: null };
  }

  const R = rawSig;
  const D = rendered;
  const textRatio = D.textLength > 0 ? R.textLength / D.textLength : 1;
  const pct = Math.round(textRatio * 100);

  if (D.textLength < T.minRenderedText) {
    add('WARN', 'rendered-thin', `The rendered page has only ${D.textLength} characters of text. If that is wrong, try --wait-for or a longer --settle.`);
  } else if (textRatio < T.textRatioFail) {
    add('FAIL', 'content-js-only', `Only ${pct}% of the page text is in the HTML a crawler receives (${R.textLength} of ${D.textLength} characters).`);
  } else if (textRatio < T.textRatioWarn) {
    add('WARN', 'content-partial', `${pct}% of the page text is in the HTML a crawler receives (${R.textLength} of ${D.textLength} characters).`);
  }

  if (R.hiddenChars >= T.hiddenMin) {
    const where = R.hiddenIds.slice(0, 3).join(', ');
    const msg = `${R.hiddenChars} characters sit in hidden elements (${where}) in the raw HTML and are revealed only by JavaScript.${markers.length ? ` Streaming markers: ${markers.join('; ')}.` : ''}`;
    add(textRatio < T.textRatioWarn ? 'FAIL' : 'WARN', 'hidden-streamed-content', msg);
  } else if (markers.length) {
    add('WARN', 'stream-markers', `Streaming markers are present (${markers.join('; ')}). Confirm every boundary resolved before the response ended.`);
  }

  const rH1 = R.headings.filter((h) => h.level === 1).length;
  const dH1 = D.headings.filter((h) => h.level === 1).length;
  if (dH1 > 0 && rH1 === 0) {
    add('FAIL', 'h1-js-only', `The browser shows an h1 ("${D.headings.find((h) => h.level === 1).text}") that is not visible in the crawler HTML.`);
  } else if (D.headings.length > 0 && R.headings.length > 0 && !same(R.headings[0].text, D.headings[0].text)) {
    add('WARN', 'first-heading-differs', `The first visible heading differs. Crawler HTML: "${R.headings[0].text}". Browser: "${D.headings[0].text}".`);
  } else if (D.headings.length > 0 && R.headings.length === 0) {
    add('WARN', 'headings-js-only', 'The page has headings in the browser and none visible in the crawler HTML.');
  }

  const rLd = validBlocks(R).length;
  const dLd = validBlocks(D).length;
  if (dLd > 0 && rLd === 0) {
    add('FAIL', 'jsonld-js-only', `${dLd} JSON-LD block(s) exist only after JavaScript runs (types: ${[...typeSet(D)].join(', ') || 'none'}).`);
  } else if (rLd < dLd) {
    const missing = [...typeSet(D)].filter((t) => !typeSet(R).has(t));
    add('WARN', 'jsonld-partial', `${rLd} of ${dLd} JSON-LD blocks are in the crawler HTML${missing.length ? `; missing types: ${missing.join(', ')}` : ''}.`);
  }
  if (R.jsonLd.some((b) => !b.valid)) {
    add('WARN', 'jsonld-invalid', 'A JSON-LD block in the crawler HTML is not valid JSON.');
  }

  if (D.linkCount >= 3 && R.linkCount === 0) {
    add('FAIL', 'links-js-only', `The browser shows ${D.linkCount} links and the crawler HTML has none, so a crawler cannot reach other pages from here.`);
  } else if (D.linkCount >= T.linkMin && R.linkCount < D.linkCount * T.linkRatioWarn) {
    add('WARN', 'links-partial', `The crawler HTML has ${R.linkCount} links against ${D.linkCount} in the browser.`);
  }

  if (!R.title && D.title) add('WARN', 'title-js-only', `The <title> ("${D.title}") is only set by JavaScript.`);
  else if (R.title && D.title && !same(R.title, D.title)) add('WARN', 'title-differs', `<title> differs. Crawler HTML: "${R.title}". Browser: "${D.title}".`);

  if (!R.metaDescription && D.metaDescription) add('WARN', 'meta-description-js-only', 'The meta description is only set by JavaScript.');
  else if (R.metaDescription && D.metaDescription && !same(R.metaDescription, D.metaDescription)) add('WARN', 'meta-description-differs', 'The meta description differs between crawler HTML and browser.');

  const rc = resolveUrl(R.canonical, url);
  const dc = resolveUrl(D.canonical, url);
  if (!rc && dc) add('WARN', 'canonical-js-only', `The canonical link (${dc}) is only set by JavaScript.`);
  else if (rc && dc && rc !== dc) add('WARN', 'canonical-differs', `Canonical differs. Crawler HTML: ${rc}. Browser: ${dc}.`);

  const rNoindex = /noindex/i.test(R.robotsMeta || '');
  const dNoindex = /noindex/i.test(D.robotsMeta || '');
  if (rNoindex !== dNoindex) {
    add('WARN', 'robots-differs', `The robots meta tag differs: crawler HTML is ${rNoindex ? 'noindex' : 'indexable'}, browser is ${dNoindex ? 'noindex' : 'indexable'}.`);
  }

  const verdict = issues.some((i) => i.severity === 'FAIL') ? 'FAIL' : issues.length ? 'WARN' : 'OK';
  return { verdict, issues, textRatio };
}
