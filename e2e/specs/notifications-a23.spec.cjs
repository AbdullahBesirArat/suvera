'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { bff, expect, loginAdmin, test } = require('../fixtures.cjs');
const { dbQuery, cartToken } = require('../lib/db.cjs');
const { API_DIR } = require('../lib/state.cjs');

// The app's own identity helper so E2E derives the same tenant/channel-scoped hash.
const notifyIdentity = require(path.join(API_DIR, 'modules', 'notifications', 'identity.js'));

// Drain the outbox once with the deterministic test provider. The interval worker is
// disabled under NODE_ENV=test, so E2E runs it explicitly against the E2E database.
function runWorkerOnce(e2eState) {
  const output = execFileSync(
    process.execPath,
    [path.join(API_DIR, 'scripts', 'run-notification-worker-once.js')],
    {
      cwd: API_DIR,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: e2eState.database.urls.runtime,
        RUNTIME_DATABASE_URL: e2eState.database.urls.runtime,
        SYSTEM_DATABASE_URL: e2eState.database.urls.system,
        NOTIFICATION_EMAIL_PROVIDER: 'test',
        PUBLIC_SITE_URL: e2eState.origins.storefront,
      },
    }
  );
  return JSON.parse(output.trim().split('\n').pop());
}

// Products seeded per test, torn down in afterEach so the shared catalog count other
// specs assert on is never polluted (deleting the product cascades its subscriptions).
const seededProductIds = [];

async function seedOutOfStockProduct(organizationId, categoryId, tag) {
  const stamp = `${tag}-${Date.now()}`;
  // Seed inside the fixture category so a leaked/restocked seed never breaks the
  // baseline A03 assertion (unfiltered count == that category's filtered count).
  const [product] = await dbQuery(
    "insert into products (organization_id, name, category_id, price, sale_price, status, stock) values ($1,$2,$3,1500,null,'active',0) returning id",
    [organizationId, `A23 ${stamp}`, categoryId]
  );
  const [variant] = await dbQuery(
    `insert into product_variants (organization_id, product_id, color, size, sku, stock, on_hand, reserved, status, is_active, is_default)
     values ($1,$2,'Siyah','M',$3,0,0,0,'out',true,true) returning id`,
    [organizationId, product.id, `A23-OOS-${stamp}`]
  );
  seededProductIds.push(product.id);
  return { productId: Number(product.id), variantId: Number(variant.id) };
}

async function browserStorage(page) {
  return page.evaluate(() => {
    const dump = (store) => Object.keys(store).map((key) => `${key}=${store.getItem(key)}`).join('|');
    return `${dump(window.localStorage)}||${dump(window.sessionStorage)}`;
  });
}

