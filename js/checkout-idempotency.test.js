'use strict';

// Behavioural tests for the checkout Idempotency-Key. The functions live inline in siparis.html,
// so they are extracted from the shipped source and run against a fake browser environment.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'siparis.html'), 'utf8');
const start = html.indexOf('function canonicalJson(');
assert.ok(start > 0 && html.includes('function clearCheckoutIdempotencyKey()'), 'idempotency helpers must exist in siparis.html');
const helpers = html.slice(start, html.indexOf('function orderCodeFromResult'));

function makeEnv({ subtle = true } = {}) {
  const store = new Map();
  const sessionStorage = {
    getItem: (name) => (store.has(name) ? store.get(name) : null),
    setItem: (name, value) => { store.set(name, String(value)); },
    removeItem: (name) => { store.delete(name); },
  };
  const crypto = subtle ? webcrypto : { randomUUID: () => webcrypto.randomUUID() };
  const sandbox = { window: { crypto }, sessionStorage, TextEncoder, Array, Uint8Array, JSON, Object, Math, Date, CHECKOUT_IDEMPOTENCY_KEY: 'suvera:checkout-idempotency:v1' };
  sandbox.window.sessionStorage = sessionStorage;
  vm.createContext(sandbox);
  vm.runInContext(`${helpers}\nthis.keyFor = checkoutIdempotencyKey; this.clear = clearCheckoutIdempotencyKey;`, sandbox);
  return { keyFor: sandbox.keyFor, clear: sandbox.clear, store };
}

const gift = { gift: { option_id: null, note: '' } };
function basePayload() {
  return {
    customer: { name: 'Ayse Yilmaz', email: 'ayse@example.com', phone: '+905551112233', address: 'Sokak 1 / Kadikoy / Istanbul', city: 'Istanbul', district: 'Kadikoy', country: 'TR' },
    items: [{ product_id: 'p1', variant_id: 'v1', quantity: 2 }, { product_id: 'p2', variant_id: null, quantity: 1 }],
    cart_id: 'cart-1',
    cart_version: 7,
    shipping_fee: 49.9,
    paymentMethod: 'iban',
    invoice: { type: 'individual', full_name: 'Ayse Yilmaz', legal_name: '', vkn: '', tax_office: '', invoice_address: 'Sokak 1 / Kadikoy / Istanbul', email: 'ayse@example.com' },
    note: 'Kapida birakin',
    couponCode: 'YAZ10',
  };
}

test('same payload gives the same key, regardless of property insertion order', async () => {
  const { keyFor } = makeEnv();
  const a = await keyFor(basePayload(), gift);
  const b = await keyFor(basePayload(), gift);
  const reordered = basePayload();
  const shuffled = { couponCode: reordered.couponCode, note: reordered.note, invoice: reordered.invoice, paymentMethod: reordered.paymentMethod, shipping_fee: reordered.shipping_fee, cart_version: reordered.cart_version, cart_id: reordered.cart_id, items: reordered.items, customer: { country: 'TR', district: reordered.customer.district, city: reordered.customer.city, address: reordered.customer.address, phone: reordered.customer.phone, email: reordered.customer.email, name: reordered.customer.name } };
  assert.equal(a, b);
  assert.equal(await keyFor(shuffled, gift), a);
});

test('a retry after a timeout/error reuses the key (nothing clears it on failure)', async () => {
  const { keyFor, store } = makeEnv();
  const first = await keyFor(basePayload(), gift);
  assert.equal(store.size, 1); // persisted, so a reload or retry keeps it
  const retry = await keyFor(basePayload(), gift);
  assert.equal(retry, first);
  // the failure branch of the submit handler must not clear the key
  const catchBlock = html.slice(html.indexOf("console.error('Checkout order creation failed:'"), html.indexOf("payButton.textContent = 'Siparişi Tamamla'"));
  assert.doesNotMatch(catchBlock, /clearCheckoutIdempotencyKey/);
});

