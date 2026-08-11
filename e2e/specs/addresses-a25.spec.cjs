'use strict';

const { expect, test } = require('../fixtures.cjs');
const { dbQuery } = require('../lib/db.cjs');

// Sign in the pre-seeded tenant-A customer so the HttpOnly customer cookie is set; the
// address APIs authenticate through it via the same-origin proxy (no JS token handling).
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

test.describe('A25 customer address book', () => {
  test.beforeEach(async ({ e2eState }) => {
    const orgId = e2eState.fixtures.tenantA.organizationId;
    const id = await customerAccountId(e2eState);
    // Start each test from a clean book so assertions reflect only this session.
    await dbQuery('delete from customer_addresses where organization_id=$1 and customer_account_id=$2', [orgId, id]);
  });

  test('add / default / soft-delete are server-canonical and tenant+owner scoped', async ({ page, e2eState }) => {
    const orgId = e2eState.fixtures.tenantA.organizationId;
    const id = await customerAccountId(e2eState);
    await loginCustomerA(page, e2eState);

    // Create through the real HTTP stack (address API, HttpOnly cookie auth).
    const created = await page.evaluate(async () => window.SuveraAPI.addresses.create({
      recipient: 'A25 Alıcı', phone: '05551112233', city: 'İstanbul', district: 'Kadıköy',
      address_line1: 'Moda Caddesi 10 D3', neighborhood: 'Caferağa',
    }));
    // The first saved address is the default for both shipping and billing.
    expect(created.address.is_default_shipping).toBe(true);
    expect(created.address.is_default_billing).toBe(true);

    const rows = await dbQuery(
      'select recipient, is_default_shipping from customer_addresses where organization_id=$1 and customer_account_id=$2 and deleted_at is null',
      [orgId, id]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].recipient).toBe('A25 Alıcı');

    // The hesabim card lists the saved address for the signed-in customer.
    await page.goto(`${e2eState.origins.storefront}/hesabim`);
    await expect(page.locator('#addressBookList')).toContainText('A25 Alıcı');

    // A second address made default shipping must flip the first one off (single default,
    // enforced by the partial unique index + clear-then-set).
    const second = await page.evaluate(async () => window.SuveraAPI.addresses.create({
      recipient: 'A25 İkinci', phone: '05559998877', city: 'İstanbul', district: 'Beşiktaş',
      address_line1: 'Barbaros Bulvarı 5', is_default_shipping: true,
    }));
    const shippingDefaults = await dbQuery(
      'select id from customer_addresses where organization_id=$1 and customer_account_id=$2 and is_default_shipping and deleted_at is null',
      [orgId, id]
    );
    expect(shippingDefaults.length).toBe(1);
    expect(Number(shippingDefaults[0].id)).toBe(Number(second.address.id));

    // Soft delete keeps the row (past orders reference immutable snapshots, never the row)
    // but removes it from the live list.
    await page.evaluate(async (aid) => window.SuveraAPI.addresses.remove(aid), created.address.id);
    const [deleted] = await dbQuery('select deleted_at from customer_addresses where id=$1', [created.address.id]);
    expect(deleted.deleted_at).not.toBeNull();
    const [live] = await dbQuery(
      'select count(*)::int as c from customer_addresses where organization_id=$1 and customer_account_id=$2 and deleted_at is null',
      [orgId, id]
    );
    expect(live.c).toBe(1);
  });

  test('the address form UI creates an address end-to-end', async ({ page, e2eState }) => {
    await loginCustomerA(page, e2eState);
    await page.goto(`${e2eState.origins.storefront}/hesabim`);

    await page.locator('#addressAddButton').click();
    await expect(page.locator('#addressForm')).toBeVisible();
    await page.locator('#addressRecipient').fill('Form Alıcı');
    await page.locator('#addressPhone').fill('05551112233');
    await page.locator('#addressLine1').fill('Form Test Sokak No 5');
    await expect.poll(() => page.locator('#addressCity option').count()).toBeGreaterThan(1);
    await page.locator('#addressCity').selectOption({ index: 1 });
    await expect(page.locator('#addressDistrict')).toBeEnabled();
    await expect.poll(() => page.locator('#addressDistrict option').count()).toBeGreaterThan(1);
    await page.locator('#addressDistrict').selectOption({ index: 1 });
    await page.locator('#addressSubmit').click();

    await expect(page.locator('#addressBookList')).toContainText('Form Alıcı');
    const id = await customerAccountId(e2eState);
    const [saved] = await dbQuery(
      'select count(*)::int as c from customer_addresses where organization_id=$1 and customer_account_id=$2 and recipient=$3 and deleted_at is null',
      [e2eState.fixtures.tenantA.organizationId, id, 'Form Alıcı']
    );
    expect(saved.c).toBe(1);
  });

  test('the address book requires a signed-in customer', async ({ page, e2eState }) => {
    await page.goto(e2eState.origins.storefront);
    const status = await page.evaluate(async (origin) => {
      const res = await fetch(`${origin}/api/customer-addresses?organizationSlug=suvera`, { credentials: 'same-origin' });
      return res.status;
    }, e2eState.origins.storefront);
    expect(status).toBe(401);
  });
});
