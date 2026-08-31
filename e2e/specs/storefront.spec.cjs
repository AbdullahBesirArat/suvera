'use strict';

const {
  expect,
  fillCheckout,
  setCart,
  test,
} = require('../fixtures.cjs');

async function swipe(locator, from, to) {
  await locator.dispatchEvent('pointerdown', {
    pointerId: 7, pointerType: 'touch', isPrimary: true,
    clientX: from.x, clientY: from.y,
  });
  await locator.dispatchEvent('pointerup', {
    pointerId: 7, pointerType: 'touch', isPrimary: true,
    clientX: to.x, clientY: to.y,
  });
}

test.describe('A03 Suvera storefront full-stack', () => {
  test('1-2 ana sayfa açılır ve canlı ürün/kategori listeleri yüklenir', async ({ page, e2eState }) => {
    await page.goto(e2eState.origins.storefront);
    await expect(page.locator('#homeProductsGrid .prod-card')).toHaveCount(8);
    await expect(page.locator('#homeCategoryGrid .cat-card')).toHaveCount(1);
    await expect(page.locator(`#homeProductsGrid .prod-card[data-product-id="${e2eState.fixtures.raceProduct.id}"]`)).toBeVisible();
  });

  test('mobil hero swipe yönü, wrap-around ve dikey scroll ayrımı korunur', async ({ page, e2eState }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(e2eState.origins.storefront);
    const slider = page.locator('#heroSlider');
    await page.evaluate(() => {
      const root = document.getElementById('heroSlider');
      root.hidden = false;
      root.querySelectorAll(':scope > .slide').forEach((slide) => slide.remove());
      root.insertAdjacentHTML('afterbegin', '<div class="slide active"></div><div class="slide"></div>');
      document.getElementById('heroSliderDots').innerHTML = '<button class="slider-dot active"></button><button class="slider-dot"></button>';
      window.rebuildHeroSlider();
    });

    await swipe(slider, { x: 320, y: 300 }, { x: 220, y: 306 });
    await expect(slider.locator(':scope > .slide').nth(1)).toHaveClass(/active/);
    await swipe(slider, { x: 320, y: 300 }, { x: 220, y: 306 });
    await expect(slider.locator(':scope > .slide').first()).toHaveClass(/active/);
    await swipe(slider, { x: 120, y: 300 }, { x: 230, y: 306 });
    await expect(slider.locator(':scope > .slide').nth(1)).toHaveClass(/active/);
    await swipe(slider, { x: 200, y: 240 }, { x: 225, y: 350 });
    await expect(slider.locator(':scope > .slide').nth(1)).toHaveClass(/active/);
  });

  test('3 katalog pagination ikinci sayfaya geçer', async ({ page, e2eState }) => {
    await page.goto(`${e2eState.origins.storefront}/urunler?sort=recommended`);
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
    await page.goto(`${e2eState.origins.storefront}/urunler?sort=recommended`);
    const unfilteredTotal = await page.locator('#productResultCount').textContent();
    const category = page.locator(`#collectionCategoryFilters input[value="${e2eState.fixtures.tenantA.categoryId}"]`);
    await expect(category).toBeVisible();
    await category.check();
    await expect(page).toHaveURL(new RegExp(`category=${e2eState.fixtures.tenantA.categoryId}`));
    await expect(category).toBeChecked();
    await expect(page.locator('#productResultCount')).toHaveText(unfilteredTotal);
  });

  test('5 renk filtresi seçimi kataloğa uygulanır', async ({ page, e2eState }) => {
    await page.goto(`${e2eState.origins.storefront}/urunler?sort=recommended`);
    const color = page.locator('#collectionColorFilters [data-color]').first();
    const value = await color.getAttribute('data-color');
    await color.click();
    await expect.poll(() => new URL(page.url()).searchParams.get('color')).toBe(value.toLocaleLowerCase('tr-TR'));
    await expect(page.locator(`#collectionColorFilters [data-color="${value}"]`)).toHaveClass(/act/);
    await expect(page.locator('#prodsGrid .prod-card').first()).toBeVisible();
  });

  test('6 beden filtresi seçimi kataloğa uygulanır', async ({ page, e2eState }) => {
    await page.goto(`${e2eState.origins.storefront}/urunler?sort=recommended`);
    const size = page.locator('#collectionSizeFilters [data-size]').first();
    const value = await size.getAttribute('data-size');
    await size.click();
    await expect(page).toHaveURL(new RegExp(`size=${value}`));
    await expect(page.locator(`#collectionSizeFilters [data-size="${value}"]`)).toHaveClass(/act/);
    await expect(page.locator('#prodsGrid .prod-card').first()).toBeVisible();
  });

  test('7 fiyat filtresi sunucu sonuçlarını sınırlar', async ({ page, e2eState }) => {
    await page.goto(`${e2eState.origins.storefront}/urunler?sort=recommended`);
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
    const mainMedia = page.locator('#detailMainMedia');
    await swipe(mainMedia, { x: 300, y: 300 }, { x: 210, y: 305 });
    await expect(page.locator('#galleryCounter')).toHaveText('2 / 2');
    await expect(thumbs.nth(1)).toHaveClass(/active/);
    await swipe(mainMedia, { x: 120, y: 300 }, { x: 220, y: 305 });
    await expect(page.locator('#galleryCounter')).toHaveText('1 / 2');
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

    await swipe(page.locator('#imageLightboxStage'), { x: 300, y: 300 }, { x: 210, y: 305 });
    await expect(image).toHaveAttribute('src', firstImage);
    await expect(page.locator('#imageLightboxCount')).toHaveText('1 / 2');
    await swipe(page.locator('#imageLightboxStage'), { x: 120, y: 300 }, { x: 220, y: 305 });
    await expect(image).toHaveAttribute('src', secondImage);
    await expect(page.locator('#imageLightboxCount')).toHaveText('2 / 2');

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
    await page.goto(`${e2eState.origins.storefront}/siparis`);
    await page.locator('#checkoutCouponCode').fill('E2E20');
    await page.locator('#checkoutCouponApply').click();
    await expect(page.locator('#checkoutCouponFeedback')).toContainText(/Kupon uygulandı|Kupon uygulandi|Yeni toplam/i);
    await page.locator('#checkoutCouponCode').fill('GECERSIZ');
    await page.locator('#checkoutCouponApply').click();
    await expect(page.locator('#checkoutCouponFeedback')).toContainText(/geçersiz|gecersiz|bulunamadı|uygulanamadı/i);
  });

  test('17 IBAN/manual sipariş gerçek API ile oluşturulur', async ({ page, e2eState }) => {
    await setCart(page, e2eState, e2eState.fixtures.tenantA);
    await page.goto(`${e2eState.origins.storefront}/siparis`);
    await fillCheckout(page, { email: 'iban-order@example.test' });
    await expect(page.locator('input[name="paymentMethod"][value="iban"]')).toBeChecked();
    await page.locator('#payButton').click();
    await page.waitForURL(/\/tesekkur\?order=/, { timeout: 30_000 });
    await expect(page.locator('#thankYouOrderCode')).not.toHaveText('-');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('suveraCart') || '[]'))).toHaveLength(0);
  });

  test('18 checkout yalnız canonical IBAN yöntemini gösterir', async ({ page, e2eState }) => {
    await setCart(page, e2eState, e2eState.fixtures.tenantA);
    await page.goto(`${e2eState.origins.storefront}/siparis`);
    await expect(page.locator('input[name="paymentMethod"]')).toHaveCount(1);
    await expect(page.locator('input[name="paymentMethod"][value="iban"]')).toBeChecked();
    await expect(page.locator('input[name="paymentMethod"][value="card"]')).toHaveCount(0);
    await expect(page.locator('#paymentMethodTitle')).toHaveText('Ödeme');
    await expect(page.getByText('Banka Havalesi / EFT', { exact: true })).toBeVisible();
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
    await page.goto(`${e2eState.origins.storefront}/urunler?sort=recommended`);
    const card = page.locator('#prodsGrid .prod-card').first();
    await expect(card).toHaveAttribute('data-product-id', /\d+/);
    await expect(card.locator('.quick-add')).toHaveCount(0);
    await expect(card.locator('.prod-img > .prod-media-actions')).toHaveCount(1);
    await expect(card.locator('.quick-fav')).toHaveAttribute('aria-label', 'Favorilere ekle');
    await expect(card.locator('.quick-view')).toHaveAttribute('aria-label', 'Ürünü hızlı görüntüle');
    await card.locator('[data-action="toggle-fav"]').click();
    await expect(card.locator('.quick-fav')).toHaveAttribute('aria-label', 'Favorilerden çıkar');
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
    await page.route('**/api/orders', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'E2E sipariş hatası' } }),
      });
    });
    await page.goto(`${e2eState.origins.storefront}/siparis`);
    await fillCheckout(page, { email: 'e2e-payment-fail@example.test' });
    await page.locator('#payButton').click();
    await expect(page.locator('#checkoutError')).toBeVisible();
    await expect(page.locator('#checkoutError')).toContainText(/sipariş|tekrar deneyin/i);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('suveraCart') || '[]'))).toHaveLength(1);
  });
});
