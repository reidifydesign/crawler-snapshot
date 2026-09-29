import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze } from '../src/analyze.js';

const sig = (over = {}) => ({
  title: 'Page',
  metaDescription: 'A page',
  canonical: 'https://e.com/p',
  robotsMeta: null,
  textLength: 1000,
  wordCount: 160,
  headings: [{ level: 1, text: 'Heading' }],
  linkCount: 6,
  jsonLd: [{ valid: true, types: ['WebPage'], chars: 40 }],
  hiddenChars: 0,
  hiddenIds: [],
  ...over,
});
const raw = { ok: true, status: 200, contentType: 'text/html', bytes: 5000 };
const run = (rawSig, rendered, extra = {}) =>
  analyze({ raw, rawSig, rendered, url: 'https://e.com/p', markers: [], ...extra });
const codes = (r) => r.issues.map((i) => i.code);

test('identical raw and rendered is OK', () => {
  const r = run(sig(), sig());
  assert.equal(r.verdict, 'OK');
  assert.deepEqual(r.issues, []);
});

test('an empty shell against a full page fails on content, h1, JSON-LD and links', () => {
  const r = run(sig({ textLength: 0, headings: [], linkCount: 0, jsonLd: [], title: '', metaDescription: null, canonical: null }), sig());
  assert.equal(r.verdict, 'FAIL');
  for (const c of ['content-js-only', 'h1-js-only', 'jsonld-js-only', 'links-js-only']) assert.ok(codes(r).includes(c), c);
});

test('the text ratio thresholds: below 50% fails, below 85% warns, otherwise fine', () => {
  assert.ok(codes(run(sig({ textLength: 400 }), sig())).includes('content-js-only'));
  assert.ok(codes(run(sig({ textLength: 700 }), sig())).includes('content-partial'));
  assert.deepEqual(codes(run(sig({ textLength: 900 }), sig())), []);
});

test('a nearly empty rendered page warns that the wait may be wrong, instead of judging a ratio', () => {
  const r = run(sig({ textLength: 0 }), sig({ textLength: 50 }));
  assert.ok(codes(r).includes('rendered-thin'));
  assert.ok(!codes(r).includes('content-js-only'));
});

test('hidden streamed content is a failure when it carries the page, a warning when the page is mostly there', () => {
  const streamed = { hiddenChars: 800, hiddenIds: ['S:0'] };
  const r = run(sig({ textLength: 30, headings: [], ...streamed }), sig(), { markers: ['inline reveal script ($RC, $RS, $RX)'] });
  const h = r.issues.find((i) => i.code === 'hidden-streamed-content');
  assert.equal(h.severity, 'FAIL');
  assert.match(h.message, /S:0/);
  assert.match(h.message, /reveal script/);
  const mild = run(sig({ textLength: 950, hiddenChars: 300, hiddenIds: ['S:1'] }), sig());
  assert.equal(mild.issues.find((i) => i.code === 'hidden-streamed-content').severity, 'WARN');
});

test('markers alone are a warning', () => {
  const r = run(sig(), sig(), { markers: ['pending Suspense boundary (<!--$?-->)'] });
  assert.deepEqual(codes(r), ['stream-markers']);
  assert.equal(r.verdict, 'WARN');
});

test('a different first heading is caught (the footer wordmark case)', () => {
  const r = run(sig({ headings: [{ level: 2, text: 'Footer Wordmark' }] }), sig());
  assert.ok(codes(r).includes('h1-js-only') || codes(r).includes('first-heading-differs'));
  const both = run(sig({ headings: [{ level: 1, text: 'Other' }] }), sig());
  assert.ok(codes(both).includes('first-heading-differs'));
});

test('partial JSON-LD names the missing types', () => {
  const rendered = sig({ jsonLd: [{ valid: true, types: ['WebPage'], chars: 1 }, { valid: true, types: ['FAQPage'], chars: 1 }] });
  const r = run(sig(), rendered);
  const i = r.issues.find((x) => x.code === 'jsonld-partial');
  assert.match(i.message, /FAQPage/);
});

test('invalid JSON-LD in the raw HTML warns', () => {
  const r = run(sig({ jsonLd: [{ valid: true, types: ['WebPage'], chars: 1 }, { valid: false, types: [], chars: 5 }] }), sig());
  assert.ok(codes(r).includes('jsonld-invalid'));
});

test('title, description and canonical differences are reported, and canonical compares resolved URLs', () => {
  const r = run(sig({ title: 'Shop', metaDescription: null, canonical: 'https://e.com/' }), sig());
  for (const c of ['title-differs', 'meta-description-js-only', 'canonical-differs']) assert.ok(codes(r).includes(c), c);
  const rel = run(sig({ canonical: '/p' }), sig({ canonical: 'https://e.com/p/' }));
  assert.ok(!codes(rel).includes('canonical-differs'), 'relative vs absolute and trailing slash are the same URL');
});

test('a robots noindex that only one side has is reported', () => {
  const r = run(sig({ robotsMeta: 'noindex' }), sig());
  assert.ok(codes(r).includes('robots-differs'));
});

test('a failed or non-HTML crawler response fails outright', () => {
  assert.equal(analyze({ raw: { ok: false, error: 'timeout' }, rawSig: null, rendered: sig(), url: 'https://e.com/p' }).verdict, 'FAIL');
  assert.equal(analyze({ raw: { ...raw, contentType: 'application/json' }, rawSig: null, rendered: sig(), url: 'https://e.com/p' }).verdict, 'FAIL');
  const r = analyze({ raw: { ...raw, status: 404 }, rawSig: sig(), rendered: sig(), url: 'https://e.com/p' });
  assert.ok(r.issues.some((i) => i.code === 'raw-status'));
});
