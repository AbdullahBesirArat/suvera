const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js', 'theme-runtime.js'), 'utf8');
// The bans below are about what the code does, not what the comments explain — the file
// documents why it avoids innerHTML and browser storage, and that prose must not trip them.
const code = source
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n');

// The API lives in a sibling checkout (git submodule). When it is not present the parity
// tests cannot run at all, and skipping is honest — a false pass would be worse.
const apiThemeRoot = path.join(root, 'panelya', 'panelya-api', 'modules', 'themes');
const hasApi = fs.existsSync(path.join(apiThemeRoot, 'css.js'));

// --- CSP: the theme must never be applied through an inline style ------------------------

test('the theme runtime never applies a token through an inline style', () => {
  // style-src-attr 'none' plus style-src 'self' leaves exactly one legal path: a linked
  // stylesheet. The site's own data-css hydration exists for developer-authored markup and
  // must never be handed tenant data, so the runtime does not use it either.
  for (const forbidden of [
    '.style.setProperty', '.style.cssText', "setAttribute('style'", 'setAttribute("style"',
    "createElement('style'", 'createElement("style"', 'innerHTML', 'outerHTML',
    'insertAdjacentHTML', 'data-css', 'document.write',
  ]) {
    assert.equal(code.includes(forbidden), false, `theme-runtime.js must not use ${forbidden}`);
  }
});

