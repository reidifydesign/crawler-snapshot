import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatAgents, isCrawler, loadAgents, serveList, userAgentFor } from '../src/agents.js';
import { outOfDate } from '../scripts/sync-examples.mjs';

const { agents } = loadAgents();

test('every entry has a token, a source URL, a date and a verification level', () => {
  assert.ok(agents.length >= 15);
  for (const a of agents) {
    assert.ok(a.name && a.token, `${a.name}: token`);
    assert.match(a.source, /^https:\/\//, `${a.name}: source`);
    assert.match(a.checked, /^\d{4}-\d{2}-\d{2}$/, `${a.name}: checked date`);
    assert.ok(['verified', 'partial', 'unverified'].includes(a.verification), `${a.name}: verification`);
    assert.equal(typeof a.serve, 'boolean');
    assert.equal(typeof a.crawls, 'boolean');
  }
});

test('names are unique', () => {
  assert.equal(new Set(agents.map((a) => a.name.toLowerCase())).size, agents.length);
});

test('control tokens are never served', () => {
  const served = serveList().map((a) => a.name);
  for (const name of ['Google-Extended', 'Applebot-Extended']) {
    const entry = agents.find((a) => a.name === name);
    assert.equal(entry.crawls, false);
    assert.equal(entry.serve, false);
    assert.ok(!served.includes(name));
  }
});

test('the crawlers named in the brief are all present', () => {
  const names = agents.map((a) => a.name);
  for (const n of ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'PerplexityBot', 'CCBot', 'Googlebot', 'bingbot', 'Applebot']) {
    assert.ok(names.includes(n), n);
  }
});

test('isCrawler matches documented user agent strings and ignores browsers', () => {
  for (const a of serveList().filter((x) => x.userAgent)) {
    assert.ok(isCrawler(a.userAgent), `${a.name} should match its own documented string`);
  }
  assert.ok(isCrawler('Mozilla/5.0 (compatible; gptbot/1.2)'), 'case-insensitive');
  assert.ok(!isCrawler('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'));
  assert.ok(!isCrawler(''));
  assert.ok(!isCrawler(undefined));
  assert.ok(!isCrawler('Google-Extended'), 'a control token is not a request user agent');
});

test('extra user agents can be added', () => {
  assert.ok(!isCrawler('MyCompanyBot/1.0'));
  assert.ok(isCrawler('MyCompanyBot/1.0', { extra: ['MyCompanyBot'] }));
});

test('userAgentFor uses the documented string, and says when it had to invent one', () => {
  const gpt = userAgentFor('GPTBot');
  assert.equal(gpt.documented, true);
  assert.match(gpt.ua, /GPTBot\/1\.4/);
  const claude = userAgentFor('ClaudeBot');
  assert.equal(claude.documented, false);
  assert.match(claude.ua, /ClaudeBot/);
  const bing = userAgentFor('bingbot');
  assert.doesNotMatch(bing.ua, /W\.X\.Y\.Z/);
});

test('formatAgents produces regex, nginx and json output', () => {
  assert.match(formatAgents('regex'), /^GPTBot\|/);
  assert.match(formatAgents('nginx'), /map \$http_user_agent \$crawler_snapshot/);
  assert.equal(JSON.parse(formatAgents('json')).length, serveList().length);
  assert.throws(() => formatAgents('xml'), /Unknown format/);
});

test('the copy-paste examples still match data/crawlers.json', () => {
  assert.deepEqual(outOfDate(), [], 'run: node scripts/sync-examples.mjs');
});
