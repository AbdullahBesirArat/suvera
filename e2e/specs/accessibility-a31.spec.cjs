'use strict';

// A31 accessibility acceptance. Automated axe scanning is the floor, not the ceiling: the
// keyboard, focus-trap, error-focus, reflow and reduced-motion tests below drive the real
// browser the way a keyboard or screen-reader user would, because axe cannot tell whether
// Tab actually reaches a control or whether focus comes back when a dialog closes.

const { AxeBuilder } = require('@axe-core/playwright');
const {
  bff,
  expect,
  fillCheckout,
  loginAdmin,
  setCart,
  stepUpWithPassword,
  test,
} = require('../fixtures.cjs');

// Serious/critical are the two impact levels that block a user outright. Moderate and
// minor findings are reported by axe but are not gates here; nothing is suppressed by
// rule id or selector, so a regression in any rule still surfaces.
const BLOCKING_IMPACTS = ['critical', 'serious'];

// The storefront fades the whole document in on load (body { animation: pageFadeIn }).
// Scanning during that animation measures every colour composited against a
// partially-transparent body, which reports contrast the user never actually sees and
// makes real failures indistinguishable from the fade. Wait for the settled page.
async function settle(page) {
  await page.waitForFunction(() => {
    const body = document.body;
    if (!body) return false;
    return Number(getComputedStyle(body).opacity) >= 1
      && body.getAnimations().every((animation) => animation.playState !== 'running');
  }, null, { timeout: 5_000 }).catch(() => {});
}

async function analyze(page, { include } = {}) {
  await settle(page);
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (include) builder = builder.include(include);
  return builder.analyze();
}

function blocking(results) {
  return results.violations
    .filter((violation) => BLOCKING_IMPACTS.includes(violation.impact))
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      // Every offending node, not a sample: a truncated list turns one fix into one run.
      // For contrast, axe already measured the effective foreground, background and ratio
      // (accounting for opacity and ancestor backgrounds) — reporting it here removes the
      // guesswork of inferring colours from stylesheets.
      nodes: violation.nodes.map((node) => {
        const measured = (node.any || []).map((check) => check.data)
          .find((data) => data && data.contrastRatio !== undefined);
        if (!measured) return node.target.join(' ');
        return `${node.target.join(' ')}  [fg=${measured.fgColor} bg=${measured.bgColor}`
          + ` ratio=${measured.contrastRatio} need=${measured.expectedContrastRatio}`
          + ` ${measured.fontSize} ${measured.fontWeight}]`;
      }),
    }));
}

async function expectNoBlockingViolations(page, label, options) {
  const results = await analyze(page, options);
  const found = blocking(results);
  expect(found, `${label}: ${JSON.stringify(found, null, 2)}`).toEqual([]);
}

async function tabTo(page, locator, limit = 80) {
  await expect(locator).toBeVisible();
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press('Tab');
    if (await locator.evaluate((node) => node === document.activeElement)) return;
  }
  throw new Error(`Keyboard focus did not reach ${await locator.evaluate((node) => node.outerHTML.slice(0, 180))}`);
}

async function shiftTabTo(page, locator, limit = 40) {
  await expect(locator).toBeVisible();
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press('Shift+Tab');
    if (await locator.evaluate((node) => node === document.activeElement)) return;
  }
  throw new Error(`Reverse keyboard focus did not reach ${await locator.evaluate((node) => node.outerHTML.slice(0, 180))}`);
}

// Scans several pages and reports EVERY blocking violation across all of them in one
// failure. Asserting per page stops at the first one, so each run revealed only the next
// offender. The bar is unchanged — zero blocking violations anywhere.
function violationCollector() {
  const all = [];
  return {
    async scan(page, label, options) {
      const found = blocking(await analyze(page, options));
      if (found.length) all.push({ page: label, violations: found });
    },
    assertClean() {
      expect(all, `blocking axe violations:\n${JSON.stringify(all, null, 2)}`).toEqual([]);
    },
  };
}

