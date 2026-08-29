'use strict';

const {
  expect,
  fillCheckout,
  setCart,
  test,
} = require('../fixtures.cjs');

test.describe('A03 Suvera storefront full-stack', () => {
  test('1-2 ana sayfa açılır ve canlı ürün/kategori listeleri yüklenir', async ({ page, e2eState }) => {
    await page.goto(e2eState.origins.storefront);
    await expect(page.locator('#homeProductsGrid .prod-card')).toHaveCount(8);
    await expect(page.locator('#homeCategoryGrid .cat-card')).toHaveCount(1);
    await expect(page.locator(`#homeProductsGrid .prod-card[data-product-id="${e2eState.fixtures.raceProduct.id}"]`)).toBeVisible();
  });

  test('3 katalog pagination ikinci sayfaya geçer', async ({ page, e2eState }) => {
    await page.goto(`${e2eState.origins.storefront}/urunler`);
    const firstPage = page.locator('#prodsGrid .prod-card');
    await expect(firstPage).toHaveCount(24);
    const total = Number(await page.locator('#productResultCount').textContent());
    expect(total).toBeGreaterThan(24);
    await page.getByRole('button', { name: '2', exact: true }).click();
    await expect(page).toHaveURL(/(?:\?|&)page=2(?:&|$)/);
    await expect(page.locator('#prodsGrid .prod-card')).toHaveCount(total - 24);
    await expect(page.getByRole('button', { name: '2', exact: true })).toHaveClass(/act/);
  });

  test('4 kategori filtresi URL ve sonuç durumunu günceller', async ({ page, e2eState }) => {
    await page.goto(`${e2eState.origins.storefront}/urunler`);
    const unfilteredTotal = await page.locator('#productResultCount').textContent();
    const category = page.locator(`#collectionCategoryFilters input[value="${e2eState.fixtures.tenantA.categoryId}"]`);
    await expect(category).toBeVisible();
    await category.check();
    await expect(page).toHaveURL(new RegExp(`category=${e2eState.fixtures.tenantA.categoryId}`));
    await expect(category).toBeChecked();
    await expect(page.locator('#productResultCount')).toHaveText(unfilteredTotal);
  });

  test('5 renk filtresi seçimi kataloğa uygulanır', async ({ page, e2eState }) => {
    await page.goto(`${e2eState.origins.storefront}/urunler`);
    const color = page.locator('#collectionColorFilters [data-color]').first();
    const value = await color.getAttribute('data-color');
    await color.click();
    await expect.poll(() => new URL(page.url()).searchParams.get('color')).toBe(value.toLocaleLowerCase('tr-TR'));
    await expect(page.locator(`#collectionColorFilters [data-color="${value}"]`)).toHaveClass(/act/);
    await expect(page.locator('#prodsGrid .prod-card').first()).toBeVisible();
  });

  test('6 beden filtresi seçimi kataloğa uygulanır', async ({ page, e2eState }) => {
    await page.goto(`${e2eState.origins.storefront}/urunler`);
    const size = page.locator('#collectionSizeFilters [data-size]').first();
    const value = await size.getAttribute('data-size');
    await size.click();
    await expect(page).toHaveURL(new RegExp(`size=${value}`));
    await expect(page.locator(`#collectionSizeFilters [data-size="${value}"]`)).toHaveClass(/act/);
    await expect(page.locator('#prodsGrid .prod-card').first()).toBeVisible();
  });

  test('7 fiyat filtresi sunucu sonuçlarını sınırlar', async ({ page, e2eState }) => {
    await page.goto(`${e2eState.origins.storefront}/urunler`);
    await page.locator('#priceRange').evaluate((element) => {
      element.value = '200';
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page).toHaveURL(/maxPrice=200/);
    await expect(page.locator('#productResultCount')).toHaveText('3');
    const prices = await page.locator('#prodsGrid .prod-card').evaluateAll((cards) => cards.map((card) => Number(card.dataset.productPrice)));
    expect(prices.every((price) => price <= 200)).toBe(true);
  });

  test('8 Türkçe karakterli arama doğru ürünü bulur', async ({ page, e2eState }) => {
    await page.goto(`${e2eState.origins.storefront}/urunler?q=${encodeURIComponent('İPEK ŞAL İSTANBUL')}`);
    await expect(page.locator('#prodsGrid .prod-card')).toHaveCount(1);
    await expect(page.locator('#prodsGrid .prod-card').first()).toHaveAttribute('data-product-id', String(e2eState.fixtures.tenantA.productId));
    await expect(page.locator('#collectionTitle')).toContainText('İPEK ŞAL İSTANBUL');
  });

  test('9-11 ürün detayı açılır, varyant seçilir ve sepete eklenir', async ({ page, e2eState }) => {
    await page.goto(`${e2eState.origins.storefront}/urun?id=${e2eState.fixtures.tenantA.productId}`);
    await expect(page.locator('#detailProductTitle')).toHaveText(e2eState.fixtures.tenantA.productName);
    const secondColor = page.locator('#detailColors .swatch').nth(1);
    await expect(secondColor).toBeEnabled();
    await secondColor.click();
    await expect(secondColor).toHaveClass(/active/);
    const enabledSize = page.locator('#detailSizes .size-btn:not([disabled])').first();
    await enabledSize.click();
    await expect(enabledSize).toHaveClass(/active/);
    await page.locator('#detailAddCartBtn').click();
    await expect(page.locator('#detailAddCartBtn')).toContainText('Sepete Eklendi');
    const cart = await page.evaluate(() => JSON.parse(localStorage.getItem('suveraCart') || '[]'));
    expect(cart).toHaveLength(1);
    expect(String(cart[0].product_id)).toBe(String(e2eState.fixtures.tenantA.productId));
    expect(cart[0].variant_id).toBeTruthy();
  });

  test('ürün galerisi seçili medyayı viewport lightbox içinde açar ve gezdirir', async ({ page, e2eState }) => {
    const productId = e2eState.fixtures.tenantA.productId;
    const firstImage = `${e2eState.origins.storefront}/favicon.svg?gallery=1`;
    const secondImage = `${e2eState.origins.storefront}/favicon.svg?gallery=2`;
    await page.route(`**/api/products/${productId}*`, async (route) => {
      const response = await route.fetch();
      const product = await response.json();
      await route.fulfill({ response, json: { ...product, images: [firstImage, secondImage] } });
    });

    await page.goto(`${e2eState.origins.storefront}/urun?id=${productId}`);
    const thumbs = page.locator('#detailThumbs .thumb-btn');
    await expect(thumbs).toHaveCount(2);
    await thumbs.nth(1).click();
    await expect(page.locator('#galleryCounter')).toHaveText('2 / 2');

    await page.locator('#detailMainMedia').click();
    const lightbox = page.locator('#imageLightbox');
    const image = page.locator('#imageLightboxImg');
    await expect(lightbox).toHaveClass(/open/);
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute('src', secondImage);
    await expect(page.locator('#imageLightboxCount')).toHaveText('2 / 2');
    expect(await lightbox.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.x === 0 && box.y === 0 && box.width === innerWidth && box.height === innerHeight;
    })).toBe(true);

    await page.locator('#imageLightboxNext').click();
    await expect(image).toHaveAttribute('src', firstImage);
    await expect(page.locator('#imageLightboxCount')).toHaveText('1 / 2');
    await page.locator('#imageLightboxPrev').click();
    await expect(image).toHaveAttribute('src', secondImage);
    await page.locator('#imageLightboxClose').click();
    await expect(lightbox).not.toHaveClass(/open/);
    await expect(lightbox).toHaveAttribute('aria-hidden', 'true');
  });

  test('12-14 sepet miktarı artar, azalır ve ürün silinir', async ({ page, e2eState }) => {
    await setCart(page, e2eState, e2eState.fixtures.tenantA);
    await page.goto(`${e2eState.origins.storefront}/sepet`);
    const row = page.locator('#cartItems .cart-item');
    await expect(row).toHaveCount(1);
    await row.locator('[data-action="cart-qty"][data-delta="1"]').click();
    await expect(row.locator('.qty-num')).toHaveText('2');
    await row.locator('[data-action="cart-qty"][data-delta="-1"]').click();
    await expect(row.locator('.qty-num')).toHaveText('1');
    await row.locator('[data-action="cart-remove"]').click();
    await expect(row).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('suveraCart') || '[]'))).toHaveLength(0);
  });

  test('15-16 geçerli kupon uygulanır ve geçersiz kupon reddedilir', async ({ page, e2eState }) => {
    await setCart(page, e2eState, e2eState.fixtures.tenantA);
    await page.goto(`${e2eState.origins.storefront}/sepet`);
    await page.locator('#cartCouponCode').fill('E2E20');
    await page.locator('#cartCouponApply').click();
    await expect(page.locator('#cartCouponResult')).toContainText(/Kupon uygulandı|Yeni toplam/i);
    await page.locator('#cartCouponCode').fill('GECERSIZ');
    await page.locator('#cartCouponApply').click();
    await expect(page.locator('#cartCouponResult')).toContainText(/geçersiz|gecersiz|bulunamadı|uygulanamadı/i);
  });

  test('17 IBAN/manual sipariş gerçek API ile oluşturulur', async ({ page, e2eState }) => {
    await setCart(page, e2eState, e2eState.fixtures.tenantA);
    await page.goto(`${e2eState.origins.storefront}/siparis`);
    await fillCheckout(page, { email: 'iban-order@example.test' });
    await page.locator('input[name="paymentMethod"][value="iban"]').check();
    await page.locator('#payButton').click();
    await page.waitForURL(/\/tesekkur\?order=/, { timeout: 30_000 });
    await expect(page.locator('#thankYouOrderCode')).not.toHaveText('-');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('suveraCart') || '[]'))).toHaveLength(0);
  });

  test('18 test ortamında mock kart ödeme tamamlanır', async ({ page, e2eState }) => {
    await setCart(page, e2eState, e2eState.fixtures.tenantA);
    await page.goto(`${e2eState.origins.storefront}/siparis`);
    await fillCheckout(page, { email: 'mock-card@example.test' });
    await expect(page.locator('input[name="paymentMethod"][value="card"]')).toBeChecked();
    await page.locator('#payButton').click();
    await page.waitForURL(/\/tesekkur(?:\?|$)/, { timeout: 30_000 });
    await expect(page.locator('#thankYouOrderCode')).not.toHaveText('-');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('suveraCart') || '[]'))).toHaveLength(0);
  });

  test('19 müşteri yeni hesap kaydı oluşturur', async ({ page, e2eState }) => {
    const email = `register-${Date.now()}@example.test`;
    await page.goto(`${e2eState.origins.storefront}/giris`);
    await page.locator('[data-action="show-register"]').click();
    await page.locator('#registerNameInput').fill('Yeni E2E Müşteri');
    await page.locator('#registerEmailInput').fill(email);
    await page.locator('#registerPwInput').fill('E2E-Strong-Password-49!');
    await page.locator('[data-action="do-register"]').click();
    await expect(page.locator('#verifyBanner')).toBeVisible();
    await expect(page.locator('#verifyBanner')).toContainText(/doğrulayın|dogrulayin/i);
  });

  test('20,22-23 müşteri giriş, sipariş geçmişi ve logout akışı çalışır', async ({ page, e2eState }) => {
    await page.goto(`${e2eState.origins.storefront}/giris`);
    await page.locator('#emailInput').fill(e2eState.credentials.customerA.email);
    await page.locator('#pwInput').fill(e2eState.credentials.customerA.password);
    await page.locator('[data-action="do-login"]').click();
    await page.waitForURL(/\/hesabim/, { timeout: 20_000 });
    await expect(page.locator('#accountOrders')).toContainText('E2E-A-ORDER');
    expect(await page.evaluate(() => localStorage.getItem('suveraCustomerSession'))).toBe('active');
    await page.locator('#accountLogout').click();
    await page.waitForURL(/\/giris/);
    expect(await page.evaluate(() => localStorage.getItem('suveraCustomerSession'))).toBeNull();
  });

  test('A10 sipariş takip controller/repository ayrımında public sözleşme korunur', async ({ page, e2eState }) => {
    await page.goto(`${e2eState.origins.storefront}/siparis-takip`);
    await page.locator('#trackingOrderInput').fill('E2E-A-ORDER');
    await page.locator('#trackingEmailInput').fill(e2eState.credentials.customerA.email);
    await page.locator('#trackingForm').getByRole('button', { name: 'Durumu Goster' }).click();
    await expect(page.locator('#trackingResult')).toContainText('E2E-A-ORDER');
    await expect(page.locator('#trackingResult')).toContainText(/Ödeme alındı|Odeme alindi|paid/i);
  });

  test('21 favori ekleme ve çıkarma çalışır', async ({ page, e2eState }) => {
    await page.goto(`${e2eState.origins.storefront}/urunler`);
    const card = page.locator('#prodsGrid .prod-card').first();
    await expect(card).toHaveAttribute('data-product-id', /\d+/);
    await card.locator('[data-action="toggle-fav"]').click();
    await page.goto(`${e2eState.origins.storefront}/favoriler`);
    await expect(page.locator('#favoritesCount')).toHaveText('1');
    await expect(page.locator('#favoritesGrid [data-favorite-id]')).toHaveCount(1);
    await page.locator('#favoritesGrid [data-remove-favorite]').click();
    await expect(page.locator('#favoritesCount')).toHaveText('0');
  });

  test('24 mobil menü açılır ve kapanır', async ({ page, e2eState }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(e2eState.origins.storefront);
    await page.locator('.hamburger').click();
    await expect(page.locator('#mobileNav')).toHaveClass(/open/);
    await page.locator('#mobileNav [data-action="close-mobile-nav"]').last().click();
    await expect(page.locator('#mobileNav')).not.toHaveClass(/open/);
  });

  test('25 checkout sırasında stok değişirse açıklayıcı mesaj gösterilir ve sepet korunur', async ({ page, e2eState }) => {
    const race = e2eState.fixtures.raceProduct;
    await setCart(page, e2eState, race, { color: 'Lacivert', size: 'M', variant: 'Lacivert / M' });
    const consumed = await page.evaluate(async ({ productId, variantId }) => {
      return window.SuveraAPI.payment.initialize({
        customer: { name: 'Race Winner', email: 'race-winner@example.test', phone: '05550000999', address: 'Test' },
        items: [{ product_id: productId, variant_id: variantId, quantity: 1 }],
        paymentMethod: 'card',
        successUrl: `${location.origin}/tesekkur`,
        failureUrl: `${location.origin}/tesekkur?payment=failed`,
      });
    }, { productId: race.id, variantId: race.variantId });
    expect(consumed.orderCode || consumed.order_code).toBeTruthy();
    await page.goto(`${e2eState.origins.storefront}/siparis`);
    await fillCheckout(page, { email: 'race-loser@example.test' });
    await page.locator('#payButton').click();
    await expect(page.locator('#checkoutError')).toContainText(/stok|stoğa/i);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('suveraCart') || '[]'))).toHaveLength(1);
  });

  test('26 başarısız gerçek test ödemesinden sonra sepet korunur', async ({ page, e2eState }) => {
    await setCart(page, e2eState, e2eState.fixtures.tenantA);
    await page.goto(`${e2eState.origins.storefront}/siparis`);
    await fillCheckout(page, { email: 'e2e-payment-fail@example.test' });
    await page.locator('#payButton').click();
    await expect(page.locator('#checkoutError')).toBeVisible();
    await expect(page.locator('#checkoutError')).toContainText(/ödeme|tekrar deneyin/i);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('suveraCart') || '[]'))).toHaveLength(1);
  });
});
