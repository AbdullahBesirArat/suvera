'use strict';

const {
  expect,
  fillCheckout,
  setCart,
  storageSnapshot,
  test,
} = require('../fixtures.cjs');
const { dbQuery, cartToken } = require('../lib/db.cjs');
const { readState } = require('../lib/state.cjs');

// Give the shared fixture variant ample stock so conversion checkouts never race
// the baseline suite for the last unit. Adding on_hand also lifts the generated
// `available` column; it never removes stock, so baseline assumptions still hold.
test.beforeAll(async () => {
  const state = readState();
  await dbQuery(
    'update product_variants set on_hand = on_hand + 50 where organization_id = $1 and id = $2',
    [state.fixtures.tenantA.organizationId, state.fixtures.tenantA.variantId],
    state
  );
  await dbQuery(
    'update products set status = \'active\', stock = stock + 50 where organization_id = $1 and id = $2',
    [state.fixtures.tenantA.organizationId, state.fixtures.tenantA.productId],
    state
  );
});

async function serverCartId(page) {
  await expect
    .poll(() => page.evaluate(() => (window.Suvera && window.Suvera.currentServerCart && window.Suvera.currentServerCart.id) || null))
    .toBeTruthy();
  return page.evaluate(() => window.Suvera.currentServerCart.id);
}

// Build a real guest cart in a throwaway context and return its server id.
async function buildGuestCart(browser, e2eState) {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await setCart(page, e2eState, e2eState.fixtures.tenantA);
    await page.goto(`${e2eState.origins.storefront}/sepet`);
    await expect(page.locator('#cartItems .cart-item')).toHaveCount(1);
    return await page.evaluate(() => window.Suvera.currentServerCart && window.Suvera.currentServerCart.id);
  } finally {
    await ctx.close();
  }
}

// Abandon a cart and seed a delivered recovery reminder for it, exactly as the
// worker would: only the token hash is persisted; the raw token is returned to the
// test (the sole place it is ever seen in the clear).
async function seedRecovery(cartId, expiresAt = new Date(Date.now() + 24 * 3600 * 1000)) {
  const rawToken = cartToken.generateToken();
  await dbQuery("update carts set status = 'abandoned', abandoned_at = now() where id = $1", [cartId]);
  const [event] = await dbQuery(
    "insert into cart_events (organization_id, cart_id, event_type) select organization_id, id, 'recovery_sent' from carts where id = $1 returning id",
    [cartId]
  );
  await dbQuery(
    `insert into cart_recovery_outbox
       (organization_id, cart_id, event_id, channel, status, recovery_token_hash, recovery_expires_at, sent_at)
     select organization_id, id, $2, 'email', 'sent', $3, $4, now() from carts where id = $1`,
    [cartId, event.id, cartToken.hashToken(rawToken), expiresAt.toISOString()]
  );
  return rawToken;
}

