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

function makeEnv({ subtle = true, subtleThrows = false, randomUUID = true, storageMode = 'ok' } = {}) {
  const store = new Map();
  const sessionStorage = {
    getItem: (name) => { if (storageMode === 'read-throws') throw new Error('blocked'); return store.has(name) ? store.get(name) : null; },
    setItem: (name, value) => { if (storageMode === 'write-throws') throw new Error('QuotaExceeded'); if (storageMode === 'write-dropped') return; store.set(name, String(value)); },
    removeItem: (name) => { store.delete(name); },
  };
  const crypto = {};
  if (randomUUID) crypto.randomUUID = () => webcrypto.randomUUID();
  if (subtle) crypto.subtle = subtleThrows ? { digest: async () => { throw new Error('boom ayse@example.com'); } } : webcrypto.subtle;
  const sandbox = { window: { crypto }, sessionStorage, TextEncoder, Array, Uint8Array, JSON, Object, Math, Date, Error, CHECKOUT_IDEMPOTENCY_KEY: 'suvera:checkout-idempotency:v1' };
  vm.createContext(sandbox);
  vm.runInContext(`${helpers}
this.keyFor = checkoutIdempotencyKey; this.clear = clearCheckoutIdempotencyKey;`, sandbox);
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

const PII = /ayse@example\.com|5551112233|Sokak 1|YAZ10|Kapida|1234567890/;

for (const [label, options] of Object.entries({
  'SubtleCrypto missing': { subtle: false },
  'SubtleCrypto throws (error echoes PII)': { subtleThrows: true },
})) {
  test(`fails closed with a PII-free error and writes nothing to storage when ${label}`, async () => {
    const { keyFor, store } = makeEnv(options);
    const payload = basePayload();
    payload.invoice.vkn = '1234567890';
    await assert.rejects(() => keyFor(payload, gift), (error) => {
      assert.equal(error.code, 'CHECKOUT_CRYPTO_UNAVAILABLE');
      assert.doesNotMatch(String(error.message) + String(error.stack || ''), PII);
      return true;
    });
    assert.equal(store.size, 0);
  });
}

test('fails closed instead of using a guessable key when secure randomness is missing', async () => {
  const { keyFor, store } = makeEnv({ randomUUID: false });
  await assert.rejects(() => keyFor(basePayload(), gift), (error) => error.code === 'CHECKOUT_CRYPTO_UNAVAILABLE');
  assert.equal(store.size, 0);
  assert.doesNotMatch(helpers, /Math\.random|Date\.now/);
  assert.doesNotMatch(helpers, /'raw:'/);
});

for (const mode of ['read-throws', 'write-throws', 'write-dropped']) {
  test(`fails closed (no key, nothing stored) when sessionStorage is unusable: ${mode}`, async () => {
    const { keyFor, store } = makeEnv({ storageMode: mode });
    await assert.rejects(() => keyFor(basePayload(), gift), (error) => {
      assert.equal(error.code, 'CHECKOUT_STORAGE_UNAVAILABLE');
      assert.doesNotMatch(String(error.message) + String(error.stack || ''), PII);
      return true;
    });
    assert.equal(store.size, 0);
  });
}

test('a corrupt stored entry is replaced by a fresh persisted key', async () => {
  const { keyFor, store } = makeEnv();
  store.set('suvera:checkout-idempotency:v1', '{not json');
  const key = await keyFor(basePayload(), gift);
  assert.match(key, /^[0-9a-f-]{36}$/);
  assert.equal(await keyFor(basePayload(), gift), key);
});

test('retry scenarios: timeout keeps the key, success clears it, the next order is new', async () => {
  const { keyFor, clear, store } = makeEnv();
  const first = await keyFor(basePayload(), gift);   // submit; response lost (timeout)
  assert.equal(store.size, 1);
  assert.equal(await keyFor(basePayload(), gift), first); // user retries
  assert.equal(await keyFor(basePayload(), gift), first); // and again
  clear();                                                // success path
  assert.equal(store.size, 0);
  assert.notEqual(await keyFor(basePayload(), gift), first); // next order
});

test('the key is resolved inside the try block BEFORE the order request, so a storage failure never creates an order', () => {
  const keyAt = html.indexOf('const idempotencyKey = await checkoutIdempotencyKey(payload, {');
  const createAt = html.indexOf('SuveraAPI.orders.create(payload, idempotencyKey)');
  const tryAt = html.lastIndexOf('try {', keyAt);
  const catchAt = html.indexOf("console.error('Checkout order creation failed:'");
  assert.ok(tryAt > 0 && tryAt < keyAt && keyAt < createAt && createAt < catchAt);
  const messageFn = html.slice(html.indexOf('function getCheckoutErrorMessage'), html.indexOf('function getCheckoutErrorMessage') + 1200);
  assert.match(messageFn, /CHECKOUT_STORAGE_UNAVAILABLE[\s\S]*siparişiniz oluşturulmadı/);
  assert.doesNotMatch(helpers.slice(0, helpers.indexOf('function clearCheckoutIdempotencyKey')), /catch \(_\) \{\}/);
});

test('storage never contains customer data across a full request lifecycle', async () => {
  const { keyFor, store } = makeEnv();
  const payload = basePayload();
  payload.invoice.vkn = '1234567890';
  await keyFor(payload, gift);
  payload.note = 'Kapida degisti';
  await keyFor(payload, gift);
  assert.doesNotMatch([...store.values()].join(''), PII);
});

test('the submit handler shows a Turkish message for the crypto failure and logs no payload', () => {
  const messageFn = html.slice(html.indexOf('function getCheckoutErrorMessage'), html.indexOf('function getCheckoutErrorMessage') + 700);
  assert.match(messageFn, /CHECKOUT_CRYPTO_UNAVAILABLE[\s\S]*Güvenli sipariş doğrulaması/);
  const logLine = html.match(/console\.error\('Checkout order creation failed:'[^\n]*/)[0];
  assert.doesNotMatch(logLine, /payload|snapshot|\berr\)/);
  assert.doesNotMatch(helpers, /console\./);
});

test('the submit handler passes the gift selection and awaits the async key', () => {
  assert.match(html, /const idempotencyKey = await checkoutIdempotencyKey\(payload, \{/);
  assert.match(html, /SuveraAPI\.orders\.create\(payload, idempotencyKey\)/);
});
