'use strict';

const { expect, test } = require('../fixtures.cjs');

test.describe('A32 performance and Web Vitals', () => {
  test('collector samples only after consent, normalizes routes and never blocks the storefront', async ({ page, e2eState }) => {
    const beacons = [];
    await page.route('**/api/web-vitals', async (route) => {
      const request = route.request();
      try { beacons.push(JSON.parse(request.postData() || '{}')); } catch (_) { /* assertion below */ }
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline"}' });
    });
    await page.addInitScript(() => {
      localStorage.setItem('suvera:privacy-consent:v1', 'analytics');
      window.SUVERA_RUM_SAMPLE_RATE = 1;
    });

    await page.goto(`${e2eState.origins.storefront}/?customer=928&email=private@example.test`);
    await expect(page.locator('#homeProductsGrid .prod-card')).toHaveCount(8);
    await expect.poll(() => beacons.some((item) => item.name === 'TTFB')).toBe(true);
    const ttfb = beacons.find((item) => item.name === 'TTFB');
    expect(Object.keys(ttfb).sort()).toEqual(['build', 'name', 'navigationType', 'route', 'value']);
    expect(ttfb.route).toBe('/anasayfa');
    expect(Number.isFinite(ttfb.value)).toBe(true);
    expect(JSON.stringify(ttfb)).not.toMatch(/private@|customer|928|cookie|token/i);
    expect(await page.evaluate(() => Boolean(window.SuveraWebVitals))).toBe(true);
  });

  test('zero sampling sends no beacon while the business page still loads', async ({ page, e2eState }) => {
    let beaconCount = 0;
    await page.route('**/api/web-vitals', async (route) => {
      beaconCount += 1;
      await route.fulfill({ status: 202, contentType: 'application/json', body: '{"ok":true}' });
    });
    await page.addInitScript(() => {
      localStorage.setItem('suvera:privacy-consent:v1', 'analytics');
      window.SUVERA_RUM_SAMPLE_RATE = 0;
    });
    await page.goto(e2eState.origins.storefront);
    await expect(page.locator('#homeProductsGrid .prod-card')).toHaveCount(8);
    expect(beaconCount).toBe(0);
  });

  test('RUM endpoint accepts the four allowlisted metrics and rejects labels/ranges', async ({ request, e2eState }) => {
    for (const [name, value] of [['LCP', 2100], ['CLS', 0.08], ['INP', 175], ['TTFB', 90]]) {
      const response = await request.post(`${e2eState.origins.storefront}/api/web-vitals`, {
        data: { name, value, route: '/urun/928?token=secret', navigationType: 'navigate', build: 'e2e-a32' },
      });
      expect(response.status()).toBe(202);
      expect(response.headers()['cache-control']).toContain('no-store');
    }
    const arbitrary = await request.post(`${e2eState.origins.storefront}/api/web-vitals`, {
      data: { name: 'LCP', value: 10, route: '/', email: 'private@example.test' },
    });
    expect(arbitrary.status()).toBe(400);
    const invalid = await request.post(`${e2eState.origins.storefront}/api/web-vitals`, {
      data: { name: 'CLS', value: 999, route: '/' },
    });
    expect(invalid.status()).toBe(400);
  });

  test('public catalog ETag revalidates to 304 and private cart remains no-store', async ({ page, request, e2eState }) => {
    const query = new URLSearchParams({
      organizationSlug: e2eState.credentials.tenantA.slug,
      publicAccessToken: e2eState.database.publicAccessToken,
      page: '1',
      pageSize: '8',
    });
    const url = `${e2eState.origins.storefront}/api/catalog/products?${query}`;
    const first = await request.get(url);
    expect(first.status()).toBe(200);
    expect(first.headers()['cache-control']).toMatch(/public.*s-maxage/);
    const etag = first.headers().etag;
    expect(etag).toBeTruthy();
    const second = await request.get(url, { headers: { 'If-None-Match': etag } });
    expect(second.status()).toBe(304);

    await page.goto(e2eState.origins.storefront);
    const cartHeaders = await page.evaluate(async () => {
      const response = await fetch('/api/cart', { credentials: 'same-origin' });
      return { status: response.status, cacheControl: response.headers.get('cache-control') };
    });
    expect(cartHeaders.status).toBe(200);
    expect(cartHeaders.cacheControl).toContain('no-store');
  });
});
