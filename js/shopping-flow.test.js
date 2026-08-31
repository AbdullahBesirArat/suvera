'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('category results suppress editorial and duplicate featured products', () => {
  const template = read('urunler.html');
  const renderer = read('js/storefront.js');
  assert.doesNotMatch(template, /id="featuredProductsStrip"|id="featuredProductsLabel"/);
  assert.match(renderer, /collectionEditorial\.hidden = Boolean\(selectedCategoryId\)/);
  assert.doesNotMatch(renderer, /renderFeaturedStrip\(document\.getElementById\('featuredProductsStrip'\)/);
  assert.match(template, /id="collectionTitle"[\s\S]*?id="prodsGrid"/);
});

test('favorites put the product grid directly after a compact title and use Turkish labels', () => {
  const template = read('favoriler.html');
  const renderer = read('js/site-pages.js');
  assert.match(template, /<h1>Favoriler<\/h1>[\s\S]*?id="favoritesGrid"/);
  assert.doesNotMatch(template, /Wishlist|Kısa Yol|Kisa Yol|page-hero/);
  assert.match(renderer, /Henüz favori ürününüz yok/);
  assert.match(renderer, />ÜRÜNÜ AÇ<\/a>/);
  assert.doesNotMatch(renderer, /Urunu Ac/);
});

test('cart contains only real items, note and non-empty summary surfaces', () => {
  const template = read('sepet.html');
  for (const forbidden of [
    'Sepet Özeti', 'Sepette Ayrıcalık', 'Kargo Avantajı', 'Hediye Paketi',
    'giftAddBtn', 'cartCouponCode', 'Kupon checkout sırasında', '-0,00 TL',
  ]) assert.doesNotMatch(template, new RegExp(forbidden));
  assert.match(template, /id="cartItems"[\s\S]*?id="cartOrderNoteCard"[\s\S]*?id="cartSummaryCard"/);
  assert.match(template, /id="cartSummaryCard" hidden/);
  assert.match(template, /\.cart-list-head\[hidden\],\.section-stack\[hidden\],\.checkout-card\[hidden\]\{display:none\}/);
  assert.match(template, /<h3>Sepetiniz boş\.<\/h3>[\s\S]*?>Ürünleri Keşfet<\/a>/);

  const renderer = read('js/cart-ui.js');
  assert.match(renderer, /summaryCard\.hidden = !list\.length/);
  assert.match(renderer, /orderNoteCard\.hidden = !list\.length/);
  assert.match(renderer, /Sepetiniz boş\./);
  assert.match(renderer, /Ürünleri Keşfet/);
});

test('versioned consent exposes every real category and a persistent settings entry point', () => {
  const partial = read('templates/partials/consent.html');
  const controller = read('js/consent.js');
  const footer = read('templates/partials/footer.html');
  const policy = read('cerez-politikasi.html');

  assert.match(controller, /CONSENT_VERSION=1/);
  assert.match(controller, /necessary:true/);
  assert.match(controller, /preferences:/);
  assert.match(controller, /analytics:/);
  assert.match(controller, /marketing:false/);
  assert.match(controller, /updatedAt:/);
  assert.match(controller, /localStorage\.setItem\(CONSENT_KEY,\s*JSON\.stringify\(consent\)\)/);
  assert.match(partial, /Tümünü Kabul Et/);
  assert.match(partial, /Yalnızca Zorunlu/);
  assert.match(partial, /Tercihleri Yönet/);
  assert.match(partial, /Şu anda kullanılmıyor/);
  assert.match(footer, /data-consent-action="open-settings"/);
  assert.match(policy, /Web Vitals/);
  assert.doesNotMatch(policy, /_ga|Google Analytics|Meta Pixel|Facebook Pixel/);
});

test('optional browser storage and analytics respect the saved consent', () => {
  assert.match(read('js/recently-viewed.js'), /SuveraConsent\.allows\('preferences'\)/);
  assert.match(read('js/comparison.js'), /SuveraConsent\.allows\('preferences'\)/);
  assert.match(read('js/analytics.js'), /saved\.analytics === true/);
});
