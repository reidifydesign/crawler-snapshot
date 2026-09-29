/**
 * Fetch a URL the way a crawler that does not run JavaScript would: one HTTP request,
 * a crawler User-Agent, redirects followed, no scripts executed.
 */
export async function fetchRaw(url, { userAgent, timeout = 20000, fetchImpl = fetch } = {}) {
  const t0 = performance.now();
  try {
    const res = await fetchImpl(url, {
      headers: {
        'user-agent': userAgent,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'accept-language': 'en',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout),
    });
    const html = await res.text();
    return {
      ok: true,
      status: res.status,
      finalUrl: res.url || url,
      redirected: res.redirected,
      contentType: res.headers.get('content-type') || '',
      vary: res.headers.get('vary') || '',
      html,
      bytes: Buffer.byteLength(html),
      ms: Math.round(performance.now() - t0),
    };
  } catch (e) {
    return { ok: false, error: e.cause?.code ? `${e.message} (${e.cause.code})` : e.message };
  }
}
