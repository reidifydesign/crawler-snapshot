/**
 * A small robots.txt reader. It handles User-agent groups, Allow, Disallow, `*` and `$`.
 * It is here so the link crawl is polite by default. Sitemap and routes-file inputs are
 * explicit lists and are not filtered by it.
 */
export function parseRobots(text, token = 'crawler-snapshot') {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if ((key === 'allow' || key === 'disallow') && cur) {
      lastWasAgent = false;
      if (val) cur.rules.push({ allow: key === 'allow', pattern: val });
    } else {
      lastWasAgent = false;
    }
  }
  const t = token.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && t.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  const rules = chosen.flatMap((g) => g.rules);
  return {
    isAllowed(pathname) {
      let best = null;
      for (const r of rules) {
        if (matches(r.pattern, pathname)) {
          const longer = best && r.pattern.length > best.pattern.length;
          const tieAllow = best && r.pattern.length === best.pattern.length && r.allow;
          if (!best || longer || tieAllow) best = r;
        }
      }
      return best ? best.allow : true;
    },
  };
}

function matches(pattern, path) {
  let re = '^';
  for (const ch of pattern) {
    if (ch === '*') re += '.*';
    else if (ch === '$') re += '$';
    else re += ch.replace(/[.+?^{}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re).test(path);
}

export async function loadRobots(origin, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(new URL('/robots.txt', origin), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return parseRobots('');
    return parseRobots(await res.text());
  } catch {
    return parseRobots('');
  }
}
