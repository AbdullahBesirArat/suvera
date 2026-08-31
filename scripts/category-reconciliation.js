'use strict';

function normalizeCategoryName(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i');
}

function buildCategoryReconciliation({ products = [], categories = [], receipts = [] } = {}) {
  const categoryByName = new Map(categories.map((category) => [normalizeCategoryName(category.name), category]));
  const categoryIds = new Set(categories.map((category) => String(category.id)));
  const receiptsByProduct = new Map();

  receipts.forEach((receipt) => {
    const productId = String(receipt.productId || '');
    if (!productId || !receipt.category) return;
    const list = receiptsByProduct.get(productId) || [];
    list.push(receipt);
    receiptsByProduct.set(productId, list);
  });

  const activeProducts = products.filter((product) => String(product.status || '').toLowerCase() === 'active');
  const audit = activeProducts.map((product) => {
    const productId = String(product.id);
    const currentCategoryId = product.category_id == null ? '' : String(product.category_id);
    const productReceipts = receiptsByProduct.get(productId) || [];
    const explicitNames = [...new Set(productReceipts.map((receipt) => normalizeCategoryName(receipt.category)).filter(Boolean))];
    const base = {
      productId: product.id,
      productName: product.name || '',
      status: product.status,
      previousCategoryId: currentCategoryId || null,
      currentCategoryValid: Boolean(currentCategoryId && categoryIds.has(currentCategoryId)),
      evidence: productReceipts.map((receipt) => ({ category: receipt.category, sourceFolder: receipt.sourceFolder || null })),
    };

    if (!explicitNames.length) return { ...base, decision: 'skip', reason: 'NO_EXPLICIT_EVIDENCE' };
    if (explicitNames.length > 1) return { ...base, decision: 'skip', reason: 'CATEGORY_REVIEW_REQUIRED' };

    const targetCategory = categoryByName.get(explicitNames[0]);
    if (!targetCategory) return { ...base, decision: 'skip', reason: 'CATEGORY_REVIEW_REQUIRED' };
    if (String(targetCategory.id) === currentCategoryId) {
      return { ...base, decision: 'keep', targetCategoryId: targetCategory.id, targetCategoryName: targetCategory.name };
    }
    return {
      ...base,
      decision: 'assign',
      targetCategoryId: targetCategory.id,
      targetCategoryName: targetCategory.name,
      changedFields: ['category_id'],
    };
  });

  return {
    audit,
    assignments: audit.filter((row) => row.decision === 'assign'),
    reviewRequired: audit.filter((row) => row.reason === 'CATEGORY_REVIEW_REQUIRED'),
    summary: {
      active: activeProducts.length,
      categorized: activeProducts.filter((product) => product.category_id != null && categoryIds.has(String(product.category_id))).length,
      uncategorized: activeProducts.filter((product) => product.category_id == null).length,
      invalidCategory: activeProducts.filter((product) => product.category_id != null && !categoryIds.has(String(product.category_id))).length,
    },
  };
}

module.exports = { buildCategoryReconciliation, normalizeCategoryName };
