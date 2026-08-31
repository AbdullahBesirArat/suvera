'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('catalog landing presents categories before collections without the old table editorial', () => {
  const template = read('urunler.html');
  const categoryIndex = template.indexOf('id="catalogDiscoveryCategories"');
  const collectionIndex = template.indexOf('id="catalogDiscoveryCollections"');

  assert.ok(categoryIndex > -1 && collectionIndex > categoryIndex);
  assert.match(template, /id="catalogDiscovery"[^>]*hidden/);
  assert.match(template, /Henüz kategori bulunmuyor\./);
  assert.doesNotMatch(template, /SUVERA KATALOG|editorial-panel|editorial-link|collection-editorial/);
});

test('discovery uses canonical APIs, real facet counts and semantic Turkish card links', () => {
  const source = read('js/storefront.js');
  const discovery = source.slice(
    source.indexOf('function discoveryFacetCount'),
    source.indexOf('function renderCatalogPagination')
  );
  const categoryCard = source.slice(
    source.indexOf('function discoveryCategoryCard'),
    source.indexOf('function discoveryCollectionCard')
  );
  const collectionCard = source.slice(
    source.indexOf('function discoveryCollectionCard'),
    source.indexOf('async function resolveDiscoveryFallbacks')
  );

  assert.match(discovery, /SuveraAPI\.categories\.list\(\)/);
  assert.match(discovery, /SuveraAPI\.collections\.list\(\)/);
  assert.match(discovery, /discoveryFacetCount\(facets\.categories, category\)/);
  assert.match(discovery, /discoveryFacetCount\(facets\.collections, collection\)/);
  assert.match(categoryCard, /<a class="discovery-card discovery-category-card"/);
  assert.match(categoryCard, /urunler\?category=/);
  assert.match(categoryCard, /kategorisini görüntüle/);
  assert.doesNotMatch(categoryCard, /category\.slug|category\.description/);
  assert.match(collectionCard, /collectionHref\(collection\)/);
  assert.match(collectionCard, /koleksiyonunu görüntüle/);
  assert.doesNotMatch(collectionCard, /collection\.slug|collection\.description/);
  assert.match(discovery, /event\.key !== ' '/);
  assert.match(discovery, /event\.preventDefault\(\);[\s\S]*?link\.click\(\)/);
});

test('missing discovery media uses deterministic active product membership fallback', () => {
  const source = read('js/storefront.js');
  const fallback = source.slice(
    source.indexOf('async function resolveDiscoveryFallbacks'),
    source.indexOf('async function renderCatalogDiscovery')
  );

  assert.match(fallback, /page: '1', pageSize: '1', sort: 'recommended', status: 'active'/);
  assert.match(fallback, /query\.set\(type,/);
  assert.match(fallback, /item\.discovery_image = product \? imageForColor\(product, ''\) : ''/);
  assert.doesNotMatch(fallback, /Math\.random|Date\.now|shuffle/);
});

test('discovery media and responsive grids reserve geometry without overflow', () => {
  const template = read('urunler.html');
  const renderer = read('js/storefront.js');

  assert.match(template, /\.discovery-card-media\{[^}]*aspect-ratio:4\/5/);
  assert.match(template, /\.discovery-collection-card \.discovery-card-media\{aspect-ratio:16\/10/);
  assert.match(template, /@media\(max-width:720px\)\{\.discovery-category-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(template, /\.discovery-category-grid\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(renderer, /responsiveImage\(resolved, 'card'\)/);
  assert.match(renderer, /loading="' \+ \(eager \? 'eager' : 'lazy'\)/);
  assert.match(renderer, /width="' \+ \(collection \? '1200' : '800'\)/);
  assert.match(renderer, /discoverySkeletonCards\(8, false\)/);
  assert.doesNotMatch(renderer, /Kategoriler yükleniyor|Suvera seçkileri hazırlanıyor/);
});
