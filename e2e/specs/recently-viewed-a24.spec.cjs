'use strict';

const { expect, test } = require('../fixtures.cjs');
const { dbQuery } = require('../lib/db.cjs');

async function activeProductIds(organizationId, limit) {
  const rows = await dbQuery(
    "select id from products where organization_id=$1 and status='active' order by id limit $2",
    [organizationId, limit]
  );
  return rows.map((row) => Number(row.id));
}

test.describe('A24.1 recently viewed', () => {
  test('guest history persists, excludes the current product and stores only ids', async ({ page, e2eState }) => {
    const organizationId = e2eState.fixtures.tenantA.organizationId;
    const [a, b, c] = await activeProductIds(organizationId, 3);
    expect(Number.isInteger(a) && Number.isInteger(b) && Number.isInteger(c)).toBe(true);

    await page.goto(`${e2eState.origins.storefront}/urun?id=${a}`);
    const acceptConsent = page.locator('[data-consent-action="accept-all"]');
    if (await acceptConsent.isVisible()) await acceptConsent.click();
    await page.goto(`${e2eState.origins.storefront}/urun?id=${b}`);

    const section = page.locator('#recentlyViewedSection');
    await expect(section).toBeVisible();
    await expect(section.locator(`.related-card[href="urun?id=${a}"]`)).toBeVisible();
    await expect(section.locator(`.related-card[href="urun?id=${b}"]`)).toHaveCount(0); // current excluded

    await page.goto(`${e2eState.origins.storefront}/urun?id=${c}`);
    await expect(section.locator(`.related-card[href="urun?id=${b}"]`)).toBeVisible();
    await expect(section.locator(`.related-card[href="urun?id=${a}"]`)).toBeVisible();
    await expect(section.locator(`.related-card[href="urun?id=${c}"]`)).toHaveCount(0);

    // localStorage holds only {id, ts} — no auth token or profile data.
    const stored = await page.evaluate((key) => window.localStorage.getItem(key), 'suvera:recently-viewed:v1');
    const parsed = JSON.parse(stored);
    expect(parsed.map((entry) => entry.id)).toEqual([c, b, a]);
    for (const entry of parsed) expect(Object.keys(entry).sort()).toEqual(['id', 'ts']);
  });

  test('login merges the guest history into the server-canonical account history', async ({ page, e2eState }) => {
    const organizationId = e2eState.fixtures.tenantA.organizationId;
    const [a, b] = await activeProductIds(organizationId, 2);
    const [accountRow] = await dbQuery(
      'select id from customer_accounts where organization_id=$1 and email=$2',
      [organizationId, e2eState.credentials.customerA.email]
    );
    const accountId = Number(accountRow.id);
    // Start clean so the assertion reflects the merge from this session.
    await dbQuery('delete from customer_recently_viewed where organization_id=$1 and customer_account_id=$2', [organizationId, accountId]);

    await page.goto(`${e2eState.origins.storefront}/urun?id=${a}`);
    const acceptConsent = page.locator('[data-consent-action="accept-all"]');
    if (await acceptConsent.isVisible()) await acceptConsent.click();
    await page.goto(`${e2eState.origins.storefront}/urun?id=${b}`);

    await page.goto(`${e2eState.origins.storefront}/giris`);
    await page.locator('#emailInput').fill(e2eState.credentials.customerA.email);
    await page.locator('#pwInput').fill(e2eState.credentials.customerA.password);
    await page.locator('[data-action="do-login"]').click();
    await page.waitForURL(/\/hesabim/, { timeout: 20_000 });

    // The guest history is now the customer's server-canonical history.
    await expect.poll(async () => {
      const rows = await dbQuery(
        'select product_id from customer_recently_viewed where organization_id=$1 and customer_account_id=$2',
        [organizationId, accountId]
      );
      return rows.map((row) => Number(row.product_id)).sort((x, y) => x - y);
    }, { timeout: 15_000 }).toEqual([a, b].sort((x, y) => x - y));
  });
});
