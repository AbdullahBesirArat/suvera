'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js', 'recently-viewed.js'), 'utf8');

// Load the IIFE in a sandbox with a fake window + localStorage, then exercise the
// pure local-history helpers it exposes on window.SuveraRecentlyViewed.
function load({ store = new Map(), signedIn = false } = {}) {
  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  const context = {
    window: {
      localStorage,
      location: { search: '' },
      SuveraAPI: { hasCustomerSession: () => signedIn },
      addEventListener() {},
    },
    document: { readyState: 'complete', getElementById: () => null, addEventListener() {} },
    URLSearchParams,
    Intl,
    Date,
    JSON,
    Number,
    Array,
  };
  context.window.document = context.document;
  vm.createContext(context);
  vm.runInContext(source, context);
  return { rv: context.window.SuveraRecentlyViewed, store };
}

test('upsert dedupes, moves to front and caps at MAX', () => {
  const { rv } = load();
  let list = [];
  list = rv.upsert(list, 5, 100);
  list = rv.upsert(list, 7, 200);
  list = rv.upsert(list, 5, 300); // re-view 5 -> front, no duplicate
  // Array.from re-homes the vm-realm array so deepEqual compares by value, not prototype.
  assert.deepEqual(Array.from(list, (e) => e.id), [5, 7]);
  assert.equal(list[0].ts, 300);

  // Cap: adding MAX+5 distinct ids keeps only the most recent MAX.
  let big = [];
  for (let i = 1; i <= rv.MAX + 5; i += 1) big = rv.upsert(big, i, i);
  assert.equal(big.length, rv.MAX);
  assert.equal(big[0].id, rv.MAX + 5); // newest first
});

test('readLocal filters malformed and TTL-expired entries', () => {
  const store = new Map();
  const fresh = Date.now();
  const stale = Date.now() - (91 * 24 * 60 * 60 * 1000); // older than 90d TTL
  store.set('suvera:recently-viewed:v1', JSON.stringify([
    { id: 3, ts: fresh },
    { id: 4, ts: stale },
    { id: 'x', ts: fresh },
    { id: 5 },
  ]));
  const { rv } = load({ store });
  assert.deepEqual(Array.from(rv.readLocal(), (e) => e.id), [3]);
});

test('recordLocal persists only product ids (no token/PII) to storage', () => {
  const { rv, store } = load();
  rv.recordLocal(42);
  rv.recordLocal(9);
  const raw = store.get('suvera:recently-viewed:v1');
  const parsed = JSON.parse(raw);
  assert.deepEqual(parsed.map((e) => e.id), [9, 42]);
  // Each entry is exactly {id, ts} — nothing else is stored.
  for (const entry of parsed) assert.deepEqual(Object.keys(entry).sort(), ['id', 'ts']);
});