test.describe('A21 persistent cart + checkout conversion', () => {
  test('guest cart is server-canonical across reload and never exposes the raw token to web storage', async ({ page, e2eState }) => {
    await setCart(page, e2eState, e2eState.fixtures.tenantA);

    // A fresh navigation must rebuild the cart from the server (the mirror is only
    // a UI cache), proving persistence does not depend on localStorage being authoritative.
    await page.goto(`${e2eState.origins.storefront}/sepet`);
    await expect(page.locator('#cartItems .cart-item')).toHaveCount(1);

    // The raw guest token lives only in the HttpOnly proxy cookie: never in web
    // storage, never in the response-derived server cart, never JS-readable.
    const snapshot = await storageSnapshot(page);
    expect(JSON.stringify(snapshot).toLowerCase()).not.toContain('guest_cart_token');
    const leaked = await page.evaluate(() => ({
      cookieVisible: document.cookie.includes('suveraGuestCart'),
      serverCartHasToken: Boolean(window.Suvera && window.Suvera.currentServerCart && window.Suvera.currentServerCart.guest_cart_token),
    }));
    expect(leaked.cookieVisible).toBe(false);
    expect(leaked.serverCartHasToken).toBe(false);
  });

  test('mock-card checkout converts the server cart atomically (converted_order_id + converted event)', async ({ page, e2eState }) => {
    await setCart(page, e2eState, e2eState.fixtures.tenantA);
    await page.goto(`${e2eState.origins.storefront}/siparis`);
    const cartId = await serverCartId(page);

    await fillCheckout(page, { email: 'a21-card-conv@example.test' });
    await expect(page.locator('input[name="paymentMethod"][value="card"]')).toBeChecked();
    await page.locator('#payButton').click();
    await page.waitForURL(/\/tesekkur(?:\?|$)/, { timeout: 30_000 });

    const [cartRow] = await dbQuery('select status, converted_order_id from carts where id = $1', [cartId]);
    expect(cartRow.status).toBe('converted');
    expect(cartRow.converted_order_id).not.toBeNull();
    const [event] = await dbQuery(
      "select count(*)::int as c from cart_events where cart_id = $1 and event_type = 'converted'",
      [cartId]
    );
    expect(event.c).toBeGreaterThanOrEqual(1);
    const [order] = await dbQuery('select id from orders where id = $1', [cartRow.converted_order_id]);
    expect(order).toBeTruthy();
    // The cart mirror is emptied client-side after a successful order.
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('suveraCart') || '[]'))).toHaveLength(0);
  });

  test('IBAN checkout converts the server cart', async ({ page, e2eState }) => {
    await setCart(page, e2eState, e2eState.fixtures.tenantA);
    await page.goto(`${e2eState.origins.storefront}/siparis`);
    const cartId = await serverCartId(page);

    await fillCheckout(page, { email: 'a21-iban-conv@example.test' });
    await page.locator('input[name="paymentMethod"][value="iban"]').check();
    await page.locator('#payButton').click();
    await page.waitForURL(/\/tesekkur\?order=/, { timeout: 30_000 });

    const [cartRow] = await dbQuery('select status, converted_order_id from carts where id = $1', [cartId]);
    expect(cartRow.status).toBe('converted');
    expect(cartRow.converted_order_id).not.toBeNull();
  });

  test('login after building a guest cart merges it into the customer cart and revokes the guest cart', async ({ page, e2eState }) => {
    await setCart(page, e2eState, e2eState.fixtures.tenantA);
    await page.goto(`${e2eState.origins.storefront}/sepet`);
    await expect(page.locator('#cartItems .cart-item')).toHaveCount(1);
    const guestCartId = await page.evaluate(() => window.Suvera && window.Suvera.currentServerCart && window.Suvera.currentServerCart.id);
    expect(guestCartId).toBeTruthy();

    const email = `a21-merge-${Date.now()}@example.test`;
    await page.goto(`${e2eState.origins.storefront}/giris`);
    await page.locator('[data-action="show-register"]').click();
    await page.locator('#registerNameInput').fill('A21 Merge Musteri');
    await page.locator('#registerEmailInput').fill(email);
    await page.locator('#registerPwInput').fill('A21-Strong-Password-77!');
    await page.locator('[data-action="do-register"]').click();
    await expect(page.locator('#verifyBanner')).toBeVisible();

    // The guest cart becomes terminal ('merged') and the new customer owns an
    // active cart carrying the merged variant.
    await expect
      .poll(async () => {
        const rows = await dbQuery('select status from carts where id = $1', [guestCartId]);
        return rows[0] ? rows[0].status : null;
      }, { timeout: 15_000 })
      .toBe('merged');
    const customerCarts = await dbQuery(
      `select c.status, c.item_count from carts c
         join customer_accounts ca on ca.organization_id = c.organization_id and ca.id = c.customer_account_id
        where ca.email = $1 and c.status = 'active'`,
      [email]
    );
    expect(customerCarts.length).toBe(1);
    expect(Number(customerCarts[0].item_count)).toBeGreaterThanOrEqual(1);
  });

  test('a stale cart version is rejected by the server so a concurrent update cannot be lost', async ({ page, e2eState }) => {
    await setCart(page, e2eState, e2eState.fixtures.tenantA);
    await page.goto(`${e2eState.origins.storefront}/sepet`);
    await expect(page.locator('#cartItems .cart-item .qty-num')).toHaveText('1');
    const variantId = e2eState.fixtures.tenantA.variantId;

    // Optimistic-version contract through the real HTTP stack: capture a version,
    // advance the server past it (a concurrent tab), then replay the captured version.
    const result = await page.evaluate(async (vid) => {
      const staleVersion = window.SuveraCartUI.currentCart().version;
      const advanced = await window.SuveraAPI.cart.setQuantity(vid, 3, staleVersion);
      let conflictStatus = null;
      try {
        await window.SuveraAPI.cart.setQuantity(vid, 9, staleVersion); // replay stale version
      } catch (error) {
        conflictStatus = error && error.status;
      }
      // The canonical cart still reflects the winning update, never the stale one.
      const canonical = await window.SuveraAPI.cart.get();
      return { staleVersion, newVersion: advanced.cart.version, conflictStatus, canonicalCount: canonical.cart.item_count };
    }, variantId);

    expect(result.newVersion).toBeGreaterThan(result.staleVersion);
    expect(result.conflictStatus).toBe(409);
    expect(result.canonicalCount).toBe(3);
  });

  test('recovery link restores an abandoned cart into a fresh HttpOnly guest session and scrubs the token', async ({ browser, e2eState }) => {
    const cartId = await buildGuestCart(browser, e2eState);
    const rawToken = await seedRecovery(cartId);

    // Fresh device: a context with no guest cookie opens the emailed link.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${e2eState.origins.storefront}/sepet?rt=${encodeURIComponent(rawToken)}`);

    // Landed on the clean cart page with the restored item.
    await expect(page.locator('#cartItems .cart-item')).toHaveCount(1);
    expect(new URL(page.url()).searchParams.get('rt')).toBeNull();

    // The rotated guest token is only in the HttpOnly cookie: not JS-readable, not in storage.
    const leak = await page.evaluate(() => ({
      cookieVisible: document.cookie.includes('suveraGuestCart'),
      storage: JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]),
    }));
    expect(leak.cookieVisible).toBe(false);
    expect(leak.storage).not.toContain(rawToken);

    // Canonical server state: recovered + event logged + single-use token hash cleared.
    const [cartRow] = await dbQuery('select status, recovered_at from carts where id = $1', [cartId]);
    expect(cartRow.status).toBe('active');
    expect(cartRow.recovered_at).not.toBeNull();
    const [ev] = await dbQuery("select count(*)::int as c from cart_events where cart_id = $1 and event_type = 'recovered'", [cartId]);
    expect(ev.c).toBeGreaterThanOrEqual(1);
    const [outbox] = await dbQuery('select recovery_token_hash from cart_recovery_outbox where cart_id = $1 order by id desc limit 1', [cartId]);
    expect(outbox.recovery_token_hash).toBeNull();
    await ctx.close();
  });

  test('an expired recovery link fails safely: no cart, no guest cookie, token scrubbed', async ({ browser, e2eState }) => {
    const cartId = await buildGuestCart(browser, e2eState);
    const rawToken = await seedRecovery(cartId, new Date(Date.now() - 3600 * 1000));

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${e2eState.origins.storefront}/sepet?rt=${encodeURIComponent(rawToken)}`);

    await expect.poll(() => page.evaluate(() => new URL(window.location.href).searchParams.get('rt'))).toBeNull();
    await expect(page.locator('#cartItems .cart-item')).toHaveCount(0);
    expect(await page.evaluate(() => document.cookie.includes('suveraGuestCart'))).toBe(false);
    const [cartRow] = await dbQuery('select recovered_at from carts where id = $1', [cartId]);
    expect(cartRow.recovered_at).toBeNull();
    await ctx.close();
  });

  test('a recovery token from another tenant does not work on this storefront', async ({ browser, e2eState }) => {
    // Seed an abandoned cart + delivered token entirely under tenant B.
    const orgB = e2eState.fixtures.tenantB.organizationId;
    const rawToken = cartToken.generateToken();
    const [cart] = await dbQuery(
      "insert into carts (organization_id, guest_token_hash, status) values ($1, $2, 'abandoned') returning id",
      [orgB, cartToken.hashToken(cartToken.generateToken())]
    );
    const [event] = await dbQuery(
      "insert into cart_events (organization_id, cart_id, event_type) values ($1, $2, 'recovery_sent') returning id",
      [orgB, cart.id]
    );
    await dbQuery(
      `insert into cart_recovery_outbox
         (organization_id, cart_id, event_id, channel, status, recovery_token_hash, recovery_expires_at, sent_at)
       values ($1, $2, $3, 'email', 'sent', $4, now() + interval '24 hours', now())`,
      [orgB, cart.id, event.id, cartToken.hashToken(rawToken)]
    );

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${e2eState.origins.storefront}/sepet?rt=${encodeURIComponent(rawToken)}`);

    await expect.poll(() => page.evaluate(() => new URL(window.location.href).searchParams.get('rt'))).toBeNull();
    await expect(page.locator('#cartItems .cart-item')).toHaveCount(0);
    expect(await page.evaluate(() => document.cookie.includes('suveraGuestCart'))).toBe(false);
    // Tenant B's cart is untouched by the tenant A storefront.
    const [cartRow] = await dbQuery('select status, recovered_at from carts where id = $1', [cart.id]);
    expect(cartRow.status).toBe('abandoned');
    expect(cartRow.recovered_at).toBeNull();
    await ctx.close();
  });

  test('a recovery link is single-use: a second visit is rejected and does not re-recover', async ({ browser, e2eState }) => {
    const cartId = await buildGuestCart(browser, e2eState);
    const rawToken = await seedRecovery(cartId);

    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    await page1.goto(`${e2eState.origins.storefront}/sepet?rt=${encodeURIComponent(rawToken)}`);
    await expect(page1.locator('#cartItems .cart-item')).toHaveCount(1);
    await ctx1.close();
    const [afterFirst] = await dbQuery("select count(*)::int as c from cart_events where cart_id = $1 and event_type = 'recovered'", [cartId]);

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto(`${e2eState.origins.storefront}/sepet?rt=${encodeURIComponent(rawToken)}`);
    await expect.poll(() => page2.evaluate(() => new URL(window.location.href).searchParams.get('rt'))).toBeNull();
    await expect(page2.locator('#cartItems .cart-item')).toHaveCount(0);
    expect(await page2.evaluate(() => document.cookie.includes('suveraGuestCart'))).toBe(false);
    const [afterSecond] = await dbQuery("select count(*)::int as c from cart_events where cart_id = $1 and event_type = 'recovered'", [cartId]);
    expect(afterSecond.c).toBe(afterFirst.c); // no duplicate recovered event
    await ctx2.close();
  });
});