test('the theme reaches the page as a linked, same-origin stylesheet', () => {
  assert.match(source, /rel\s*=\s*'stylesheet'/);
  assert.match(source, /storefront-theme\/theme\.css/);
  // Relative to API_BASE, so it is always same-origin and inherits the proxy's headers.
  assert.doesNotMatch(source, /https?:\/\/[^'"\s]*theme\.css/);
});

// --- preview token handling ---------------------------------------------------------------

test('the raw preview token is never persisted anywhere a script or log can reach', () => {
  for (const forbidden of ['localStorage', 'sessionStorage', 'document.cookie', 'console.log', 'console.warn']) {
    assert.equal(code.includes(forbidden), false, `theme-runtime.js must not use ${forbidden}`);
  }
});

test('the preview token arrives in the fragment and is scrubbed immediately', () => {
  // A fragment is never sent to a server and never appears in a Referer or an access log.
  assert.match(source, /location\.hash/);
  assert.match(source, /history\.replaceState/);
  assert.match(source, /params\.delete\(PREVIEW_HASH_KEY\)/);
});

test('the preview stylesheet URL carries no token', () => {
  const hrefBuilder = code.slice(code.indexOf('function stylesheetHref'), code.indexOf('function attachStylesheet'));
  assert.match(hrefBuilder, /organizationSlug/);
  assert.equal(/token/i.test(hrefBuilder), false, 'no token may be interpolated into the stylesheet URL');
});

test('a theme failure leaves the storefront on its built-in appearance', () => {
  assert.match(source, /\.catch\(function \(\) \{/);
  assert.match(source, /return null;/);
});

// --- section runtime -----------------------------------------------------------------------

test('every theme string reaches the DOM through textContent only', () => {
  const assignments = code.match(/\.(textContent|innerHTML|innerText)\s*=/g) || [];
  assert.ok(assignments.length > 0, 'the runtime does write text');
  for (const assignment of assignments) {
    assert.match(assignment, /textContent/);
  }
});

test('section types are the server allowlist, so a theme cannot name an arbitrary selector', () => {
  const selectors = code.slice(code.indexOf('var SECTION_SELECTORS'), code.indexOf('var TRUST_ICON_GLYPHS'));
  for (const type of [
    'hero', 'product-grid', 'product-carousel', 'collection-blocks', 'collection-showcase',
    'category-slider', 'editorial', 'promo-banner', 'trust-features', 'newsletter',
  ]) {
    assert.ok(selectors.includes(`'${type}'`) || selectors.includes(`${type}:`), `${type} must map to an existing wrapper`);
  }
});

test('homepage builder creates managed sections without parsing tenant HTML', () => {
  for (const type of ['product-carousel', 'collection-showcase', 'category-slider', 'editorial', 'promo-banner']) {
    assert.ok(source.includes(`'${type}'`) || source.includes(`=== '${type}'`), `${type} must have a builder path`);
  }
  assert.match(source, /homepageSections/);
  assert.equal(code.includes('insertAdjacentHTML'), false);
});

test('responsive themed hero uses picture media, safe text nodes, and an eager LCP image', () => {
  const storefront = fs.readFileSync(path.join(root, 'js', 'storefront.js'), 'utf8');
  const builder = storefront.slice(
    storefront.indexOf('function renderThemedHero'),
    storefront.indexOf('function renderHeroDots')
  );
  assert.match(builder, /createElement\('picture'\)/);
  assert.match(builder, /settings\.mobileMediaId/);
  assert.match(builder, /source\.media = '\(max-width: 767px\)'/);
  assert.match(builder, /image\.loading = 'eager'/);
  assert.match(builder, /image\.fetchPriority = 'high'/);
  assert.match(builder, /image\.width = desktopImage \? 1600 : 1122/);
  assert.match(builder, /image\.height = desktopImage \? 800 : 1402/);
  assert.match(builder, /accent\.textContent = String\(settings\.accentText\)/);
  assert.match(builder, /description\.textContent = String\(settings\.subtitle\)/);
  assert.equal(builder.includes('innerHTML'), false, 'tenant hero text is never parsed as HTML');
  assert.equal(builder.includes('insertAdjacentHTML'), false, 'the themed hero is built as DOM nodes');
  assert.doesNotMatch(builder, /Yeni sezon|Koleksiyon|İstanbul/i, 'renderer invents no campaign copy');
});

test('mobile hero media is optional and desktop remains the canonical fallback', () => {
  const storefront = fs.readFileSync(path.join(root, 'js', 'storefront.js'), 'utf8');
  const builder = storefront.slice(
    storefront.indexOf('function renderThemedHero'),
    storefront.indexOf('function renderHeroDots')
  );
  assert.match(builder, /const fallbackImage = desktopImage \|\| mobileImage/);
  assert.match(builder, /if \(mobileImage\)/, 'a source is only added when mobile media exists');
  assert.match(builder, /image\.src = fallbackImage/);
  assert.match(storefront, /themed\.mobileMediaId/);
});

test('the data-section builder performs no request or free-form query construction', () => {
  // The runtime only builds a known wrapper. A carousel CTA may reuse its validated
  // internal entity source, while requests and sort handling stay in storefront.js.
  const builder = code.slice(code.indexOf('function buildDataSection'), code.indexOf('function buildEditorial'));
  for (const forbidden of ['fetch(', 'requestJson(', 'settings.sort', 'URLSearchParams']) {
    assert.equal(builder.includes(forbidden), false, `the DOM builder must not request through ${forbidden}`);
  }
  assert.match(builder, /appendCta\(wrapper, settings\.ctaLabel, settings\.source/);
  const storefront = fs.readFileSync(path.join(root, 'js', 'storefront.js'), 'utf8');
  assert.match(storefront, /Number\.isInteger\(settings\.limit\)/);
  assert.equal(storefront.includes('sectionSettings(\'product-grid\').source'), false);
});

test('homepage product sections use only active real catalog data and support exact owner selections', () => {
  const storefront = fs.readFileSync(path.join(root, 'js', 'storefront.js'), 'utf8');
  const loader = storefront.slice(
    storefront.indexOf('async function loadSectionProducts'),
    storefront.indexOf('function appendNavigationLink')
  );
  assert.match(loader, /settings\.productIds/);
  assert.match(loader, /catalog\.byIds\(selectedIds\)/);
  assert.match(loader, /product\.status === 'active'/);
  assert.match(loader, /status: 'active'/);
  assert.match(loader, /sort: settings\.sort \|\| 'newest'/);
  assert.doesNotMatch(loader, /Math\.random|placeholder|fake/i);
});

test('homepage navigation is populated from real categories, collections, and paid-sale results', () => {
  const storefront = fs.readFileSync(path.join(root, 'js', 'storefront.js'), 'utf8');
  const navigation = storefront.slice(
    storefront.indexOf('async function renderRealNavigation'),
    storefront.indexOf('async function renderProducts')
  );
  assert.match(navigation, /SuveraAPI\.categories\.list/);
  assert.match(navigation, /SuveraAPI\.collections\.list/);
  assert.match(navigation, /sort: 'best_selling'/);
  assert.match(navigation, /status: 'active'/);
  assert.match(navigation, /collection\.slug \|\| collection\.id/);
  const markup = [
    fs.readFileSync(path.join(root, 'templates', 'partials', 'navigation.html'), 'utf8'),
    fs.readFileSync(path.join(root, 'shared.js'), 'utf8'),
  ].join('\n');
  assert.doesNotMatch(markup, /editor-secimleri|category=abaya|category=dis-giyim|tag=outlet/i);
  assert.doesNotMatch(markup, /collection=all/i);
  const sharedCss = fs.readFileSync(path.join(root, 'shared.css'), 'utf8');
  for (const id of [
    'desktopCategoriesItem', 'desktopCollectionsItem', 'desktopBestSellersLink',
    'mobileCategoriesItem', 'mobileCollectionsItem', 'mobileBestSellersLink',
  ]) {
    assert.match(sharedCss, new RegExp(`#${id}\\[hidden\\]`), `${id} must stay hidden without real rows`);
  }
});

test('inactive collections are previewable only in the homepage collection section', () => {
  const api = fs.readFileSync(path.join(root, 'js', 'api.js'), 'utf8');
  const storefront = fs.readFileSync(path.join(root, 'js', 'storefront.js'), 'utf8');
  const navigation = storefront.slice(
    storefront.indexOf('async function renderRealNavigation'),
    storefront.indexOf('async function renderProducts')
  );
  const homepageCollections = storefront.slice(
    storefront.indexOf('async function renderCollections'),
    storefront.indexOf('function renderFeaturedStrip')
  );
  const catalog = storefront.slice(
    storefront.indexOf('async function renderCollectionPage'),
    storefront.indexOf('window.SuveraCatalog')
  );
  assert.match(api, /previewList:\s*\(\) => request\(withOrganizationSlug\('\/collections\/preview'\), \{ cache: 'no-store' \}\)/);
  assert.match(homepageCollections, /SuveraTheme\.isPreview/);
  assert.match(homepageCollections, /collections\.previewList/);
  assert.match(homepageCollections, /collections\.list/);
  assert.doesNotMatch(navigation, /previewList/);
  assert.doesNotMatch(catalog, /previewList/);
});

// --- wiring -----------------------------------------------------------------------------------

test('the theme runtime is loaded on every storefront page', () => {
  const partial = fs.readFileSync(path.join(root, 'templates', 'partials', 'scripts.html'), 'utf8');
  assert.match(partial, /js\/theme-runtime\.js/);
  const built = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
  assert.match(built, /theme-runtime\.js/);
});

// --- legacy visual parity ----------------------------------------------------------------------

test('the default theme reproduces the storefront palette the pages already hard-code', { skip: !hasApi }, () => {
  const schemaSource = fs.readFileSync(path.join(apiThemeRoot, 'schema.js'), 'utf8');
  const { LEGACY_ALIASES } = require(path.join(apiThemeRoot, 'css.js'));
  const { defaultThemeConfig, validateThemeConfig, themeCssVariables } = require(path.join(apiThemeRoot, 'schema.js'));
  assert.ok(schemaSource.length > 0);

  const defaults = new Map(themeCssVariables(validateThemeConfig(defaultThemeConfig())));

  // The palette the pages define today, read from the page itself so the two cannot drift.
  const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const rootBlock = indexHtml.slice(indexHtml.indexOf(':root {'), indexHtml.indexOf('}', indexHtml.indexOf(':root {')));
  const pageVars = new Map();
  for (const match of rootBlock.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    pageVars.set(match[1], match[2].trim());
  }
  assert.ok(pageVars.size > 5, 'the page palette block was found');

  for (const [legacy, themeVar] of LEGACY_ALIASES) {
    if (!pageVars.has(legacy)) continue;
    const themed = defaults.get(themeVar);
    assert.ok(themed, `${themeVar} must exist in the generated variables`);
    if (themed.startsWith('#')) {
      assert.equal(
        themed.toLowerCase(),
        pageVars.get(legacy).toLowerCase(),
        `${legacy} would change appearance: page has ${pageVars.get(legacy)}, default theme has ${themed}`
      );
    } else {
      // Font stacks are broadened (extra fallbacks) but must keep the same first family.
      const first = (value) => value.split(',')[0].trim().toLowerCase();
      assert.equal(first(themed), first(pageVars.get(legacy)), `${legacy} must keep its primary font family`);
    }
  }
});

test('the generated stylesheet outranks each page palette block regardless of link order', { skip: !hasApi }, () => {
  const { renderThemeCss } = require(path.join(apiThemeRoot, 'css.js'));
  const { defaultThemeConfig, validateThemeConfig } = require(path.join(apiThemeRoot, 'schema.js'));
  const css = renderThemeCss(validateThemeConfig(defaultThemeConfig()));
  // `:root:root` doubles specificity, so the theme wins over the page's own `:root` block
  // no matter where the browser orders the stylesheet.
  assert.match(css, /:root:root\{/);
});
