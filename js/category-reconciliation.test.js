'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildCategoryReconciliation } = require('../scripts/category-reconciliation');

const categories = [
  { id: 20, name: 'Elbise' },
  { id: 25, name: 'Kap' },
];

test('reconciliation audits uncategorized ACTIVE products and plans only explicit receipt assignments', () => {
  const result = buildCategoryReconciliation({
    categories,
    products: [
      { id: 1, name: 'Receipt product', status: 'active', category_id: null },
      { id: 2, name: 'Legacy product', status: 'active', category_id: null },
      { id: 3, name: 'Draft', status: 'draft', category_id: null },
    ],
    receipts: [{ productId: 1, category: 'Elbise', sourceFolder: '001-explicit' }],
  });

  assert.deepEqual(result.summary, { active: 2, categorized: 0, uncategorized: 2, invalidCategory: 0 });
  assert.equal(result.assignments.length, 1);
  assert.deepEqual(result.assignments[0].changedFields, ['category_id']);
  assert.equal(result.assignments[0].targetCategoryId, 20);
  assert.equal(result.audit.find((row) => row.productId === 2).reason, 'NO_EXPLICIT_EVIDENCE');
});

test('reconciliation preserves matching explicit categories and does not mutate ambiguous evidence', () => {
  const result = buildCategoryReconciliation({
    categories,
    products: [
      { id: 1, name: 'Correct', status: 'active', category_id: 25 },
      { id: 2, name: 'Ambiguous', status: 'active', category_id: null },
    ],
    receipts: [
      { productId: 1, category: 'kap' },
      { productId: 2, category: 'Kap' },
      { productId: 2, category: 'Elbise' },
    ],
  });

  assert.equal(result.audit.find((row) => row.productId === 1).decision, 'keep');
  assert.equal(result.audit.find((row) => row.productId === 2).reason, 'CATEGORY_REVIEW_REQUIRED');
  assert.equal(result.assignments.length, 0);
  assert.equal(result.reviewRequired.length, 1);
});
