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
  for (const type of ['hero', 'product-grid', 'collection-blocks', 'trust-features', 'newsletter']) {
    assert.ok(selectors.includes(`'${type}'`) || selectors.includes(`${type}:`), `${type} must map to an existing wrapper`);
  }
});

test('the product grid takes no query, filter or sort string from the theme', () => {
  // The grid's row count is a bounded integer; the catalog request itself stays entirely
  // server-side, so a theme can never influence which products are selected.
  const applier = code.slice(code.indexOf('function applyProductGrid'), code.indexOf('function applyCollectionBlocks'));
  for (const forbidden of ['settings.source', 'settings.sort', 'settings.columns']) {
    assert.equal(applier.includes(forbidden), false, `the grid must not read ${forbidden} into a request`);
  }
  const storefront = fs.readFileSync(path.join(root, 'js', 'storefront.js'), 'utf8');
  assert.match(storefront, /Number\.isInteger\(settings\.limit\)/);
  assert.equal(storefront.includes('sectionSettings(\'product-grid\').source'), false);
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
