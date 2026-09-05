const { test, expect } = require('@playwright/test');
const path = require('node:path');
const manifest = require('../fixtures/spin360/manifest.json');

const imagePath = path.join(__dirname, '../fixtures/spin360', manifest.frames[0]);
const spinProduct = {
  id: 77, name: 'Actuel Nervürlü Elbise 35134-KT', price: '1599', status: 'active', stock: 4,
  category_name: 'Elbise', images: ['/card-test/spin.webp'], colors: [], sizes: [], variants: [],
  details: {}, has_spin360: true,
};
const ordinaryProduct = {
  id: 78, name: 'Klasik Elbise', price: '1299', status: 'active', stock: 3,
  category_name: 'Elbise', images: ['/card-test/plain.webp'], colors: [], sizes: [], variants: [],
  details: {}, has_spin360: false,
};

async function openCatalog(page, width, height) {
  const spinRequests = [];
  page.on('request', (request) => {
    if (/spin-test|spin360|\/api\/media\/.+\/detail/.test(request.url())) spinRequests.push(request.url());
  });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    let body = {};
    if (url.pathname.endsWith('/catalog/products')) {
      body = { items: [spinProduct, ordinaryProduct], total: 2, page: 1, pageSize: 24, totalPages: 1,
        facets: { categories: [], collections: [], colors: [], sizes: [], price: { min: 0, max: 2000 } } };
    } else if (/\/(categories|collections)$/.test(url.pathname)) body = [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/card-test/*', (route) => route.fulfill({ path: imagePath, contentType: 'image/webp' }));
  await page.setViewportSize({ width, height });
  await page.goto('/urunler?q=elbise');
  const consent = page.getByRole('button', { name: 'Yalnızca Zorunlu', exact: true });
  if (await consent.isVisible()) await consent.click();
  await expect(page.locator('.prod-card')).toHaveCount(2);
  return spinRequests;
}

for (const [width, height] of [[390, 844], [412, 915], [430, 932], [768, 1000], [1440, 1000]]) {
  test(`${width}: catalog badge is selective, clear, and does not load rotation frames`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const spinRequests = await openCatalog(page, width, height);
    const spinCard = page.locator('.prod-card[data-product-id="77"]');
    const plainCard = page.locator('.prod-card[data-product-id="78"]');
    await expect(spinCard.locator('.spin-product-badge')).toHaveCount(1);
    await expect(spinCard.locator('.spin-product-badge')).toHaveAccessibleName('360 derece görünüm mevcut');
    await expect(plainCard.locator('.spin-product-badge')).toHaveCount(0);
    await expect(spinCard).toHaveAttribute('data-has-spin360', 'true');
    await expect(plainCard).toHaveAttribute('data-has-spin360', 'false');
    expect(await spinCard.locator('.spin-product-badge').evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
    const badge = await spinCard.locator('.spin-product-badge').boundingBox();
    const actions = await spinCard.locator('.prod-media-actions').boundingBox();
    expect(badge.x + badge.width <= actions.x || actions.x + actions.width <= badge.x).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(spinRequests).toEqual([]);
    expect(errors).toEqual([]);
  });
}