const MUTATIONS = {
  'coupon changed': (p) => { p.couponCode = 'KIS20'; },
  'coupon removed': (p) => { delete p.couponCode; },
  'order note changed': (p) => { p.note = 'Zili calmayin'; },
  'order note removed': (p) => { delete p.note; },
  'invoice type changed': (p) => { p.invoice.type = 'company'; },
  'invoice VKN changed': (p) => { p.invoice.vkn = '1234567890'; },
  'invoice legal name changed': (p) => { p.invoice.legal_name = 'Acme AS'; },
  'invoice tax office changed': (p) => { p.invoice.tax_office = 'Kadikoy VD'; },
  'invoice address changed': (p) => { p.invoice.invoice_address = 'Baska adres'; },
  'invoice email changed': (p) => { p.invoice.email = 'muhasebe@example.com'; },
  'customer name changed': (p) => { p.customer.name = 'Fatma Demir'; },
  'customer email changed': (p) => { p.customer.email = 'fatma@example.com'; },
  'customer phone changed': (p) => { p.customer.phone = '+905559998877'; },
  'address changed': (p) => { p.customer.address = 'Yeni Sokak 5 / Besiktas / Istanbul'; },
  'city changed': (p) => { p.customer.city = 'Ankara'; },
  'district changed': (p) => { p.customer.district = 'Cankaya'; },
  'shipping fee changed': (p) => { p.shipping_fee = 0; },
  'cart id changed': (p) => { p.cart_id = 'cart-2'; },
  'cart version changed': (p) => { p.cart_version = 8; },
  'item quantity changed': (p) => { p.items[0].quantity = 3; },
  'item variant changed': (p) => { p.items[0].variant_id = 'v9'; },
  'item added': (p) => { p.items.push({ product_id: 'p3', variant_id: null, quantity: 1 }); },
  'item order changed': (p) => { p.items.reverse(); },
  'payment method changed': (p) => { p.paymentMethod = 'card'; },
};

for (const [label, mutate] of Object.entries(MUTATIONS)) {
  test(`new key when ${label}`, async () => {
    const { keyFor } = makeEnv();
    const original = await keyFor(basePayload(), gift);
    const changed = basePayload();
    mutate(changed);
    const next = await keyFor(changed, gift);
    assert.notEqual(next, original);
  });
}

test('new key when the server-side gift selection or gift note changes', async () => {
  const { keyFor } = makeEnv();
  const original = await keyFor(basePayload(), gift);
  assert.notEqual(await keyFor(basePayload(), { gift: { option_id: 'gw-1', note: '' } }), original);
  assert.notEqual(await keyFor(basePayload(), { gift: { option_id: null, note: 'Iyi ki dogdun' } }), original);
});

test('editing back to the original request restores nothing stale: the stored key follows the latest request', async () => {
  const { keyFor } = makeEnv();
  const original = await keyFor(basePayload(), gift);
  const edited = basePayload();
  edited.note = 'degisti';
  const editedKey = await keyFor(edited, gift);
  assert.notEqual(editedKey, original);
  assert.equal(await keyFor(edited, gift), editedKey);
});

test('successful checkout clears the stored key and the next order gets a new key', async () => {
  const { keyFor, clear, store } = makeEnv();
  const first = await keyFor(basePayload(), gift);
  assert.equal(store.size, 1);
  clear(); // what the success path does
  assert.equal(store.size, 0);
  const second = await keyFor(basePayload(), gift);
  assert.notEqual(second, first);
  const successBlock = html.slice(html.indexOf('window.Suvera.recordOrder(savedOrder)'), html.indexOf("window.location.href = 'tesekkur?order='"));
  assert.match(successBlock, /clearCheckoutIdempotencyKey\(\);/);
});

test('sessionStorage holds a digest, not customer data, when SubtleCrypto is available', async () => {
  const { keyFor, store } = makeEnv();
  await keyFor(basePayload(), gift);
  const raw = [...store.values()].join('');
  assert.match(raw, /"fingerprint":"sha256:[0-9a-f]{64}"/);
  assert.doesNotMatch(raw, /ayse@example\.com|5551112233|Sokak 1/);
});

test('without SubtleCrypto the exact canonical text still separates different requests', async () => {
  const { keyFor } = makeEnv({ subtle: false });
  const a = await keyFor(basePayload(), gift);
  assert.equal(await keyFor(basePayload(), gift), a);
  const changed = basePayload();
  changed.couponCode = 'BASKA';
  assert.notEqual(await keyFor(changed, gift), a);
});

test('the submit handler passes the gift selection and awaits the async key', () => {
  assert.match(html, /const idempotencyKey = await checkoutIdempotencyKey\(payload, \{/);
  assert.match(html, /SuveraAPI\.orders\.create\(payload, idempotencyKey\)/);
});
