'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'size-guide.js'), 'utf8');

// Load the IIFE with fake DOM elements so it initializes and exposes SuveraSizeGuide.
function load() {
  const element = () => ({
    addEventListener() {}, querySelectorAll: () => [], setAttribute() {}, focus() {},
    classList: { toggle() {}, add() {}, remove() {} }, dataset: {}, hidden: false,
    textContent: '', appendChild() {},
  });
  const context = {
    window: {
      location: { search: '?id=1' },
      SuveraAPI: { catalog: {} }, // no sizeGuide -> init() returns early
      addEventListener() {},
    },
    document: {
      readyState: 'complete',
      getElementById: () => element(),
      createElement: () => element(),
      addEventListener() {},
    },
    URLSearchParams,
  };
  context.window.document = context.document;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.SuveraSizeGuide;
}

test('cm/inch conversion converts numbers, preserves ranges and non-numeric text', () => {
  const sg = load();
  assert.equal(sg.convert('90', 'cm', 'inch'), '35,4');
  assert.equal(sg.convert('35', 'inch', 'cm'), '88,9');
  assert.equal(sg.convert('90-94', 'cm', 'inch'), '35,4-37'); // range converts each end
  assert.equal(sg.convert('90', 'cm', 'cm'), '90'); // same unit is unchanged
  assert.equal(sg.convert('Tek beden', 'cm', 'inch'), 'Tek beden'); // no numbers to convert
  assert.equal(sg.convert(null, 'cm', 'inch'), ''); // null-safe
});
