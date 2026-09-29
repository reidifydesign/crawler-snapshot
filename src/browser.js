import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { chromium } from 'playwright-core';

/** Where a Chrome, Edge or Chromium usually lives. Checked in order. */
export function candidatePaths(env = process.env, platform = process.platform) {
  const out = [];
  if (platform === 'win32') {
    const roots = [env.LOCALAPPDATA, env.PROGRAMFILES, env['PROGRAMFILES(X86)']].filter(Boolean);
    for (const r of roots) {
      out.push(join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      out.push(join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      out.push(join(r, 'Chromium', 'Application', 'chrome.exe'));
    }
  } else if (platform === 'darwin') {
    out.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    out.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
    out.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    if (env.HOME) {
      out.push(join(env.HOME, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'));
    }
  } else {
    const names = [
      'google-chrome',
      'google-chrome-stable',
      'chromium',
      'chromium-browser',
      'microsoft-edge',
      'microsoft-edge-stable',
      'chrome',
    ];
    const dirs = (env.PATH || '').split(delimiter).filter(Boolean);
    for (const n of names) for (const d of dirs) out.push(join(d, n));
    out.push('/snap/bin/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome');
  }
  return out;
}

/**
 * Find a browser to drive. CHROME_PATH wins. If it is set but wrong we throw, because
 * silently falling back would hide a typo.
 */
export function findBrowser(env = process.env, platform = process.platform, exists = existsSync) {
  if (env.CHROME_PATH) {
    if (!exists(env.CHROME_PATH)) {
      throw new Error(`CHROME_PATH is set to "${env.CHROME_PATH}" but no file exists there.`);
    }
    return env.CHROME_PATH;
  }
  for (const p of candidatePaths(env, platform)) if (exists(p)) return p;
  return null;
}

export const NO_BROWSER_MESSAGE =
  'No Chrome, Edge or Chromium found. This tool does not download a browser. ' +
  'Install one, or set CHROME_PATH to its executable.';

/** Launch the local browser headless. Set CRAWLER_PRERENDER_NO_SANDBOX=1 inside a root container. */
export async function launchBrowser({ executablePath, env = process.env } = {}) {
  const path = executablePath || findBrowser(env);
  if (!path) throw new Error(NO_BROWSER_MESSAGE);
  const args = env.CRAWLER_PRERENDER_NO_SANDBOX === '1' ? ['--no-sandbox'] : [];
  return chromium.launch({ executablePath: path, headless: true, args });
}

/** A desktop UA built from the running browser, with an honest suffix and no "Headless". */
export function defaultUserAgent(browser, version) {
  const chrome = (browser.version() || '131.0.0.0').replace(/^[^\d]*/, '');
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36 crawler-prerender/${version}`;
}
