'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const checkout = fs.readFileSync(path.join(root, 'siparis.html'), 'utf8');
const addressLoader = fs.readFileSync(path.join(root, 'js/address-loader.js'), 'utf8');

test('checkout has one canonical searchable province control', () => {
  assert.equal((checkout.match(/id="city"/g) || []).length, 1);
  assert.doesNotMatch(checkout, /id="citySearch"/);
  assert.match(checkout, /role="combobox"[^>]*aria-autocomplete="list"[^>]*aria-controls="cityOptions"/);
  assert.match(checkout, /id="cityOptions"[^>]*role="listbox"/);
  assert.match(checkout, /SuveraAddressData\.searchCities\(cityInput\.value\)/);
  assert.match(checkout, /event\.key === 'ArrowDown'/);
  assert.match(checkout, /event\.key === 'ArrowUp'/);
  assert.match(checkout, /event\.key === 'Enter'/);
  assert.match(checkout, /event\.key === 'Escape'/);
  assert.match(checkout, /\.combobox-option\{[^}]*min-height:44px/);
});

test('province state stays structured and resets district when edited', () => {
  assert.match(checkout, /selectedCityId = ''[\s\S]*?resetDistricts\(\)/);
  assert.match(checkout, /loadDistricts\(selectedCityId\)/);
  assert.match(checkout, /populateCities\(address\.city \|\| ''\)/);
  assert.match(checkout, /populateDistricts\(address\.district \|\| ''\)/);
  assert.doesNotMatch(checkout, /split\([^\n]*address[^\n]*city/i);
});

test('Turkish-insensitive address search reuses the canonical loader', () => {
  assert.match(addressLoader, /toLocaleLowerCase\('tr-TR'\)/);
  assert.match(addressLoader, /normalize\('NFD'\)/);
  assert.match(addressLoader, /replace\(\/ı\/g, 'i'\)/);
  assert.match(addressLoader, /normalizeTurkish\(city\.name\)\.includes\(normalized\)/);
});

test('checkout exposes only canonical bank transfer and never invents IBAN data', () => {
  const payment = checkout.slice(checkout.indexOf('id="paymentMethodTitle"'), checkout.indexOf('class="section gift-section"'));
  assert.match(payment, /value="iban" checked/);
  assert.match(payment, /Banka Havalesi \/ EFT/);
  assert.doesNotMatch(payment, /value="card"|Kart ile ödeme|3D Secure|Kart Saklama/);
  assert.match(checkout, /paymentMethod: 'iban'/);
  assert.match(checkout, /SuveraAPI\.orders\.create\(payload, idempotencyKey\)/);
  assert.doesNotMatch(checkout, /SuveraAPI\.payment\.initialize/);
  assert.match(checkout, /checkoutSettings\.iban/);
  assert.match(checkout, /IBAN_DATA_REQUIRED/);
  assert.doesNotMatch(checkout, /TR\d{2}(?:\s?\d{4}){5}/);
});

test('checkout header, stepper and summary are distinct normal-flow regions', () => {
  assert.equal((checkout.match(/>SUVERA<\/a>/g) || []).length, 1);
  assert.doesNotMatch(checkout, /summary-logo|class="steps"/);
  assert.match(checkout, /grid-template-areas:"header side" "progress side" "main side"/);
  assert.match(checkout, /\.checkout-header\{order:0/);
  assert.match(checkout, /\.order-progress-nav\{order:1/);
  assert.match(checkout, /\.checkout-side\{order:2/);
  assert.match(checkout, /\.checkout-main\{order:3/);
});