test.describe('A23 notifications, consent and preferences', () => {
  test.afterEach(async () => {
    while (seededProductIds.length) {
      const id = seededProductIds.pop();
      await dbQuery('delete from products where id=$1', [id]).catch(() => {});
    }
  });

  test('guest back-in-stock: consent gate, double opt-in, restock delivers exactly once, no raw token stored', async ({ page, browser, e2eState }) => {
    const organizationId = e2eState.fixtures.tenantA.organizationId;
    const { productId, variantId } = await seedOutOfStockProduct(organizationId, e2eState.fixtures.tenantA.categoryId, 'bis');
    const guestEmail = `a23-guest-${Date.now()}@example.test`;

    await page.goto(`${e2eState.origins.storefront}/urun?id=${productId}`);
    await expect(page.locator('#notifySection')).toBeVisible();
    await expect(page.locator('#notifyStockBtn')).toBeVisible();
    await page.locator('#notifyStockBtn').click();
    await expect(page.locator('#notifyForm')).toBeVisible();

    // Submitting without ticking consent is rejected and creates no subscription.
    await page.locator('#notifyEmail').fill(guestEmail);
    await page.locator('#notifySubmit').click();
    await expect(page.locator('#notifyStatus')).toContainText(/onay/i);
    const none = await dbQuery(
      'select id from notification_subscriptions where organization_id=$1 and product_id=$2',
      [organizationId, productId]
    );
    expect(none.length).toBe(0);

    // With consent, a guest gets a pending subscription + a double opt-in outbox row.
    // Match the success text specifically (not the consent-required message that also
    // contains "onay"), so the assertion waits for the request to actually complete.
    await page.locator('#notifyConsent').check();
    await page.locator('#notifySubmit').click();
    await expect(page.locator('#notifyStatus')).toContainText(/gönderildi/i);

    const [sub] = await dbQuery(
      'select id, status, organization_id from notification_subscriptions where product_id=$1 order by id desc limit 1',
      [productId]
    );
    expect(sub).toBeTruthy();
    expect(sub.status).toBe('pending');
    const [optIn] = await dbQuery(
      "select payload from notification_outbox where organization_id=$1 and subscription_id=$2 and event_type='subscription_opt_in' order by id desc limit 1",
      [sub.organization_id, sub.id]
    );
    expect(optIn).toBeTruthy();
    const confirmToken = optIn.payload.confirm_token;
    expect(typeof confirmToken).toBe('string');

    // Confirm on /tercihler; the token is scrubbed from the URL and the sub activates.
    await page.goto(`${e2eState.origins.storefront}/tercihler?confirm=${encodeURIComponent(confirmToken)}`);
    await expect(page.locator('#prefBanner')).toContainText(/onayland/i);
    expect(new URL(page.url()).search).toBe('');
    const [confirmed] = await dbQuery('select status from notification_subscriptions where id=$1', [sub.id]);
    expect(confirmed.status).toBe('active');
    expect(await browserStorage(page)).not.toContain(confirmToken);

    // Restock through the real admin endpoint -> a back-in-stock outbox row appears.
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAdmin(adminPage, e2eState, { tenant: 'tenantA' });
    const restock = await bff(adminPage, '/products/bulk-stock', {
      method: 'PATCH',
      body: { updates: [{ product_id: productId, variant_id: variantId, stock: 12 }] },
    });
    expect(restock.status).toBe(200);
    await adminContext.close();

    const [bis] = await dbQuery(
      "select id from notification_outbox where organization_id=$1 and subscription_id=$2 and event_type='back_in_stock'",
      [sub.organization_id, sub.id]
    );
    expect(bis).toBeTruthy();

    // Drain with the test provider: delivered exactly once (single delivery row).
    runWorkerOnce(e2eState);
    const [delivered] = await dbQuery('select status from notification_outbox where id=$1', [bis.id]);
    expect(delivered.status).toBe('sent');
    const [deliveries] = await dbQuery(
      "select count(*)::int as n from notification_deliveries where outbox_id=$1 and status='sent'",
      [bis.id]
    );
    expect(deliveries.n).toBe(1);
  });

  test('preference center: signed-in customer sees granted consent, revokes it and cancels a subscription', async ({ page, e2eState }) => {
    const organizationId = e2eState.fixtures.tenantA.organizationId;
    const productId = e2eState.fixtures.tenantA.productId;

    await page.goto(`${e2eState.origins.storefront}/giris`);
    await page.locator('#emailInput').fill(e2eState.credentials.customerA.email);
    await page.locator('#pwInput').fill(e2eState.credentials.customerA.password);
    await page.locator('[data-action="do-login"]').click();
    await page.waitForURL(/\/hesabim/, { timeout: 20_000 });

    // Signed-in price alarm: no email field, activates immediately, grants consent.
    await page.goto(`${e2eState.origins.storefront}/urun?id=${productId}`);
    await page.locator('#notifyPriceBtn').click();
    await expect(page.locator('#notifyEmailField')).toBeHidden();
    await page.locator('#notifyConsent').check();
    await page.locator('#notifySubmit').click();
    await expect(page.locator('#notifyStatus')).toContainText(/hazır|gönderece/i);

    // Preference center reflects the granted consent and the active subscription.
    await page.goto(`${e2eState.origins.storefront}/tercihler`);
    await expect(page.locator('#prefCenter')).toBeVisible();
    const priceToggle = page.locator('#prefConsents input[data-purpose="price_drop"]');
    await expect(priceToggle).toBeChecked();
    await expect(page.locator('#prefSubscriptions .pref-sub')).toHaveCount(1);

    // Revoke price_drop and persist; a reload shows it stays off (round-trip through API).
    await priceToggle.uncheck();
    await page.locator('#prefSave').click();
    await expect(page.locator('#prefSaveMsg')).toContainText(/güncellendi/i);
    await page.reload();
    await expect(page.locator('#prefConsents input[data-purpose="price_drop"]')).not.toBeChecked();

    // Cancel the subscription from the center.
    await page.locator('.pref-sub .pref-sub-cancel').first().click();
    await expect(page.locator('#prefSubscriptions .pref-sub')).toHaveCount(0);
    const [cancelled] = await dbQuery(
      "select count(*)::int as n from notification_subscriptions where organization_id=$1 and product_id=$2 and status='active'",
      [organizationId, productId]
    );
    expect(cancelled.n).toBe(0);
  });

  test('unsubscribe link suppresses the channel; wrong/expired tokens are rejected', async ({ page, e2eState }) => {
    const organizationId = e2eState.fixtures.tenantA.organizationId;
    const productId = e2eState.fixtures.tenantA.productId;
    const email = `a23-unsub-${Date.now()}@example.test`;
    const targetHash = notifyIdentity.targetHash(organizationId, 'email', email);
    const rawToken = cartToken.generateToken();

    await dbQuery(
      "insert into communication_consents (organization_id, contact_email, target_hash, channel, purpose, status, granted_at) values ($1,$2,$3,'email','price_drop','granted',now())",
      [organizationId, email, targetHash]
    );
    const [sub] = await dbQuery(
      `insert into notification_subscriptions
         (organization_id, product_id, subscription_type, channel, contact_email, target_hash, status, unsubscribe_token_hash)
       values ($1,$2,'price_drop','email',$3,$4,'active',$5) returning id`,
      [organizationId, productId, email, targetHash, cartToken.hashToken(rawToken)]
    );

    // A malformed token leaves everything untouched.
    await page.goto(`${e2eState.origins.storefront}/tercihler?unsub=short-invalid`);
    await expect(page.locator('#prefBanner')).toContainText(/geçersiz|gecersiz/i);
    const [stillActive] = await dbQuery('select status from notification_subscriptions where id=$1', [sub.id]);
    expect(stillActive.status).toBe('active');

    // The real token unsubscribes, suppresses the channel and is scrubbed from the URL.
    await page.goto(`${e2eState.origins.storefront}/tercihler?unsub=${encodeURIComponent(rawToken)}`);
    await expect(page.locator('#prefBanner')).toContainText(/iptal/i);
    expect(new URL(page.url()).search).toBe('');
    const [after] = await dbQuery('select status from notification_subscriptions where id=$1', [sub.id]);
    expect(after.status).toBe('unsubscribed');
    const [supp] = await dbQuery(
      "select count(*)::int as n from communication_suppressions where organization_id=$1 and channel='email' and target_hash=$2",
      [organizationId, targetHash]
    );
    expect(supp.n).toBe(1);
    expect(await browserStorage(page)).not.toContain(rawToken);
  });

  test('admin notifications view masks recipients and isolates tenants', async ({ page, browser, e2eState }) => {
    const organizationId = e2eState.fixtures.tenantA.organizationId;
    const secretEmail = `a23-admin-secret-${Date.now()}@example.test`;
    const targetHash = notifyIdentity.targetHash(organizationId, 'email', secretEmail);
    // Seed one orgA outbox row addressed to a known secret recipient.
    await dbQuery(
      `insert into notification_outbox
         (organization_id, event_type, channel, recipient_ref, recipient_hash, payload, idempotency_key, status)
       values ($1,'price_drop','email',$2,$3,'{}'::jsonb,$4,'sent')`,
      [organizationId, secretEmail, targetHash, `admin-view-${Date.now()}`]
    );

    await loginAdmin(page, e2eState, { tenant: 'tenantA' });
    const orgAView = await bff(page, '/operations/notifications/outbox');
    expect(orgAView.status).toBe(200);
    const mine = orgAView.body.items.find((item) => item.recipient_masked && item.recipient_masked.includes('@'));
    expect(mine).toBeTruthy();
    // The raw local part never leaves the server.
    expect(orgAView.body.items.some((item) => item.recipient_masked === secretEmail)).toBe(false);
    expect(mine.recipient_masked).toContain('***');

    // A second tenant's admin sees none of tenant A's rows.
    const bContext = await browser.newContext();
    const bPage = await bContext.newPage();
    await loginAdmin(bPage, e2eState, { tenant: 'tenantB' });
    const orgBView = await bff(bPage, '/operations/notifications/outbox');
    expect(orgBView.status).toBe(200);
    expect(orgBView.body.items.some((item) => item.recipient_masked && item.recipient_masked.includes(secretEmail.slice(0, 6)))).toBe(false);
    await bContext.close();
  });
});