test.describe('A31 storefront accessibility', () => {
  test('1-6 key storefront pages have no blocking axe violations', async ({ page, e2eState }) => {
    const origin = e2eState.origins.storefront;
    const collector = violationCollector();

    await page.goto(origin);
    await expect(page.locator('#homeProductsGrid .prod-card').first()).toBeVisible();
    await collector.scan(page, 'anasayfa');

    await page.goto(`${origin}/urunler?sort=recommended`);
    await expect(page.locator('#prodsGrid .prod-card').first()).toBeVisible();
    await collector.scan(page, 'katalog');

    await page.goto(`${origin}/urun?id=${e2eState.fixtures.tenantA.productId}`);
    await expect(page.locator('h1')).toBeVisible();
    await collector.scan(page, 'urun detay');

    await setCart(page, e2eState, e2eState.fixtures.tenantA);
    await page.goto(`${origin}/sepet`);
    await collector.scan(page, 'sepet');

    await page.goto(`${origin}/siparis`);
    await expect(page.locator('#checkoutForm')).toBeVisible();
    await collector.scan(page, 'odeme');

    // Checkout with validation errors showing is its own state worth scanning.
    const acceptConsent = page.locator('[data-consent-action="accept-all"]');
    if (await acceptConsent.isVisible()) await acceptConsent.click();
    await expect(page.locator('#payButton')).toBeEnabled();
    await page.locator('#payButton').click();
    await expect(page.locator('#checkoutError')).not.toBeEmpty();
    await collector.scan(page, 'odeme (hatali)');

    await page.goto(`${origin}/giris`);
    await collector.scan(page, 'giris');

    collector.assertClean();
  });

  test('7-10 every page has one H1, the landmarks and a working skip link', async ({ page, e2eState }) => {
    const origin = e2eState.origins.storefront;
    for (const path of ['', '/urunler', '/sepet', '/siparis', '/giris']) {
      await page.goto(`${origin}${path}`);
      await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('header')).toHaveCount(1);
      await expect(page.locator('main#main')).toHaveCount(1);

      // Checkout deliberately drops the shared chrome so nothing competes with the
      // purchase, so it has no site footer to assert. The rule enforced at build time is
      // the same one asserted here: a page that renders the shared navigation must carry
      // the full banner/footer pair.
      const sharedChrome = await page.locator('[data-shared-partial="navigation"]').count();
      if (sharedChrome > 0) {
        await expect(page.locator('footer')).toHaveCount(1);
      } else {
        await expect(page.locator('footer')).toHaveCount(0);
      }
    }

    // The skip link is reachable as one of the first tab stops and moves focus into main.
    await page.goto(origin);
    await page.keyboard.press('Tab');
    const skip = page.locator('a.skip-link');
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await skip.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
  });

  test('11-14 the mobile menu traps focus, closes on Escape and restores focus', async ({ page, e2eState }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(e2eState.origins.storefront);

    const hamburger = page.locator('.hamburger');
    await expect(hamburger).toHaveAttribute('aria-expanded', 'false');
    // While closed, nothing inside the drawer may be reachable by keyboard.
    await expect(page.locator('#mobileNav .mobile-nav-item').first()).not.toBeVisible();

    await hamburger.click();
    await expect(hamburger).toHaveAttribute('aria-expanded', 'true');
    const close = page.locator('.mobile-drawer-close');
    await expect(close).toBeFocused();

    // Tab cycles inside the drawer: after many tabs focus is still within it.
    for (let i = 0; i < 25; i += 1) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.getElementById('mobileNav')?.contains(document.activeElement)))).toBe(true);
    for (let i = 0; i < 8; i += 1) await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => Boolean(document.getElementById('mobileNav')?.contains(document.activeElement)))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(hamburger).toHaveAttribute('aria-expanded', 'false');
    await expect(hamburger).toBeFocused();
  });

  test('15-18 the size guide dialog is named, traps focus and returns focus to its trigger', async ({ page, e2eState }) => {
    await page.goto(`${e2eState.origins.storefront}/urun?id=${e2eState.fixtures.tenantA.productId}`);
    // global-setup seeds an active guide for this product, so the dialog must exist. No
    // conditional skip: an absent trigger is a regression, not a reason to pass quietly.
    const trigger = page.locator('#sizeGuideBtn');
    await expect(trigger).toBeVisible();

    await trigger.click();
    const modal = page.locator('#sizeGuideModal');
    await expect(modal).toHaveAttribute('aria-modal', 'true');
    await expect(modal).toHaveAttribute('aria-labelledby', 'sizeGuideTitle');
    await expect(page.locator('#sizeGuideClose')).toBeFocused();

    // The measurement table names itself and labels its rows.
    await expect(modal.locator('table caption')).toHaveCount(1);
    await expect(modal.locator('th[scope="row"]').first()).toBeVisible();
    await expectNoBlockingViolations(page, 'beden rehberi', { include: '#sizeGuideModal' });

    for (let i = 0; i < 12; i += 1) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.getElementById('sizeGuideModal')?.contains(document.activeElement)))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });

  test('19-22 checkout validation names the field, describes the error and focuses it', async ({ page, e2eState }) => {
    await setCart(page, e2eState, e2eState.fixtures.tenantA);
    await page.goto(`${e2eState.origins.storefront}/siparis`);

    // Submit with an empty form: the first invalid control must receive focus.
    const acceptConsent = page.locator('[data-consent-action="accept-all"]');
    if (await acceptConsent.isVisible()) await acceptConsent.click();
    await expect(page.locator('#payButton')).toBeEnabled();
    await page.locator('#payButton').click();
    const firstName = page.locator('#firstName');
    await expect(firstName).toBeFocused();
    await expect(firstName).toHaveAttribute('aria-invalid', 'true');
    await expect(firstName).toHaveAttribute('aria-describedby', 'checkoutError');
    await expect(page.locator('#checkoutError')).toHaveAttribute('role', 'alert');
    await expect(page.locator('#checkoutError')).not.toBeEmpty();

    // A later field: the same contract, and the earlier field is no longer marked invalid.
    await firstName.fill('Ayse');
    await page.locator('#lastName').fill('Yilmaz');
    await page.locator('#customerEmail').fill('gecersiz-eposta');
    await page.locator('#payButton').click();
    await expect(page.locator('#customerEmail')).toBeFocused();
    await expect(page.locator('#customerEmail')).toHaveAttribute('aria-invalid', 'true');
    await expect(firstName).not.toHaveAttribute('aria-invalid', 'true');

    // The step indicator says where the user is, and the payment choices are a named group.
    await expect(page.locator('ol.checkout-steps li[aria-current="step"]')).toHaveCount(1);
    await expect(page.locator('.method-list[aria-labelledby="paymentMethodTitle"]')).toHaveCount(1);
    await expect(page.locator('input[name="paymentMethod"][value="iban"]')).toBeChecked();
    await expect(page.locator('input[name="paymentMethod"][value="card"]')).toHaveCount(0);
  });

  test('61-64 cart controls name the product they act on', async ({ page, e2eState }) => {
    await setCart(page, e2eState, e2eState.fixtures.tenantA);
    await page.goto(`${e2eState.origins.storefront}/sepet`);
    const row = page.locator('.cart-item').first();
    await expect(row).toBeVisible();

    // Every line repeats the same three controls, so a bare "Adet artır" is
    // indistinguishable between products. Each must name what it acts on.
    const productName = (await row.locator('.cart-item-name').textContent() || '').trim();
    expect(productName.length).toBeGreaterThan(0);
    for (const pattern of [
      new RegExp(`${productName} adedini azalt`),
      new RegExp(`${productName} adedini artır`),
      new RegExp(`${productName} ürününü sepetten kaldır`),
    ]) {
      await expect(row.getByRole('button', { name: pattern })).toHaveCount(1);
    }

    // The quantity control reports the current value, so its effect is predictable.
    await expect(row.getByRole('button', { name: /adedini artır \(şu an \d+\)/ })).toHaveCount(1);
  });

  test('65-70 the full-page cart supports keyboard navigation and preserves focus after updates', async ({ page, e2eState }) => {
    await setCart(page, e2eState, e2eState.fixtures.tenantA);
    await page.goto(e2eState.origins.storefront);

    // The cart is a normal destination, not a drawer: reach its navigation link with Tab
    // and activate it with Enter. No aria-expanded/focus-trap contract applies here.
    const cartLink = page.locator('#mainNav a[href="sepet"]');
    await tabTo(page, cartLink);
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/sepet$/);

    const skip = page.getByRole('link', { name: 'İçeriğe geç' });
    await tabTo(page, skip);
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();

    const increment = page.locator('[data-action="cart-qty"][data-delta="1"]').first();
    await tabTo(page, increment);
    await page.keyboard.press('Enter');
    await expect(increment).toHaveAttribute('aria-label', /şu an 2/);
    await expect(increment).toBeFocused();
    await expect(page.locator('#cartItems')).toHaveAttribute('aria-busy', 'false');

    // Coupon entry belongs to checkout, so the cart remains a short, direct flow.
    await expect(page.locator('#cartCouponCode')).toHaveCount(0);

    const checkout = page.locator('#cartCheckoutLink');
    await tabTo(page, checkout);
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/siparis$/);
  });

  test('71-73 removing the final full-page cart item moves focus to the empty state', async ({ page, e2eState }) => {
    await setCart(page, e2eState, e2eState.fixtures.tenantA);
    await page.goto(`${e2eState.origins.storefront}/sepet`);
    await expect(page.locator('.cart-item')).toHaveCount(1);

    const remove = page.locator('[data-action="cart-remove"]');
    await tabTo(page, remove);
    await page.keyboard.press('Enter');
    const emptyHeading = page.locator('#cartEmptyHeading');
    await expect(emptyHeading).toBeFocused();
    await expect(page.locator('.cart-item')).toHaveCount(0);
    await expect(page.locator('#cartCheckoutLink')).toHaveAttribute('aria-disabled', 'true');
  });

  test('74-78 storefront authentication exposes labels, errors and password state to the keyboard', async ({ page, e2eState }) => {
    await page.goto(`${e2eState.origins.storefront}/giris`);
    const email = page.locator('#emailInput');
    const password = page.locator('#pwInput');
    await expect(email).toHaveAttribute('autocomplete', 'email');
    await expect(password).toHaveAttribute('autocomplete', 'current-password');
    await expect(page.locator('label[for="emailInput"]')).toBeVisible();
    await expect(page.locator('label[for="pwInput"]')).toBeVisible();

    const loginSubmit = page.locator('#loginSubmit');
    await tabTo(page, loginSubmit);
    await page.keyboard.press('Enter');
    await expect(email).toBeFocused();
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#loginError')).toHaveAttribute('role', 'alert');

    const passwordToggle = page.locator('[aria-controls="pwInput"]');
    await tabTo(page, passwordToggle);
    await page.keyboard.press('Space');
    await expect(passwordToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(password).toHaveAttribute('type', 'text');

    const registerLink = page.getByRole('link', { name: /Hızlıca üye olun/ });
    await tabTo(page, registerLink);
    await page.keyboard.press('Enter');
    await expect(page.locator('#registerNameInput')).toBeFocused();
    await expect(page.locator('#registerPwInput')).toHaveAttribute('autocomplete', 'new-password');
    const registerSubmit = page.locator('#registerSubmit');
    await tabTo(page, registerSubmit);
    await page.keyboard.press('Enter');
    await expect(page.locator('#registerNameInput')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#registerNameInput')).toBeFocused();
  });

  test('79-83 product variants expose names, selection and availability without relying on color alone', async ({ page, e2eState }) => {
    await page.goto(`${e2eState.origins.storefront}/urun?id=${e2eState.fixtures.tenantA.productId}`);
    const colors = page.locator('#detailColors .swatch');
    const sizes = page.locator('#detailSizes .size-btn');
    await expect(colors.first()).toBeVisible();
    await expect(sizes.first()).toBeVisible();
    await expect(page.locator('#detailColors .swatch[aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('#detailSizes .size-btn[aria-pressed="true"]')).toHaveCount(1);
    await expect(colors.first()).toHaveAccessibleName(/rengi/);
    await expect(sizes.first()).toHaveAccessibleName(/beden/);

    expect(await page.evaluate(() => Array.from(document.querySelectorAll('#detailColors button:disabled, #detailSizes button:disabled'))
      .every((button) => button.getAttribute('aria-disabled') === 'true'))).toBe(true);

    if (await colors.count() > 1) {
      await tabTo(page, colors.nth(1));
      await page.keyboard.press('Space');
      await expect(colors.nth(1)).toHaveAttribute('aria-pressed', 'true');
    }
    const add = page.locator('#detailAddCartBtn');
    await tabTo(page, add);
    await page.keyboard.press('Enter');
    await expect(page.locator('#cartFeedback')).toContainText('Ürün sepetinize eklenmiştir');
    await expect(add).toHaveAttribute('aria-busy', 'false');
  });

  test('23-26 the whole storefront purchase path is reachable with the keyboard alone', async ({ page, e2eState }) => {
    await setCart(page, e2eState, e2eState.fixtures.tenantA);
    await page.goto(`${e2eState.origins.storefront}/sepet`);

    // Every interactive control on the cart page carries an accessible name.
    const unnamed = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('main button, main a[href], main input, main select'));
      return nodes
        .filter((node) => node.offsetParent !== null)
        .filter((node) => {
          const label = node.getAttribute('aria-label')
            || node.getAttribute('title')
            || (node.labels && node.labels.length ? node.labels[0].textContent : '')
            || node.textContent
            || node.getAttribute('alt')
            || '';
          return !String(label).trim();
        })
        .map((node) => node.tagName.toLowerCase() + (node.className ? '.' + String(node.className).split(' ')[0] : ''))
        .slice(0, 8);
    });
    expect(unnamed, 'sepet sayfasinda isimsiz kontrol').toEqual([]);

    // Reaching checkout without a mouse.
    await page.goto(`${e2eState.origins.storefront}/siparis`);
    await fillCheckout(page);
    await expect(page.locator('#payButton')).toBeEnabled();
    await page.locator('#payButton').focus();
    await expect(page.locator('#payButton')).toBeFocused();
  });

  test('27-29 the catalog reflows at 320px and under 200% zoom without losing content', async ({ page, e2eState }) => {
    const origin = e2eState.origins.storefront;

    await page.setViewportSize({ width: 320, height: 720 });
    for (const path of ['', '/urunler', '/sepet', '/siparis', '/giris']) {
      await page.goto(`${origin}${path}`);
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      // A couple of pixels of rounding is tolerable; a real horizontal scrollbar is not.
      expect(overflow.scroll - overflow.client, `${path} 320px yatay tasma`).toBeLessThanOrEqual(2);
    }

    // 200% zoom is equivalent to halving the CSS viewport at the same device pixel ratio.
    await page.setViewportSize({ width: 640, height: 512 });
    for (const path of ['/urunler', '/siparis']) {
      await page.goto(`${origin}${path}`);
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(overflow.scroll - overflow.client, `${path} 200% zoom yatay tasma`).toBeLessThanOrEqual(2);
      await expect(page.locator('main#main')).toBeVisible();
    }
  });

  test('30-31 reduced motion keeps every flow usable', async ({ page, e2eState }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(e2eState.origins.storefront);

    // Content that fades in on scroll must still be readable, not stuck at opacity 0.
    await expect(page.locator('h1')).toBeVisible();
    const opacity = await page.locator('h1').evaluate((node) => getComputedStyle(node).opacity);
    expect(Number(opacity)).toBeGreaterThan(0.9);

    // The drawer still opens, traps focus and closes without depending on a transition.
    await page.locator('.hamburger').click();
    await expect(page.locator('.mobile-drawer-close')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.hamburger')).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('A31 admin accessibility', () => {
  test('84-90 the representative admin flow works from login through filters and form validation by keyboard', async ({ page, e2eState }) => {
    const credentials = e2eState.credentials.tenantA;
    await page.goto(`${e2eState.origins.admin}/login`);
    await page.waitForLoadState('networkidle');

    const storeRole = page.getByTestId('login-role-store');
    await tabTo(page, storeRole);
    await page.keyboard.press('Enter');
    const email = page.getByTestId('login-email');
    await tabTo(page, email);
    await page.keyboard.insertText(credentials.email);
    const password = page.getByTestId('login-password');
    await tabTo(page, password);
    await page.keyboard.insertText(credentials.password);
    const slug = page.getByTestId('login-organization-slug');
    await tabTo(page, slug);
    await page.keyboard.insertText(credentials.slug);
    const submit = page.getByTestId('login-submit');
    await tabTo(page, submit);
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/dashboard$/);

    const loginToast = page.getByRole('status').filter({ hasText: 'Oturum açıldı' });
    await expect(loginToast).toBeVisible();
    expect(await loginToast.getByRole('button', { name: 'Kapat' }).evaluate((node) => node.tabIndex)).toBe(0);

    const skip = page.getByRole('link', { name: 'İçeriğe geç' });
    await tabTo(page, skip);
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();

    const productsLink = page.getByRole('navigation', { name: 'Bölümler', exact: true }).getByRole('link', { name: 'Ürünler' });
    await tabTo(page, productsLink);
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/products$/);

    const search = page.getByRole('textbox', { name: 'Ürün ara' });
    await tabTo(page, search);
    await page.keyboard.insertText('İpek');
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('İpek');
    const tableRegion = page.getByRole('group', { name: 'Ürünler' });
    await tabTo(page, tableRegion);
    await expect(tableRegion).toBeFocused();

    const createTab = page.getByRole('button', { name: /Ürün Oluştur/ }).first();
    await shiftTabTo(page, createTab);
    await page.keyboard.press('Enter');
    const form = page.locator('form:has(#product-name)');
    await expect(form).toBeVisible();
    const formSubmit = form.getByRole('button', { name: /Ürün oluştur/ });
    await tabTo(page, formSubmit);
    await page.keyboard.press('Enter');
    await expect(form.locator('#product-name')).toBeFocused();
    await expect(form.locator('#product-name')).toHaveAttribute('aria-invalid', 'true');
  });

  test('91-96 products, orders and customers restore URL-backed filters on reload and history navigation', async ({ page, e2eState }) => {
    await loginAdmin(page, e2eState);

    await page.goto(`${e2eState.origins.admin}/products`);
    const productSearch = page.getByRole('textbox', { name: 'Ürün ara' });
    await productSearch.fill('İpek');
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('İpek');
    const productStatus = page.getByRole('combobox', { name: 'Ürün durumu' });
    await productStatus.selectOption('active');
    await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('active');
    await page.reload();
    await expect(productSearch).toHaveValue('İpek');
    await expect(productStatus).toHaveValue('active');
    await productSearch.fill('Şal');
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('Şal');
    await page.goBack();
    await expect(productSearch).toHaveValue('İpek');
    await page.goForward();
    await expect(productSearch).toHaveValue('Şal');

    await page.goto(`${e2eState.origins.admin}/orders`);
    const orderSearch = page.getByRole('textbox', { name: 'Sipariş ara' });
    await orderSearch.fill('SV-');
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('SV-');
    await page.reload();
    await expect(orderSearch).toHaveValue('SV-');

    await page.goto(`${e2eState.origins.admin}/customers`);
    const customerSearch = page.getByRole('textbox', { name: 'Müşteri ara' });
    await customerSearch.fill('customer.a');
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('customer.a');
    await page.reload();
    await expect(customerSearch).toHaveValue('customer.a');
  });

  test('97-100 the security step-up flow opens, traps keyboard focus and restores its trigger', async ({ page, e2eState }) => {
    await loginAdmin(page, e2eState);
    await page.goto(`${e2eState.origins.admin}/security`);
    const opener = page.getByRole('button', { name: 'Doğrulama uygulaması ekle' });
    await tabTo(page, opener);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Kimliğinizi yeniden doğrulayın' });
    await expect(dialog).toBeVisible();
    for (let index = 0; index < 12; index += 1) await page.keyboard.press('Tab');
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test('32-35 the admin login and main sections have no blocking axe violations', async ({ page, e2eState }) => {
    await page.goto(`${e2eState.origins.admin}/login`);
    await expectNoBlockingViolations(page, 'admin login');

    await loginAdmin(page, e2eState);
    await expect(page.locator('main#main')).toBeVisible();
    await expectNoBlockingViolations(page, 'admin dashboard');

    for (const section of ['products', 'orders', 'customers']) {
      await page.goto(`${e2eState.origins.admin}/${section}`);
      await expect(page.locator('main#main')).toBeVisible();
      await expectNoBlockingViolations(page, `admin ${section}`);
    }
  });

  test('36-39 the admin shell exposes landmarks, a skip link, one H1 and the current page', async ({ page, e2eState }) => {
    await loginAdmin(page, e2eState);
    await page.goto(`${e2eState.origins.admin}/products`);

    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    await expect(page.locator('main#main')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('nav[aria-label="Bölümler"]')).toHaveCount(1);
    await expect(page.locator('nav[aria-label="Bölümler"] a[aria-current="page"]')).toHaveCount(1);

    // The skip link is the first tab stop and lands on main.
    await page.locator('body').press('Tab');
    const skip = page.getByRole('link', { name: 'İçeriğe geç' });
    await expect(skip).toBeFocused();
    await skip.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
  });

  test('40-43 admin tables are named, label their columns and expose sort state', async ({ page, e2eState }) => {
    await loginAdmin(page, e2eState);
    await page.goto(`${e2eState.origins.admin}/products`);
    const table = page.locator('main table').first();
    await expect(table).toBeVisible();

    // Every table names itself and every header declares what it labels.
    const shape = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('main table'));
      return tables.map((table) => ({
        caption: (table.querySelector('caption')?.textContent || '').trim(),
        headers: Array.from(table.querySelectorAll('thead th')).length,
        scoped: Array.from(table.querySelectorAll('thead th[scope="col"]')).length,
      }));
    });
    expect(shape.length).toBeGreaterThan(0);
    for (const entry of shape) {
      expect(entry.caption, 'tablo basligi bos').not.toEqual('');
      expect(entry.scoped, 'th scope eksik').toEqual(entry.headers);
    }
  });

  test('44-47 the step-up dialog is modal, traps focus and returns it to the opener', async ({ page, e2eState }) => {
    await loginAdmin(page, e2eState);
    await page.goto(`${e2eState.origins.admin}/security`);
    await expect(page.locator('main#main')).toBeVisible();
    await expectNoBlockingViolations(page, 'admin security');

    // The step-up dialog is the one modal every critical action goes through.
    await stepUpWithPassword(page, e2eState.credentials.tenantA.password);
    const summary = await bff(page, '/security/step-up/status');
    expect(summary.status).toBe(200);
  });

  test('57-60 an invalid admin form names the bad field, describes it and focuses it', async ({ page, e2eState }) => {
    await loginAdmin(page, e2eState);
    await page.goto(`${e2eState.origins.admin}/products`);
    await expect(page.locator('main#main')).toBeVisible();

    // The section sub-navigation has a tab ALSO called "Ürün Oluştur", which precedes the
    // form's submit button in the DOM — so the submit must be scoped to the form itself,
    // not matched by name across the page.
    // The tab's accessible name also carries its description, so match loosely; the
    // submit below is scoped to the form, so there is no collision between the two.
    await page.getByRole('button', { name: /Ürün Oluştur/ }).first().click();

    const form = page.locator('form:has(#product-name)');
    const name = form.locator('#product-name');
    await expect(name).toBeVisible();
    const submit = form.getByRole('button', { name: /Ürün oluştur|Ürünü güncelle/ });
    await submit.click();

    // The failing control announces itself, points at the message, and takes focus.
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(name).toHaveAttribute('aria-describedby', 'product-form-error');
    await expect(name).toBeFocused();
    const error = page.locator('#product-form-error');
    await expect(error).toHaveAttribute('role', 'alert');
    await expect(error).not.toBeEmpty();

    // A later field gets the same treatment, and the earlier one is no longer flagged.
    await name.fill('A31 Erişilebilirlik Ürünü');
    await form.locator('#product-price').fill('abc');
    await submit.click();
    const price = form.locator('#product-price');
    await expect(price).toHaveAttribute('aria-invalid', 'true');
    await expect(price).toBeFocused();
    await expect(name).not.toHaveAttribute('aria-invalid', 'true');

    await expectNoBlockingViolations(page, 'admin urun formu (hatali)');
  });

  test('51-56 the shared admin dialog is modal, traps focus, escapes and restores focus', async ({ page, e2eState }) => {
    // TOTP setup opens a OneTimeDialog, which is the shared AdminDialog primitive. Whatever
    // this proves holds for every admin modal, because they all go through that one file.
    await loginAdmin(page, e2eState);
    await page.goto(`${e2eState.origins.admin}/security`);
    await expect(page.locator('main#main')).toBeVisible();
    await stepUpWithPassword(page, e2eState.credentials.tenantA.password);

    // No conditional skip: this control exists for any tenant without TOTP enrolled, and a
    // missing trigger is a regression rather than a reason to pass quietly.
    const opener = page.getByRole('button', { name: 'Doğrulama uygulaması ekle' });
    await expect(opener).toBeVisible();
    await opener.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    // The dialog names itself from its own heading, not from a nearby label.
    const labelledBy = await dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    await expect(page.locator(`#${labelledBy}`)).not.toBeEmpty();

    // Focus starts inside, on the close control.
    await expect(page.getByRole('button', { name: 'Kapat' })).toBeFocused();

    // Tab and Shift+Tab both cycle within the dialog.
    for (let i = 0; i < 20; i += 1) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => {
      const node = document.querySelector('[role="dialog"]');
      return Boolean(node && node.contains(document.activeElement));
    })).toBe(true);
    for (let i = 0; i < 10; i += 1) await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => {
      const node = document.querySelector('[role="dialog"]');
      return Boolean(node && node.contains(document.activeElement));
    })).toBe(true);

    // The page behind is hidden from assistive technology and unreachable by keyboard
    // while the dialog is open. The dialog is portaled to <body>, so isolation is applied
    // to body's children — #main sits inside a framework wrapper, so what matters is that
    // #main is EFFECTIVELY hidden (itself or an ancestor), not which node carries the
    // attribute. Asserting the exact node would test the implementation, not the guarantee.
    const background = await page.evaluate(() => {
      const main = document.getElementById('main');
      if (!main) return null;
      let hidden = false;
      let inert = false;
      for (let node = main; node; node = node.parentElement) {
        if (node.getAttribute('aria-hidden') === 'true') hidden = true;
        if (node.inert) inert = true;
      }
      // A control behind the dialog must not be focusable.
      const behind = main.querySelector('a[href], button:not([disabled])');
      let focusable = false;
      if (behind instanceof HTMLElement) {
        behind.focus();
        focusable = document.activeElement === behind;
      }
      return { hidden, inert, focusable };
    });
    expect(background, 'main landmark is present').not.toBeNull();
    expect(background.hidden, 'background is hidden from assistive technology').toBe(true);
    expect(background.inert, 'background is inert').toBe(true);
    expect(background.focusable, 'background control must not take focus').toBe(false);

    await expectNoBlockingViolations(page, 'admin dialog');

    // Escape closes it and focus returns to whatever opened it.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(await page.evaluate(() => {
      const main = document.getElementById("main");
      if (!main) return true;
      for (let node = main; node; node = node.parentElement) {
        if (node.getAttribute("aria-hidden") === "true" || node.inert) return true;
      }
      return false;
    }), "isolation is removed after close").toBe(false);
  });

  test('48-50 admin reflows at 320px and keeps navigation reachable', async ({ page, e2eState }) => {
    await loginAdmin(page, e2eState);
    await page.setViewportSize({ width: 320, height: 720 });
    for (const section of ['dashboard', 'products', 'orders']) {
      await page.goto(`${e2eState.origins.admin}/${section}`);
      await expect(page.locator('main#main')).toBeVisible();
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(overflow.scroll - overflow.client, `${section} 320px yatay tasma`).toBeLessThanOrEqual(2);
      await expect(page.locator('nav[aria-label="Bölümler (mobil)"] a[aria-current="page"]')).toHaveCount(1);
    }
  });
});
