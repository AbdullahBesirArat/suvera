'use strict';

const { expect, setCart, test } = require('../fixtures.cjs');

const consentKey = 'suvera:privacy-consent:v1';

async function clearCart(page, origin) {
  await page.goto(origin);
  await page.waitForFunction(() => window.SuveraAPI?.cart);
  await page.evaluate(async () => {
    const current = await window.SuveraAPI.cart.get();
    if (current?.cart?.items?.length) await window.SuveraAPI.cart.clear(current.cart.version);
  });
}

test.describe('shopping flow simplification and cookie consent', () => {
  test('category results show products first without editorial or duplicate cards', async ({ page, e2eState }) => {
    await page.goto(`${e2eState.origins.storefront}/urunler?category_id=${e2eState.fixtures.tenantA.categoryId}`);
    await expect(page.locator('#collectionTitle')).toHaveText('Yaz Koleksiyonu');
    await expect(page.locator('#collectionEditorial')).toBeHidden();
    await expect(page.locator('#featuredProductsStrip')).toHaveCount(0);
    await expect(page.locator('#prodsGrid .prod-card')).not.toHaveCount(0);
    const ids = await page.locator('#prodsGrid .prod-card').evaluateAll((cards) => cards.map((card) => card.dataset.productId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('favorites opens on products and keeps the empty state compact', async ({ page, e2eState }) => {
    const product = e2eState.fixtures.tenantA;
    await page.goto(e2eState.origins.storefront);
    await page.evaluate(({ key, productValue }) => {
      localStorage.setItem(key, JSON.stringify({ version: 1, necessary: true, preferences: false, analytics: false, marketing: false, updatedAt: new Date().toISOString() }));
      localStorage.setItem('suveraFavorites', JSON.stringify([{ id: productValue.productId, name: productValue.productName, price: productValue.productPrice, url: `urun?id=${productValue.productId}` }]));
    }, { key: consentKey, productValue: product });
    await page.goto(`${e2eState.origins.storefront}/favoriler`);
    await expect(page.getByRole('heading', { name: 'Favoriler', level: 1 })).toBeVisible();
    await expect(page.locator('.page-hero')).toHaveCount(0);
    await expect(page.locator('.page-favorite-card')).toHaveCount(1);
    await expect(page.getByRole('link', { name: `${product.productName} ürününü görüntüle` }).first()).toBeVisible();

    await page.evaluate(() => localStorage.setItem('suveraFavorites', '[]'));
    await page.reload();
    await expect(page.getByText('Henüz favori ürününüz yok.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ürünleri Keşfet' })).toBeVisible();
  });

  test('cart shows real line items first and hides every empty-cart purchase surface', async ({ page, e2eState }) => {
    await clearCart(page, e2eState.origins.storefront);
    await setCart(page, e2eState, e2eState.fixtures.tenantA);
    await page.goto(`${e2eState.origins.storefront}/sepet`);
    await expect(page.locator('.cart-item')).toHaveCount(1);
    await expect(page.locator('#cartSummaryCard')).toBeVisible();
    await expect(page.getByRole('link', { name: /Satın Al/ })).toBeVisible();
    for (const text of ['Sepette Ayrıcalık', 'Kargo Avantajı', 'Hediye Paketi', 'Kupon kodu']) {
      await expect(page.getByText(text, { exact: false })).toHaveCount(0);
    }

    await clearCart(page, e2eState.origins.storefront);
    await page.goto(`${e2eState.origins.storefront}/sepet`);
    await expect(page.getByText('Sepetiniz boş.')).toBeVisible();
    await expect(page.locator('#cartSummaryCard')).toBeHidden();
    await expect(page.getByRole('link', { name: /Satın Al/ })).toBeHidden();
    await expect(page.locator('body')).not.toContainText('-0,00 TL');
    await expect(page.locator('body')).not.toContainText('Kargo: Ücretsiz');
  });

  test('consent lifecycle persists both decisions, supports preferences, and reopens from the footer', async ({ page, e2eState }) => {
    await page.goto(e2eState.origins.storefront);
    await page.evaluate((key) => localStorage.removeItem(key), consentKey);
    await page.reload();
    const banner = page.getByRole('dialog', { name: 'Çerez tercihleri' });
    await expect(banner).toBeVisible();
    await banner.getByRole('button', { name: 'Tercihleri Yönet' }).click();
    const dialog = page.getByRole('dialog', { name: 'Çerez tercihlerinizi yönetin' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Tercihlere izin ver').check();
    await dialog.getByRole('button', { name: 'Tercihleri Kaydet' }).click();
    await expect(dialog).toBeHidden();
    let saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), consentKey);
    expect(saved).toMatchObject({ version: 1, necessary: true, preferences: true, analytics: false, marketing: false });
    expect(saved.updatedAt).toBeTruthy();
    await page.reload();
    await expect(banner).toBeHidden();
    await page.getByRole('button', { name: 'Çerez Tercihleri' }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Yalnızca Zorunlu' }).click();
    saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), consentKey);
    expect(saved).toMatchObject({ necessary: true, preferences: false, analytics: false, marketing: false });

    await page.evaluate((key) => localStorage.removeItem(key), consentKey);
    await page.reload();
    await banner.getByRole('button', { name: 'Tümünü Kabul Et' }).click();
    saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), consentKey);
    expect(saved).toMatchObject({ necessary: true, preferences: true, analytics: true, marketing: false });
  });

  test('cookie policy and shopping routes have no horizontal overflow at target widths', async ({ page, e2eState }) => {
    for (const width of [390, 412, 430, 768, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 932 });
      for (const route of ['/cerez-politikasi', `/urunler?category_id=${e2eState.fixtures.tenantA.categoryId}`, '/favoriler', '/sepet']) {
        const response = await page.goto(`${e2eState.origins.storefront}${route}`);
        expect(response.status()).toBe(200);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${width}px ${route}`).toBeLessThanOrEqual(2);
      }
    }
  });
});
