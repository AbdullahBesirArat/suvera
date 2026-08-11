'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadCollector() {
  const listeners = new Map();
  const window = {
    location: { pathname: '/urun/928?token=secret' },
    addEventListener(type, listener) { listeners.set(type, listener); },
    SUVERA_BUILD_VERSION: 'abc123',
  };
  const context = {
    window,
    document: {
      documentElement: { dataset: {} },
      addEventListener() {},
      visibilityState: 'visible',
    },
    localStorage: { getItem: () => null },
    performance: { getEntriesByType: () => [] },
    navigator: {},
    fetch: async () => ({ ok: true }),
    Blob,
    PerformanceObserver: class {},
    URL,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'analytics.js'), 'utf8'), context);
  return window.SuveraWebVitals;
}

test('RUM sampling accepts bounded fractions/percentages and is deterministic', () => {
  const collector = loadCollector();
  assert.equal(collector.sampleRate(0), 0);
  assert.equal(collector.sampleRate('0.25'), 0.25);
  assert.equal(collector.sampleRate(25), 0.25);
  assert.equal(collector.sampleRate(101), 0.1);
  assert.equal(collector.shouldSample(0.25, () => 0.2), true);
  assert.equal(collector.shouldSample(0.25, () => 0.3), false);
});

test('Web Vitals payload is allowlisted, bounded and strips high-cardinality route data', () => {
  const collector = loadCollector();
  const payload = collector.metricPayload('LCP', 1234.5678, {
    pathname: '/urun/928?email=person@example.com&token=secret',
    navigationType: 'reload',
    build: 'release-32',
  });
  assert.deepEqual({ ...payload }, {
    name: 'LCP', value: 1234.568, route: '/urun', navigationType: 'reload', build: 'release-32',
  });
  assert.doesNotMatch(JSON.stringify(payload), /person@|token|928|secret/);
  assert.equal(collector.metricPayload('FID', 20), null);
  assert.equal(collector.metricPayload('CLS', Number.NaN), null);
  assert.equal(collector.metricPayload('CLS', 11), null);
  assert.equal(collector.normalizeRoute('/orders/123/private'), '/diger');
});
