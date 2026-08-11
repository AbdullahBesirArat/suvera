'use strict';

const crypto = require('node:crypto');
const { expect, test } = require('../fixtures.cjs');
const { dbQuery } = require('../lib/db.cjs');

const DUMMY_PASSWORD_HASH = '$2b$12$QJv3JQv8ZCk1sQxw2P7/fOMQ7A0J7sKnzGWxZmf0RduCMsZ/HXXdK';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

async function loginCustomerA(page, e2eState) {
  await page.goto(`${e2eState.origins.storefront}/giris`);
  await page.locator('#emailInput').fill(e2eState.credentials.customerA.email);
  await page.locator('#pwInput').fill(e2eState.credentials.customerA.password);
  await page.locator('[data-action="do-login"]').click();
  await page.waitForURL(/\/hesabim/, { timeout: 20_000 });
}

async function customerAccountId(e2eState) {
  const [row] = await dbQuery(
    'select id from customer_accounts where organization_id=$1 and email=$2',
    [e2eState.fixtures.tenantA.organizationId, e2eState.credentials.customerA.email]
  );
  return Number(row.id);
}

// A guest order: a customers row + an order with no owning account. The order operation
// trigger fills the immutable snapshot from the customer, exactly as real checkout does.
async function seedGuestOrder(orgId, email, orderCode) {
  const [customer] = await dbQuery(
    "insert into customers (organization_id,name,email,phone,address) values ($1,'Misafir Alıcı',$2,'05553334455','Misafir Sokak No 7') returning id",
    [orgId, email]
  );
  const [order] = await dbQuery(
    `insert into orders (organization_id, order_code, customer_id, total, status, payment_provider, payment_method, subtotal)
     values ($1,$2,$3,120,'paid','mock','card',120) returning id`,
    [orgId, orderCode, customer.id]
  );
  return { customerId: Number(customer.id), orderId: Number(order.id) };
}

// Seed a claim token exactly as the request endpoint would: only the hash is stored; the
// raw token is returned to the test (the sole place it is ever seen in the clear).
async function seedClaimToken(orgId, orderId, accountId, { expired = false } = {}) {
  const raw = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + (expired ? -3600 : 1800) * 1000).toISOString();
  await dbQuery(
    `insert into order_account_claim_tokens (organization_id, order_id, customer_account_id, token_hash, expires_at)
     values ($1,$2,$3,$4,$5)`,
    [orgId, orderId, accountId, sha256(raw), expiresAt]
  );
  return raw;
}

async function confirmViaApi(page, e2eState, rawToken) {
  await page.goto(e2eState.origins.storefront);
  return page.evaluate(async (token) => {
    try {
      const body = await window.SuveraAPI.orderClaim.confirm(token);
      return { ok: true, body };
    } catch (error) {
      return { ok: false, status: error && error.status };
    }
  }, rawToken);
}

