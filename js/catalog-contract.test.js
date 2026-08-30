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

test('catalog results own their vertical flow and initial HTML contains no demo products', () => {
  const template = read('urunler.html');
  assert.match(template, /\.page-wrap\{position:relative;display:block;min-height:0;/);
  assert.match(template, /\.sidebar-column\{position:absolute;/);
  assert.match(template, /@media\(max-width:1024px\)[\s\S]*?\.sidebar-column\{display:none;/);
  assert.match(template, /\.content\{[^}]*margin-left:230px/);
  assert.match(template, /\.pagination:empty\{display:none;margin:0;/);
  assert.match(template, /id="prodsGrid" aria-busy="true"><\/div>/);
  assert.doesNotMatch(template, /Seçki hazırlanıyor|Koleksiyonlar yükleniyor|Öne çıkan ürünler yükleniyor/);
  assert.doesNotMatch(template, /class="prod-card"|class="prod-emoji"|🧕|🥻/);
  const customerLoadingSources = [
    template, read('sepet.html'), read('siparis.html'), read('shared.js'),
    read('js/storefront.js'), read('js/product-detail.js'), read('js/cart-ui.js'),
  ].join('\n');
  assert.doesNotMatch(customerLoadingSources, /🧕|🥻|👘|🧣|👗/);
});

test('loaded catalog cards beyond the eighth stagger child remain visible in normal flow', () => {
  const styles = read('shared.css');
  const revealedChildrenRule = styles.match(/\.stagger-children\.show\s*>\s*\*\s*\{([^}]*)\}/);

  assert.ok(revealedChildrenRule, 'the reveal state must apply to every staggered child');
  assert.match(revealedChildrenRule[1], /opacity\s*:\s*1/);
  assert.match(revealedChildrenRule[1], /transform\s*:\s*none/);

  const template = read('urunler.html');
  assert.match(template, /class="prods-grid stagger-children" id="prodsGrid"/);
  assert.match(template, /id="collectionPagination"><\/div>/);
});

test('managed hero preserves portrait garments on desktop and keeps mobile framing intentional', () => {
  const styles = read('css/home.css');
  assert.match(styles, /\.theme-hero \.slide-bg-image\{[^}]*object-fit:contain;[^}]*object-position:right center/);
  assert.match(styles, /@media\(max-width:47\.99rem\)[\s\S]*?\.theme-hero \.slide-bg-image\{[^}]*object-fit:cover;[^}]*object-position:68% center/);
  const template = read('index.html');
  assert.doesNotMatch(template, /url\(['"]assets\//);
  assert.doesNotMatch(template, /suvera-istanbul-editorial\.png/);
});

test('mobile swipe uses one pointer contract without hijacking vertical scroll', () => {
  const shared = read('shared.js');
  assert.match(shared, /function bindHorizontalSwipe\(element, onSwipe, options\)/);
  assert.match(shared, /event\.pointerType === 'mouse'/);
  assert.match(shared, /Math\.abs\(dx\) < threshold \|\| Math\.abs\(dx\) <= Math\.abs\(dy\) \* dominance/);
  assert.match(shared, /onSwipe\(dx < 0 \? 1 : -1, event\)/);
  assert.match(shared, /if \(!suppressClick\) return;[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\)/);

  const homepage = read('index.html');
  assert.match(homepage, /bindHorizontalSwipe\(slider, dir => window\.changeSlide\(dir\)\)/);
  assert.doesNotMatch(homepage, /addEventListener\('touchstart'/);
  assert.match(read('css/home.css'), /\.hero-slider\{[^}]*touch-action:pan-y/);
  assert.match(read('css/home.css'), /\.home-product-rail\{[^}]*grid-template-columns:none!important;[^}]*grid-auto-flow:column!important;[^}]*grid-auto-columns:minmax\(66vw,1fr\)!important/);

  const product = read('js/product-detail.js');
  assert.match(product, /bindHorizontalSwipe\(mainMedia/);
  assert.match(product, /bindHorizontalSwipe\(stage/);
  assert.match(read('urun.html'), /\.main-media\{[^}]*touch-action:pan-y/);
  assert.match(read('urun.html'), /\.image-lightbox-stage\{[^}]*touch-action:pan-y/);
});

test('product cards keep actions in the media overlay and remove quick add presentation', () => {
  const renderer = read('js/storefront.js');
  const card = renderer.slice(renderer.indexOf('function productCard'), renderer.indexOf('function slideMarkup'));
  assert.match(card, /class="prod-media-actions"/);
  assert.match(card, /aria-label="Favorilere ekle"/);
  assert.match(card, /aria-label="Ürünü hızlı görüntüle"/);
  assert.doesNotMatch(card, /quick-add|Hızlı Ekle/);

  const styles = read('shared.css');
  assert.match(styles, /\.prod-media-actions \{[\s\S]*?position:absolute; top:12px; right:12px/);
  assert.match(styles, /\.prod-media-actions \.quick-fav,[\s\S]*?width:44px; height:44px/);
  assert.match(styles, /\.mobile-bottom-nav \{[\s\S]*?bottom: 0 !important;/);
  assert.match(styles, /padding: 6px 10px calc\(6px \+ env\(safe-area-inset-bottom\)\)/);
});

test('store profile uses canonical settings without fake social or contact fallbacks', () => {
  const source = read('js/store-profile.js');
  const footer = read('templates/partials/footer.html');
  const contact = read('iletisim.html');
  const scripts = read('templates/partials/scripts.html');
  const seo = read('js/site-seo.js');
  const shared = read('shared.js');
  const ogCover = read('og-cover.svg');

  assert.match(source, /SuveraAPI\.organization\.current\(\)/);
  assert.match(source, /settings\.serviceNotes/);
  assert.match(source, /canonicalInstagramUrl/);
  assert.match([footer, contact, shared].join('\n'), /rel="noopener noreferrer"/);
  assert.match(source, /Suvera Instagram hesabını aç/);
  assert.match(footer, /data-store-profile/);
  assert.match(footer, /data-store-address-line1/);
  assert.match(footer, /data-store-service-notes/);
  assert.match(contact, /data-store-address-card/);
  assert.match(scripts, /js\/store-profile\.js/);
  assert.doesNotMatch([footer, contact, seo].join('\n'), /href=["']#|javascript:void\(0\)|https:\/\/www\.instagram\.com\/["']/i);
  assert.doesNotMatch([contact, seo].join('\n'), /0850 000 78 72|destek@suvera\.com|Hafta ici 09|tiktok\.com|pinterest\.com/i);
  assert.doesNotMatch(ogCover, /600 TL|ucretsiz kargo|ücretsiz kargo/i);
});

test('store profile normalization preserves declared data and omits missing optional values', () => {
  const listeners = {};
  const context = {
    URL,
    CustomEvent: class CustomEvent {},
    window: { addEventListener() {}, dispatchEvent() {} },
    document: {
      readyState: 'loading',
      addEventListener(name, handler) { listeners[name] = handler; },
      querySelectorAll() { return []; },
      querySelector() { return null; },
    },
  };
  vm.runInNewContext(read('js/store-profile.js'), context);
  const profile = context.window.SuveraStoreProfile.normalize({
    store_settings: {
      brand: { name: 'SUVERA BUTİK' }, storeType: 'Butik Mağaza',
      social: { instagramHandle: '@suvera.butik', instagramUrl: 'https://instagram.com/suvera.butik/' },
      contact: { addressLine1: 'Bağlarbaşı Mahallesi', addressLine2: 'Bağdat Caddesi 402 C', district: 'Maltepe', city: 'İstanbul', postalCode: '34844' },
      serviceNotes: ['Güvenli Alışveriş', 'Aynı Gün Kargo'],
    },
  });
  assert.equal(profile.instagramUrl, 'https://www.instagram.com/suvera.butik');
  assert.equal(profile.instagramHandle, '@suvera.butik');
  assert.equal(profile.locality, 'Maltepe / İstanbul 34844');
  assert.equal(Array.from(profile.serviceNotes).join('|'), 'Güvenli Alışveriş|Aynı Gün Kargo');

  const missing = context.window.SuveraStoreProfile.normalize({ store_settings: {} });
  assert.equal(missing.instagramUrl, '');
  assert.equal(missing.addressLine1, '');
  assert.equal(Array.from(missing.serviceNotes).length, 0);
});

test('product lightbox stays viewport-anchored and exposes complete gallery navigation', () => {
  const sharedStyles = read('shared.css');
  const fade = sharedStyles.slice(sharedStyles.indexOf('@keyframes pageFadeIn'), sharedStyles.indexOf('body { animation'));
  assert.doesNotMatch(fade, /transform/);

  const template = read('urun.html');
  assert.match(template, /id="imageLightboxPrev"/);
  assert.match(template, /id="imageLightboxNext"/);
  assert.match(template, /\.image-lightbox-nav\[hidden\]\{display:none\}/);

  const controller = read('js/product-detail.js');
  assert.match(controller, /function stepLightbox\(step\)/);
  assert.match(controller, /stepLightbox\(-1\)/);
  assert.match(controller, /stepLightbox\(1\)/);
  assert.match(controller, /event\.target === stage/);
});
