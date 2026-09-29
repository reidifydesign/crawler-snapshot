import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { main } from '../src/cli.js';
import { startFixture } from './fixture/server.js';
import { browserSkip, tmp } from './helpers.js';

const skip = browserSkip();
const BIN = new URL('../bin/crawler-snapshot.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** Run the CLI in-process and capture output. */
async function run(args) {
  const out = [];
  const err = [];
  const code = await main(args, { out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('help lists the three commands and exits 0; no arguments exits 1', async () => {
  const r = await run(['--help']);
  assert.equal(r.code, 0);
  for (const c of ['check', 'snapshot', 'agents']) assert.match(r.out, new RegExp(`crawler-snapshot ${c}`));
  assert.equal((await run([])).code, 1);
});

test('unknown commands and bad numbers are errors with exit code 2', async () => {
  assert.equal((await run(['nope'])).code, 2);
  const bad = await run(['check', 'http://127.0.0.1:1/', '--timeout', 'soon']);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /--timeout must be/);
});

test('agents prints a table and the machine formats', async () => {
  assert.match((await run(['agents'])).out, /GPTBot\s+OpenAI/);
  assert.match((await run(['agents', '--all'])).out, /Google-Extended.*no \(control token\)/);
  assert.match((await run(['agents', '--format', 'nginx'])).out, /map \$http_user_agent/);
});

test('the bin file runs as a real process', () => {
  const r = spawnSync(process.execPath, [BIN, '--version'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('a missing browser is a clear error, not a stack trace', async () => {
  const r = spawnSync(process.execPath, [BIN, 'check', 'http://127.0.0.1:9/'], {
    encoding: 'utf8',
    env: { ...process.env, CHROME_PATH: join(process.cwd(), 'definitely-not-here.exe') },
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /CHROME_PATH/);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});

describe('check and snapshot through the CLI', { skip }, () => {
  let fx;
  before(async () => {
    fx = await startFixture();
  });
  after(() => fx.close());

  test('check exits 1 on a failing page, writes JSON, prints the table', async () => {
    const dir = tmp('cli-');
    try {
      const json = join(dir, 'report.json');
      const r = await run(['check', `${fx.url}/streamed`, '--json', json, '--delay', '0']);
      assert.equal(r.code, 1);
      assert.match(r.out, /hidden-streamed-content/);
      assert.match(r.out, /1 route\(s\): 0 ok, 0 warn, 1 fail/);
      const report = JSON.parse(readFileSync(json, 'utf8'));
      assert.equal(report.routes[0].verdict, 'FAIL');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('check exits 0 on a clean page, and --fail-on never always exits 0', async () => {
    assert.equal((await run(['check', `${fx.url}/ssr`, '--delay', '0'])).code, 0);
    assert.equal((await run(['check', `${fx.url}/streamed`, '--fail-on', 'never', '--delay', '0'])).code, 0);
  });

  test('--as picks the crawler, and an unpublished user agent string is called out', async () => {
    const r = await run(['check', `${fx.url}/ssr`, '--as', 'ClaudeBot', '--delay', '0']);
    assert.match(r.out, /crawler request as ClaudeBot \(UA string not published/);
    assert.ok(fx.seen.some((s) => /ClaudeBot/.test(s.ua) && s.path === '/ssr'));
  });

  test('snapshot writes files and prints where', async () => {
    const dir = tmp('cli-snap-');
    try {
      const r = await run(['snapshot', `${fx.url}/about`, '--out', dir, '--delay', '0', '--depth', '0']);
      assert.equal(r.code, 0);
      assert.match(r.out, /Snapshot done: 1 saved/);
      assert.ok(existsSync(join(dir, 'about', 'index.html')));
      assert.ok(existsSync(join(dir, 'manifest.json')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
