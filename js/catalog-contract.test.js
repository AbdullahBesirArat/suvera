const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

test('catalog API client keeps the request same-origin and tenant-scoped', async () => {
  const requests = [];
  const context = {
    window: {},
    location: { hostname: 'shop.example' },
    URLSearchParams,
    FormData: class FormData {},
    Map,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  };
  vm.runInNewContext(read('js/api.js'), context);

  await context.window.SuveraAPI.catalog.search(new URLSearchParams({
    color: 'Mavi',
    page: '2',
  }));

  assert.equal(
    requests[0].url,
    '/api/catalog/products?color=Mavi&page=2&organizationSlug=suvera'
  );
  assert.equal(requests[0].options.credentials, 'same-origin');
});

test('collection renderer delegates canonical filtering, totals and pagination to the server', () => {
  const source = read('js/storefront.js');
  const renderer = source.slice(
    source.indexOf('async function renderCollectionPage()'),
    source.indexOf('window.addApiProductToCart')
  );

  assert.match(renderer, /SuveraAPI\.catalog\.search\(productQuery\)/);
  assert.match(renderer, /catalog\.facets/);
  assert.match(renderer, /catalog\.total/);
  assert.match(renderer, /catalog\.totalPages/);
  assert.doesNotMatch(renderer, /SuveraAPI\.products\.list/);
  assert.doesNotMatch(renderer, /productMatches|sortProducts|productBelongsToCollection/);
  assert.doesNotMatch(renderer, /collectionProducts\.filter|products\.filter/);
});

test('catalog URL state supports history, retry and accessible page changes', () => {
  const source = read('js/storefront.js');
  assert.match(source, /history\[replace \? 'replaceState' : 'pushState'\]/);
  assert.match(source, /addEventListener\('popstate'/);
  assert.match(source, /data-catalog-retry/);
  assert.match(source, /title\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /title\.scrollIntoView/);
  assert.match(source, /data-catalog-page/);

  const template = read('urunler.html');
  assert.match(template, /id="drawerSort"/);
  assert.match(template, /window\.SuveraCatalog\.updateQuery/);
  assert.match(template, /size: sizes\.join\(','\)/);
});
