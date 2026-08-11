'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { checkPerformanceBudget } = require('../scripts/check-performance-budget');

test('built storefront stays within deterministic JS/image budgets and route split policy', () => {
  const result = checkPerformanceBudget();
  assert.ok(result.globalBytes > 0);
  assert.ok(result.largestPage.bytes >= result.globalBytes);
  assert.ok(result.heroBytes > 0);
});
