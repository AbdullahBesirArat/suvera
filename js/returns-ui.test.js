const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function source(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

test('account page exposes the authenticated return and exchange form', () => {
  const html = source('hesabim.html');
  for (const id of ['returnRequestForm', 'returnOrder', 'returnType', 'returnItems', 'returnReason', 'accountReturns']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /value="return"/);
  assert.match(html, /value="exchange"/);
  assert.match(html, /value="cancellation"/);
});

test('storefront return client remains same-origin and uses customer routes', () => {
  const api = source('js/api.js');
  assert.match(api, /const API_BASE = window\.PANELYA_API_BASE \|\| window\.SUVERA_API_BASE \|\| '\/api'/);
  assert.match(api, /customerRequest\('\/returns\/customer\?/);
  assert.match(api, /customerRequest\('\/returns\/customer\/'/);
  assert.match(api, /customerRequest\('\/returns\/customer', \{/);
  assert.match(api, /credentials: 'same-origin'/);
});

test('customer return UI never renders internal notes', () => {
  const ui = source('js/site-pages.js');
  assert.doesNotMatch(ui, /internal_note|internalNote/);
  assert.match(ui, /api\.returns\.create/);
  assert.match(ui, /data-return-quantity/);
});

test('checkout separates delivery and invoice profiles without storing identity locally', () => {
  const checkout = source('siparis.html');
  for (const id of ['invoiceType', 'invoiceFullName', 'invoiceLegalName', 'invoiceVkn', 'invoiceTaxOffice', 'invoiceSameShipping', 'invoiceAddress', 'invoiceEmail']) {
    assert.match(checkout, new RegExp(`id=["']${id}["']`));
  }
  assert.match(checkout, /invoice:\s*\{/);
  assert.match(checkout, /invoice_address:/);
  assert.doesNotMatch(checkout, /localStorage\.(?:setItem|getItem)\([^\n]*(?:invoiceVkn|tckn|vkn)/i);
});
