import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { findBrowser } from '../src/browser.js';

/** Browser tests skip, with a reason, when no Chrome, Edge or Chromium is installed. */
export function browserSkip() {
  try {
    return findBrowser() ? false : 'no local Chrome, Edge or Chromium found (set CHROME_PATH)';
  } catch (e) {
    return e.message;
  }
}

export const tmp = (prefix = 'cp-') => mkdtempSync(join(tmpdir(), prefix));

/** Write a fake snapshot file the way `snapshot` would, including its banner. */
export function writeSnapshot(dir, route, body) {
  const file = join(dir, route === '/' ? '' : route, 'index.html');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `<!DOCTYPE html><!-- crawler-snapshot test: snapshot -->\n<html><body>${body}</body></html>`);
}

/** Small http helper that returns status, headers and text. */
export async function get(url, ua) {
  const res = await fetch(url, { headers: ua ? { 'user-agent': ua } : {}, redirect: 'manual' });
  return { status: res.status, headers: res.headers, text: await res.text() };
}
