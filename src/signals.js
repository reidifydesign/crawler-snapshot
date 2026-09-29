/**
 * Runs inside a page (via page.evaluate). It must stay self-contained: no imports,
 * no references to anything outside this function body.
 * The same function measures the raw HTML (parsed with JavaScript off) and the
 * rendered DOM, so the two sides are compared like for like.
 */
export function extractSignals() {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const inHidden = (el) => !!el.closest('[hidden], template');
  const visible = (el) => !inHidden(el) && el.getClientRects().length > 0;

  const body = document.body;
  const text = body ? norm(body.innerText) : '';

  const headings = [...document.querySelectorAll('h1, h2, h3')]
    .filter(visible)
    .map((h) => ({ level: Number(h.tagName[1]), text: norm(h.textContent).slice(0, 140) }));

  const links = [...document.querySelectorAll('a[href]')]
    .filter((a) => !inHidden(a))
    .map((a) => (a.getAttribute('href') || '').trim())
    .filter((h) => h && !h.startsWith('#') && !/^(javascript|mailto|tel|data):/i.test(h));

  const attr = (sel, name) => {
    const el = document.querySelector(sel);
    const v = el && el.getAttribute(name);
    return v ? v.trim() : null;
  };

  const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => {
    const raw = s.textContent || '';
    try {
      const parsed = JSON.parse(raw);
      const types = [];
      const walk = (n) => {
        if (Array.isArray(n)) n.forEach(walk);
        else if (n && typeof n === 'object') {
          if (n['@type']) types.push(...[].concat(n['@type']).map(String));
          if (n['@graph']) walk(n['@graph']);
        }
      };
      walk(parsed);
      return { valid: true, types, chars: raw.length };
    } catch {
      return { valid: false, types: [], chars: raw.length };
    }
  });

  // Content that is in the markup but hidden: the shape a streamed Suspense chunk has
  // before the script that reveals it runs.
  const hiddenEls = [...document.querySelectorAll('[hidden]')].filter(
    (e) => !(e.parentElement && e.parentElement.closest('[hidden]')),
  );
  let hiddenChars = 0;
  const hiddenIds = [];
  for (const e of hiddenEls) {
    const n = norm(e.textContent).length;
    hiddenChars += n;
    if (n > 0) hiddenIds.push(e.id || e.tagName.toLowerCase());
  }
  for (const t of document.querySelectorAll('template[id]')) {
    if (/^[BPSC]:\d+/.test(t.id)) {
      const n = norm(t.content.textContent).length;
      hiddenChars += n;
      if (n > 0) hiddenIds.push(t.id);
    }
  }

  return {
    title: norm(document.title),
    metaDescription: attr('meta[name="description" i]', 'content'),
    canonical: attr('link[rel~="canonical" i]', 'href'),
    robotsMeta: attr('meta[name="robots" i]', 'content'),
    lang: document.documentElement.getAttribute('lang') || null,
    textLength: text.length,
    wordCount: text ? text.split(' ').length : 0,
    textSample: text.slice(0, 160),
    headings,
    linkCount: links.length,
    jsonLd,
    hiddenChars,
    hiddenIds,
  };
}

/**
 * Markers that React-style streaming leaves in the raw markup. Found by pattern, in Node,
 * on the raw response body.
 */
export function streamMarkers(html) {
  const found = [];
  if (/\$R[CSXB]?\s*\(/.test(html)) found.push('inline reveal script ($RC, $RS, $RX)');
  if (/<!--\$\?-->/.test(html)) found.push('pending Suspense boundary (<!--$?-->)');
  if (/<!--\$!-->/.test(html)) found.push('errored Suspense boundary (<!--$!-->)');
  if (/<div[^>]*\bhidden\b[^>]*\bid="S:\d+/.test(html) || /<div[^>]*\bid="S:\d+[^>]*\bhidden\b/.test(html)) {
    found.push('hidden segment div (id="S:n")');
  }
  if (/<template[^>]*\bid="[BPSC]:\d+/.test(html)) found.push('boundary template (id="B:n")');
  return found;
}
