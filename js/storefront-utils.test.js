const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const moduleSource = fs.readFileSync(path.join(__dirname, 'core', 'storefront-utils.js'), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`;

test('shared storefront utilities keep money, text and HTTP URL behavior canonical', async () => {
  const { escapeHtml, formatMoney, safeHttpUrl } = await import(moduleUrl);

  assert.equal(formatMoney(1499.5), '1.499,50 TL');
  assert.equal(escapeHtml('<script>"x"</script>'), '&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
  assert.equal(safeHttpUrl('/tesekkur', 'https://suvera.example/siparis'), 'https://suvera.example/tesekkur');
  assert.equal(safeHttpUrl('javascript:alert(1)', 'https://suvera.example/siparis'), '');
  assert.equal(safeHttpUrl('data:text/html,test', 'https://suvera.example/siparis'), '');
});

test('product galleries combine the selected color hero with every general image', async () => {
  const { defaultProductColor, productGalleryEntries } = await import(moduleUrl);
  const product = {
    colors: ['Gül Kurusu #9a626a', 'Lacivert #243f8f'],
    images: [
      'Lacivert #243f8f | /media/navy',
      'Gül Kurusu #9a626a | /media/rose',
      '/media/detail',
      '/media/lifestyle',
    ],
  };

  assert.equal(defaultProductColor(product), 'Lacivert #243f8f');
  assert.deepEqual(
    productGalleryEntries(product, 'Lacivert #243f8f').map((entry) => entry.url),
    ['/media/navy', '/media/detail', '/media/lifestyle']
  );
  assert.deepEqual(
    productGalleryEntries(product, 'Gül Kurusu #9a626a').map((entry) => entry.url),
    ['/media/rose', '/media/detail', '/media/lifestyle']
  );
});

test('sold-out colors remain selectable while availability stays false', async () => {
  const { productColorOptions } = await import(moduleUrl);
  const product = {
    colors: ['Gül Kurusu #9a626a', 'Lacivert #243f8f'],
    variants: [
      { color: 'Gül Kurusu #9a626a', size: 'S/M', stock: 0, status: 'out' },
      { color: 'Lacivert #243f8f', size: 'S/M', stock: 0, status: 'out' },
    ],
  };

  assert.deepEqual(productColorOptions(product), [
    { value: 'Gül Kurusu #9a626a', inStock: false, selectable: true },
    { value: 'Lacivert #243f8f', inStock: false, selectable: true },
  ]);
});

test('measurement presentation only accepts explicit measurement data', async () => {
  const { explicitMeasurementLines, productSizeLabels } = await import(moduleUrl);
  const editorial = {
    description: 'Kuşaklı bel ve uzun kol detayıyla dökümlü bir ürün.',
    product_story: 'Şehir stilini tamamlayan editorial ürün hikayesi.',
    details: { measurements: '', fabric_info: '', delivery_note: '' },
    sizes: ['S/M', 'L/XL'],
  };

  assert.deepEqual(explicitMeasurementLines(editorial), []);
  assert.deepEqual(productSizeLabels(editorial), ['S/M', 'L/XL']);
  assert.deepEqual(explicitMeasurementLines({ details: { measurements: 'Göğüs: 104 cm\nUzunluk: 132 cm' } }), [
    'Göğüs: 104 cm',
    'Uzunluk: 132 cm',
  ]);
});

test('product detail renderer separates color exploration from purchase availability', () => {
  const detailSource = fs.readFileSync(path.join(__dirname, 'product-detail.js'), 'utf8');

  assert.match(detailSource, /const colorOptions = productColorOptions\(product\)/);
  assert.doesNotMatch(detailSource, /option\.inStock[^\n]+disabled/);
  assert.match(detailSource, /addButton\.disabled = addingToCart \|\| !\(active && stock > 0\)/);
  assert.match(detailSource, /buyButton\.disabled = addingToCart \|\| !\(active && stock > 0\)/);
  assert.doesNotMatch(detailSource, /measurementLines\(text\)/);
});
