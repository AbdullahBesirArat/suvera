'use strict';

const {
  bff,
  ensureSuperAdminMfa,
  expect,
  loginAdmin,
  storageSnapshot,
  test,
} = require('../fixtures.cjs');

async function replaceAccessCookie(context, origin, value = 'invalid-e2e-access-token') {
  await context.clearCookies({ name: 'pnl_at' });
  const url = new URL(origin);
  await context.addCookies([{
    name: 'pnl_at',
    value,
    domain: url.hostname,
    path: '/api/bff',
    httpOnly: true,
    sameSite: 'Lax',
    secure: false,
  }]);
}

async function runAuthBurst(page) {
  return page.evaluate(async () => {
    if (typeof window.__PANELYA_E2E_AUTH_BURST__ !== 'function') {
      throw new Error('E2E auth burst hook is unavailable');
    }
    const results = await window.__PANELYA_E2E_AUTH_BURST__([
      '/products?limit=2',
      '/categories',
      '/customers?limit=2',
      '/orders?limit=2',
    ]);
    return results.map((result) => result.status);
  });
}

test.describe('A04 Panelya HttpOnly BFF auth', () => {
  test('1-11 login çalışır; tokenlar Web Storage/body yerine güvenli HttpOnly cookie kullanır', async ({ page, context, e2eState }) => {
    const responsePromise = page.waitForResponse((response) => response.url().includes('/api/bff/auth/session/login'));
    await loginAdmin(page, e2eState);
    const loginResponse = await responsePromise;
    expect(loginResponse.status()).toBe(200);
    const body = await loginResponse.json();
    expect(body).not.toHaveProperty('accessToken');
    expect(body).not.toHaveProperty('refreshToken');

    const storage = await storageSnapshot(page);
    const parsedStorage = Object.values(storage.local).map((value) => JSON.parse(value));
    const storageKeys = [];
    const storageValues = [];
    const visit = (value) => {
      if (!value || typeof value !== 'object') {
        storageValues.push(value);
        return;
      }
      for (const [key, nested] of Object.entries(value)) {
        storageKeys.push(key.toLowerCase());
        visit(nested);
      }
    };
    parsedStorage.forEach(visit);
    for (const forbidden of ['accesstoken', 'refreshtoken', 'restoretoken', 'impersonationtoken']) {
      expect(storageKeys).not.toContain(forbidden);
    }
    expect(storageValues.some((value) => typeof value === 'string' && /^eyJ[\w-]*\./.test(value))).toBe(false);

    const cookies = await context.cookies(`${e2eState.origins.admin}/api/bff`);
    const access = cookies.find((cookie) => cookie.name === 'pnl_at');
    const refresh = cookies.find((cookie) => cookie.name === 'pnl_rt');
    expect(access).toMatchObject({ httpOnly: true, sameSite: 'Lax', secure: false, path: '/api/bff' });
    expect(refresh).toMatchObject({ httpOnly: true, sameSite: 'Lax', secure: false, path: '/api/bff' });
    expect(await page.evaluate(() => document.cookie)).not.toContain('pnl_at');
    expect(await page.evaluate(() => document.cookie)).not.toContain('pnl_rt');
  });

  test('12 refresh başarıyla tamamlanır ve eşzamanlı istekler tek refresh paylaşır', async ({ page, context, e2eState }) => {
    await loginAdmin(page, e2eState);
    await page.goto(`${e2eState.origins.admin}/products`);
    await expect.poll(() => page.evaluate(() => typeof window.__PANELYA_E2E_AUTH_BURST__)).toBe('function');
    await replaceAccessCookie(context, e2eState.origins.admin);
    let refreshCount = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/bff/auth/session/refresh')) refreshCount += 1;
    });
    const statuses = await runAuthBurst(page);
    expect(statuses).toEqual(['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled']);
    expect(refreshCount).toBe(1);
    const access = (await context.cookies(`${e2eState.origins.admin}/api/bff`)).find((cookie) => cookie.name === 'pnl_at');
    expect(access && access.value).not.toBe('invalid-e2e-access-token');
  });

  test('refresh başarısızsa bütün bekleyen istekler tutarlı auth hatası alır ve yine tek refresh gider', async ({ page, context, e2eState }) => {
    await loginAdmin(page, e2eState);
    await page.goto(`${e2eState.origins.admin}/products`);
    await expect.poll(() => page.evaluate(() => typeof window.__PANELYA_E2E_AUTH_BURST__)).toBe('function');
    await context.clearCookies({ name: 'pnl_rt' });
    await replaceAccessCookie(context, e2eState.origins.admin);
    let refreshCount = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/bff/auth/session/refresh')) refreshCount += 1;
    });
    const statuses = await runAuthBurst(page);
    expect(statuses).toEqual(['rejected', 'rejected', 'rejected', 'rejected']);
    expect(refreshCount).toBe(1);
    const session = JSON.parse(await page.evaluate(() => localStorage.getItem('panelya-web-session')) || '{}');
    expect(session.state && session.state.authenticated).toBe(false);
  });

  test('13-14 logout cookie temizler ve korumalı sayfayı login ekranına yönlendirir', async ({ page, context, e2eState }) => {
    await loginAdmin(page, e2eState);
    await page.getByRole('button', { name: 'Çıkış', exact: true }).last().click();
    await page.waitForURL(/\/login/, { timeout: 20_000 });
    const cookies = await context.cookies(`${e2eState.origins.admin}/api/bff`);
    expect(cookies.some((cookie) => ['pnl_at', 'pnl_rt', 'pnl_ar'].includes(cookie.name))).toBe(false);
    await page.goto(`${e2eState.origins.admin}/products`);
    await page.waitForURL(/\/login/);
  });

  test('refresh rotation rejects reuse and revokes the whole session family', async ({ page, context, e2eState }) => {
    await loginAdmin(page, e2eState);
    const summary = await bff(page, '/security/summary');
    const sessionId = summary.body.sessions.find((session) => session.is_current).id;
    const before = await context.cookies(`${e2eState.origins.admin}/api/bff`);
    const oldRefresh = before.find((cookie) => cookie.name === 'pnl_rt');
    expect(oldRefresh).toBeTruthy();

    const rotated = await bff(page, '/auth/session/refresh', { method: 'POST', body: {} });
    expect(rotated.status).toBe(200);
    const currentRefresh = (await context.cookies(`${e2eState.origins.admin}/api/bff`))
      .find((cookie) => cookie.name === 'pnl_rt');
    expect(currentRefresh.value).not.toBe(oldRefresh.value);

    await context.clearCookies({ name: 'pnl_rt' });
    await context.addCookies([{ ...oldRefresh, sameSite: 'Lax' }]);
    const replay = await bff(page, '/auth/session/refresh', { method: 'POST', body: {} });
    expect(replay.status).toBe(401);
    const [session] = await require('../lib/db.cjs').dbQuery(
      'select revoked_at, revoke_reason from auth_sessions where id = $1', [sessionId]
    );
    expect(session.revoked_at).not.toBeNull();
    expect(session.revoke_reason).toBe('refresh_reuse');
    expect((await bff(page, '/products?limit=1')).status).toBe(401);
  });

  test('browser sends no bearer to the BFF and multi-tab logout closes the shared session', async ({ page, context, e2eState }) => {
    const browserAuthorizations = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/bff/')) browserAuthorizations.push(request.headers().authorization || null);
    });
    await loginAdmin(page, e2eState);
    expect((await bff(page, '/products?limit=1')).status).toBe(200);
    expect(browserAuthorizations.filter(Boolean)).toEqual([]);

    const otherTab = await context.newPage();
    await otherTab.goto(`${e2eState.origins.admin}/products`);
    await expect(otherTab).toHaveURL(/\/products/);
    await page.goto(`${e2eState.origins.admin}/dashboard`);
    await page.getByRole('button', { name: 'Çıkış', exact: true }).last().click();
    await page.waitForURL(/\/login/);
    await otherTab.reload();
    await otherTab.waitForURL(/\/login/);
  });

  test('15 geçersiz Origin reddedilir', async ({ request, e2eState }) => {
    const response = await request.post(`${e2eState.origins.admin}/api/bff/auth/session/login`, {
      headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'same-origin' },
      data: {},
    });
    expect(response.status()).toBe(403);
  });

  test('16 geçersiz Referer reddedilir', async ({ request, e2eState }) => {
    const response = await request.post(`${e2eState.origins.admin}/api/bff/auth/session/login`, {
      headers: { referer: 'https://attacker.example/form', 'sec-fetch-site': 'same-origin' },
      data: {},
    });
    expect(response.status()).toBe(403);
  });

  test('17 cross-site Sec-Fetch-Site reddedilir', async ({ request, e2eState }) => {
    const response = await request.post(`${e2eState.origins.admin}/api/bff/auth/session/login`, {
      headers: { origin: e2eState.origins.admin, 'sec-fetch-site': 'cross-site' },
      data: {},
    });
    expect(response.status()).toBe(403);
  });

  test('18 upstream timeout kontrollü 502 döndürür', async ({ request, e2eState }) => {
    // Must exceed the suite's BFF budget (5 s), which is itself set well above the real
    // service time of every other endpoint so this one assertion cannot starve them.
    const response = await request.get(`${e2eState.origins.admin}/api/bff/__e2e__/delay?ms=8000`, {
      timeout: 30_000,
    });
    expect(response.status()).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: 'Upstream request failed' });
  });

  test('19-23 super-admin impersonation, tenant görünümü ve güvenli restore akışı çalışır', async ({ page, context, e2eState }) => {
    await loginAdmin(page, e2eState, { superAdmin: true });
    await ensureSuperAdminMfa(page, e2eState);
    await page.getByRole('button', { name: 'Mağazalar', exact: true }).click();
    const row = page.locator('tr').filter({ hasText: 'Suvera E2E' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Detay', exact: true }).click();
    await page.getByRole('button', { name: 'Mağaza paneline gir', exact: true }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
    await expect(page.getByText(/Platform yöneticisi olarak görüntülüyorsunuz/)).toBeVisible();

    const impersonationCookies = await context.cookies(`${e2eState.origins.admin}/api/bff`);
    const restore = impersonationCookies.find((cookie) => cookie.name === 'pnl_ar');
    expect(restore).toMatchObject({ httpOnly: true, sameSite: 'Lax', secure: false, path: '/api/bff' });
    expect(await page.evaluate(() => document.cookie)).not.toContain('pnl_ar');
    const duringStorage = JSON.stringify(await storageSnapshot(page));
    expect(duringStorage).not.toContain(restore.value);

    const products = await bff(page, '/products?limit=100');
    expect(products.status).toBe(200);
    expect(products.body.some((product) => String(product.id) === String(e2eState.fixtures.tenantA.productId))).toBe(true);
    expect(products.body.some((product) => String(product.id) === String(e2eState.fixtures.tenantB.productId))).toBe(false);

    await page.getByRole('button', { name: 'Platform yönetimine dön', exact: true }).click();
    await page.waitForURL(/\/superadmin/, { timeout: 20_000 });
    const restoredCookies = await context.cookies(`${e2eState.origins.admin}/api/bff`);
    expect(restoredCookies.some((cookie) => cookie.name === 'pnl_ar')).toBe(false);
    expect(restoredCookies.some((cookie) => cookie.name === 'pnl_at' && cookie.httpOnly)).toBe(true);
    const session = JSON.parse(await page.evaluate(() => localStorage.getItem('panelya-web-session')) || '{}');
    expect(session.state.actorType).toBe('admin');
  });

  test('24-26 admin ürün oluşturur, ürünü ve varyantı günceller', async ({ page, e2eState }) => {
    await loginAdmin(page, e2eState);
    const sku = `E2E-CREATED-${Date.now()}`;
    const createPayload = {
      name: `E2E Admin Ürünü ${Date.now()}`,
      category_id: e2eState.fixtures.tenantA.categoryId,
      price: 425,
      sale_price: null,
      stock: 4,
      status: 'active',
      colors: ['Mor'],
      sizes: ['M'],
      variants: [{ color: 'Mor', size: 'M', sku, stock: 4, is_default: true, is_active: true, status: 'active' }],
      images: [],
      details: { short_description: 'Playwright sentetik ürün' },
      tags: 'e2e,admin',
      description: 'Yalnızca disposable test veritabanında oluşturulur.',
      product_story: 'E2E',
      auto_generate_sku: false,
    };
    const created = await bff(page, '/products', { method: 'POST', body: createPayload });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe(createPayload.name);
    expect(created.body.variants).toHaveLength(1);
    expect(created.body.variants[0].sku).toBe(sku);

    const updatePayload = {
      ...createPayload,
      name: `${createPayload.name} Güncel`,
      price: 499,
      stock: 2,
      variants: [{ ...created.body.variants[0], color: 'Mor', size: 'M', sku, stock: 2, is_default: true, is_active: true, status: 'active' }],
    };
    const updated = await bff(page, `/products/${created.body.id}`, { method: 'PUT', body: updatePayload });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe(updatePayload.name);
    expect(Number(updated.body.price)).toBe(499);
    expect(updated.body.variants[0].stock).toBe(2);
  });

  test('27-29 Tenant A admini Tenant B ürün, sipariş ve müşterisine erişemez', async ({ page, e2eState }) => {
    await loginAdmin(page, e2eState);
    const [product, order, customers] = await Promise.all([
      bff(page, `/products/${e2eState.fixtures.tenantB.productId}`),
      bff(page, `/orders/${e2eState.fixtures.tenantB.orderId}`),
      bff(page, `/customers?q=${encodeURIComponent(e2eState.credentials.customerB.email)}`),
    ]);
    expect(product.status).toBe(404);
    expect(order.status).toBe(404);
    expect(customers.status).toBe(200);
    expect(customers.body).toEqual([]);
    expect(JSON.stringify(customers.body)).not.toContain(String(e2eState.fixtures.tenantB.customerId));
  });
});