test.describe('A25 guest order -> account linking', () => {
  test('claim request is order-enumeration safe: same generic response for real and unknown codes', async ({ page, e2eState }) => {
    const orgId = e2eState.fixtures.tenantA.organizationId;
    const real = await seedGuestOrder(orgId, `a25-generic-${Date.now()}@example.test`, `E2E-GENERIC-${Date.now()}`);
    await loginCustomerA(page, e2eState);

    const [existing, missing] = await page.evaluate(async (code) => {
      const a = await window.SuveraAPI.orderClaim.request(code);
      const b = await window.SuveraAPI.orderClaim.request('NO-SUCH-ORDER-CODE-XYZ');
      return [a, b];
    }, await dbQuery('select order_code from orders where id=$1', [real.orderId]).then((r) => r[0].order_code));

    // A caller cannot tell whether the order exists: identical body for both.
    expect(existing).toEqual(missing);
    // Yet a real, claimable order did get a (hash-only) token issued.
    const [tokenCount] = await dbQuery('select count(*)::int as c from order_account_claim_tokens where order_id=$1', [real.orderId]);
    expect(tokenCount.c).toBe(1);
  });

  test('a valid token links the order, keeps the snapshot immutable, and strips the URL token', async ({ page, e2eState }) => {
    const orgId = e2eState.fixtures.tenantA.organizationId;
    const accountId = await customerAccountId(e2eState);
    const seeded = await seedGuestOrder(orgId, `a25-link-${Date.now()}@example.test`, `E2E-LINK-${Date.now()}`);
    const [before] = await dbQuery('select shipping_address_snapshot, customer_snapshot from orders where id=$1', [seeded.orderId]);
    const rawToken = await seedClaimToken(orgId, seeded.orderId, accountId);

    await loginCustomerA(page, e2eState);
    await page.goto(`${e2eState.origins.storefront}/hesabim?claim_token=${encodeURIComponent(rawToken)}`);
    await expect(page.locator('#orderClaimMessage')).toContainText('bağlandı');
    // Token is stripped from the URL/history for hygiene.
    await expect.poll(() => page.evaluate(() => new URL(window.location.href).searchParams.get('claim_token'))).toBeNull();

    const [after] = await dbQuery(
      'select customer_account_id, shipping_address_snapshot, customer_snapshot from orders where id=$1',
      [seeded.orderId]
    );
    expect(Number(after.customer_account_id)).toBe(accountId);
    // Immutable snapshot: linking never rewrites the captured address/customer data.
    expect(after.shipping_address_snapshot).toEqual(before.shipping_address_snapshot);
    expect(after.customer_snapshot).toEqual(before.customer_snapshot);
    // Token consumed (single use).
    const [token] = await dbQuery('select used_at from order_account_claim_tokens where order_id=$1', [seeded.orderId]);
    expect(token.used_at).not.toBeNull();
  });

  test('a claim token is single-use and an expired token is rejected', async ({ page, e2eState }) => {
    const orgId = e2eState.fixtures.tenantA.organizationId;
    const accountId = await customerAccountId(e2eState);
    await loginCustomerA(page, e2eState);

    // First use succeeds, second use of the same token fails.
    const reuse = await seedGuestOrder(orgId, `a25-reuse-${Date.now()}@example.test`, `E2E-REUSE-${Date.now()}`);
    const reuseToken = await seedClaimToken(orgId, reuse.orderId, accountId);
    const first = await confirmViaApi(page, e2eState, reuseToken);
    expect(first.ok).toBe(true);
    const second = await confirmViaApi(page, e2eState, reuseToken);
    expect(second.ok).toBe(false);
    expect(second.status).toBe(400);

    // An expired token never links.
    const expired = await seedGuestOrder(orgId, `a25-expired-${Date.now()}@example.test`, `E2E-EXPIRED-${Date.now()}`);
    const expiredToken = await seedClaimToken(orgId, expired.orderId, accountId, { expired: true });
    const result = await confirmViaApi(page, e2eState, expiredToken);
    expect(result.ok).toBe(false);
    const [row] = await dbQuery('select customer_account_id from orders where id=$1', [expired.orderId]);
    expect(row.customer_account_id).toBeNull();
  });

  test('an order already linked to another account is a safe conflict and is not re-linked', async ({ page, e2eState }) => {
    const orgId = e2eState.fixtures.tenantA.organizationId;
    const accountId = await customerAccountId(e2eState);
    // A second tenant-A account already owns the order.
    const [other] = await dbQuery(
      `insert into customer_accounts (organization_id, email, name, phone, password_hash, email_verified_at)
       values ($1,$2,'Diğer Hesap','', $3, now()) returning id`,
      [orgId, `a25-other-${Date.now()}@example.test`, DUMMY_PASSWORD_HASH]
    );
    const seeded = await seedGuestOrder(orgId, `a25-conflict-${Date.now()}@example.test`, `E2E-CONFLICT-${Date.now()}`);
    await dbQuery('update orders set customer_account_id=$1 where id=$2', [other.id, seeded.orderId]);
    const rawToken = await seedClaimToken(orgId, seeded.orderId, accountId);

    await loginCustomerA(page, e2eState);
    const result = await confirmViaApi(page, e2eState, rawToken);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    // Ownership is unchanged; the order stays with the original account.
    const [row] = await dbQuery('select customer_account_id from orders where id=$1', [seeded.orderId]);
    expect(Number(row.customer_account_id)).toBe(Number(other.id));
  });

  test('a claim token from another tenant does not work on this storefront', async ({ page, e2eState }) => {
    const orgB = e2eState.fixtures.tenantB.organizationId;
    const accountA = await customerAccountId(e2eState);
    // A tenant-B order + a token bound to tenant B / customerB's account.
    const [customerBAccount] = await dbQuery(
      'select id from customer_accounts where organization_id=$1 and email=$2',
      [orgB, e2eState.credentials.customerB.email]
    );
    const seeded = await seedGuestOrder(orgB, `a25-crosstenant-${Date.now()}@example.test`, `E2E-XTENANT-${Date.now()}`);
    const rawToken = await seedClaimToken(orgB, seeded.orderId, Number(customerBAccount.id));

    // customerA (tenant A) tries to use the tenant-B token: it is invisible cross-tenant.
    await loginCustomerA(page, e2eState);
    const result = await confirmViaApi(page, e2eState, rawToken);
    expect(result.ok).toBe(false);
    const [row] = await dbQuery('select customer_account_id from orders where id=$1', [seeded.orderId]);
    expect(row.customer_account_id).toBeNull();
    // Sanity: the token remains bound to another account than the tenant-A customer.
    expect(Number(accountA)).not.toBe(Number(customerBAccount.id));
  });

  test('verifying an account auto-links guest orders on the same email (no per-order token)', async ({ page, e2eState }) => {
    const orgId = e2eState.fixtures.tenantA.organizationId;
    const email = `a25-autolink-${Date.now()}@example.test`;
    const guest = await seedGuestOrder(orgId, email, `E2E-AUTOLINK-${Date.now()}`);
    // A brand-new, still-unverified account on the same email.
    const [account] = await dbQuery(
      `insert into customer_accounts (organization_id, email, name, phone, password_hash)
       values ($1,$2,'Auto Link','', $3) returning id`,
      [orgId, email, DUMMY_PASSWORD_HASH]
    );
    // Seed a signup verification token (hash-only) and verify it via the public endpoint.
    const rawVerify = crypto.randomBytes(36).toString('hex');
    await dbQuery(
      `insert into email_magic_link_tokens (organization_id, subject_type, subject_id, purpose, token_hash, expires_at)
       values ($1,'customer',$2,'signup',$3, now() + interval '1 hour')`,
      [orgId, String(account.id), sha256(rawVerify)]
    );

    await page.goto(e2eState.origins.storefront);
    await page.evaluate(async (token) => window.SuveraAPI.customerAuth.verifyEmail(token), rawVerify);

    // With the email proven, the guest order is now owned by the verified account.
    await expect.poll(async () => {
      const [row] = await dbQuery('select customer_account_id from orders where id=$1', [guest.orderId]);
      return row.customer_account_id == null ? null : Number(row.customer_account_id);
    }, { timeout: 10_000 }).toBe(Number(account.id));
  });
});
