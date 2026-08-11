'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'comparison.js'), 'utf8');

function load({ store = new Map(), signedIn = false } = {}) {
  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  const element = () => ({ addEventListener() {}, setAttribute() {}, textContent: "", hidden: false, closest: () => null, appendChild() {}, dataset: {} });
  const context = {
    window: {
      localStorage,
      location: { search: "" },
      SuveraAPI: { hasCustomerSession: () => signedIn },
      addEventListener() {},
      history: { replaceState() {} },
    },
    document: { readyState: "complete", getElementById: () => element(), createElement: () => element(), addEventListener() {} },
    URLSearchParams,
  };
  context.window.document = context.document;
  vm.createContext(context);
  vm.runInContext(source, context);
  return { cmp: context.window.SuveraComparison, store };
}

test('parseIds dedupes, drops invalid ids and caps at MAX', () => {
  const { cmp } = load();
  assert.deepEqual(Array.from(cmp.parseIds('3,3,5,x,-1,7,9,11')), [3, 5, 7, 9]); // MAX = 4
});

test('add appends up to MAX, dedupes; remove drops; storage holds only ids', async () => {
  const { cmp, store } = load();
  await cmp.add(5);
  await cmp.add(7);
  await cmp.add(5); // duplicate ignored
  assert.deepEqual(Array.from(cmp.readLocal()), [5, 7]);
  await cmp.add(9);
  await cmp.add(11);
  await cmp.add(13); // exceeds MAX = 4, ignored
  assert.deepEqual(Array.from(cmp.readLocal()), [5, 7, 9, 11]);
  await cmp.remove(7);
  assert.deepEqual(Array.from(cmp.readLocal()), [5, 9, 11]);
  assert.deepEqual(JSON.parse(store.get('suvera:comparison:v1')), [5, 9, 11]);
});
