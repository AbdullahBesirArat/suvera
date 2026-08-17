'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

// Load js/api.js in a sandbox and hand back the resolver helpers it publishes on
// window.SuveraAPI. products.images entries are colour-aware ("Colour | url"), so the
// classic-script resolver has to strip that prefix before building src/srcset.
function loadApi() {
  const source = fs.readFileSync(path.join(root, 'js', 'api.js'), 'utf8');
  const context = {
    window: {
      location: { href: 'https://suvera-web.vercel.app/urun', search: '', origin: 'https://suvera-web.vercel.app' },
      addEventListener() {},
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    },
    document: { readyState: 'complete', addEventListener() {}, getElementById: () => null, cookie: '' },
    console,
    fetch: () => Promise.reject(new Error('no network in tests')),
    URL,
    URLSearchParams,
    Intl,
    Date,
    JSON,
    Number,
    Array,
    String,
    Boolean,
    Math,
    RegExp,
    Promise,
    Error,
    setTimeout,
    clearTimeout,
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.SuveraAPI;
}

const api = loadApi();
const MEDIA = '/api/media/2f7c1f28-9d5a-4f9c-8a3d-1b6e5c4a7d90/card';

test('a colour-aware entry resolves to the url, never to /uploads/<colour>', () => {
  assert.equal(api.assetUrl(`İndigo | ${MEDIA}`), MEDIA);
  assert.equal(api.assetUrl(`Haki | https://example.test/x.webp`), 'https://example.test/x.webp');
});

test('colour entries carrying a hex swatch still resolve to the url', () => {
  assert.equal(api.assetUrl(`Lacivert #243f8f | ${MEDIA}`), MEDIA);
  assert.equal(api.assetUrl(`Krem/Siyah #e8e1d5 | ${MEDIA}`), MEDIA);
});

test('plain urls are unchanged', () => {
  assert.equal(api.assetUrl(MEDIA), MEDIA);
  assert.equal(api.assetUrl('https://example.test/x.webp'), 'https://example.test/x.webp');
});

test('legacy upload paths keep their existing resolution', () => {
  assert.match(api.assetUrl('/uploads/1778199301283-400484640.webp'), /\/uploads\/1778199301283-400484640\.webp$/);
  assert.match(api.assetUrl('uploads/legacy.webp'), /\/uploads\/legacy\.webp$/);
});

// The exact production regression: the colour name fell through to the trailing
// "/uploads/" branch, so the browser received "/uploads/İndigo" as a srcset candidate.
test('no colour name is ever turned into an /uploads/ path', () => {
  for (const colour of ['İndigo', 'Haki', 'Lacivert', 'Beyaz', 'Bej', 'Mürdüm', 'Yağ Yeşili']) {
    const resolved = api.assetUrl(`${colour} | ${MEDIA}`);
    assert.equal(resolved, MEDIA);
    assert.doesNotMatch(resolved, /\/uploads\//);
    assert.ok(!resolved.includes(colour), `${colour} leaked into the resolved url`);
  }
});

test('a malformed entry whose url half is missing resolves to empty, not /uploads/<colour>', () => {
  for (const malformed of ['İndigo |', 'Haki | ', '| Bej', 'Lacivert | Beyaz']) {
    const resolved = api.assetUrl(malformed);
    assert.equal(resolved, '', `expected empty for ${JSON.stringify(malformed)}, got ${resolved}`);
  }
  assert.equal(api.assetUrl('|'), '');
  assert.equal(api.assetUrl(''), '');
});

test('srcset built from a colour-aware entry is browser-valid', () => {
  const responsive = api.responsiveImage(`İndigo | ${MEDIA}`, 'card');
  assert.ok(responsive.srcset, 'expected a srcset for a managed media url');
  const candidates = responsive.srcset.split(',').map((part) => part.trim());
  assert.equal(candidates.length, 3);
  for (const candidate of candidates) {
    const bits = candidate.split(/\s+/);
    assert.equal(bits.length, 2, `candidate must be "<url> <descriptor>": ${candidate}`);
    assert.match(bits[1], /^\d+w$/, `unknown descriptor in: ${candidate}`);
    assert.doesNotMatch(bits[0], /\|/);
    assert.doesNotMatch(bits[0], /\/uploads\//);
  }
  assert.doesNotMatch(responsive.srcset, /İndigo/);
  assert.doesNotMatch(responsive.src, /İndigo/);
});

test('card renderers pick the first usable image from a colour-aware array', () => {
  const images = [`İndigo | ${MEDIA}`, `Gri | /api/media/11111111-1111-4111-8111-111111111111/card`];
  let src = '';
  for (const entry of images) {
    const url = typeof entry === 'string' ? entry : (entry && entry.url) || '';
    const resolved = url ? api.assetUrl(url) : '';
    if (resolved) { src = resolved; break; }
  }
  assert.equal(src, MEDIA);
});

test('recently-viewed and comparison no longer pass raw entries to the resolver', () => {
  for (const file of ['recently-viewed.js', 'comparison.js']) {
    const source = fs.readFileSync(path.join(root, 'js', file), 'utf8');
    assert.doesNotMatch(
      source,
      /const entry = images\[0\];/,
      `${file} still selects images[0] without normalizing`
    );
  }
});
