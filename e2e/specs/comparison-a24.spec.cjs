'use strict';

const { expect, test } = require('../fixtures.cjs');
const { dbQuery } = require('../lib/db.cjs');

test.describe('A24.4 product comparison', () => {
  test('guest adds products to the comparison and the compare page shows them; remove updates', async ({ page, e2eState }) => {
    const organizationId = e2eState.fixtures.tenantA.organizationId;
    const rows = await dbQuery(
      "select id from products where organization_id=$1 and status='active' order by id limit 2",
      [organizationId]
    );
    const [a, b] = rows.map((row) => Number(row.id));

    // Add product A from its page; the compare bar reflects the count.
    await page.goto(`${e2eState.origins.storefront}/urun?id=${a}`);
    const toggle = page.locator('#compareToggle');
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#compareBar')).toBeVisible();
    await expect(page.locator('#compareBarCount')).toHaveText('1');

    // Add product B.
    await page.goto(`${e2eState.origins.storefront}/urun?id=${b}`);
    await page.locator('#compareToggle').click();
    await expect(page.locator('#compareBarCount')).toHaveText('2');

    // The shareable compare URL renders both products in an accessible table.
    await page.goto(`${e2eState.origins.storefront}/karsilastir?ids=${a},${b}`);
    const table = page.locator('.compare-table');
    await expect(table).toBeVisible();
    await expect(table.locator(`.compare-prod-link[href="urun?id=${a}"]`)).toBeVisible();
    await expect(table.locator(`.compare-prod-link[href="urun?id=${b}"]`)).toBeVisible();
    await expect(table).toContainText('Fiyat');

    // Removing a product from the table updates the comparison.
    await table.locator(`.compare-remove[data-remove="${a}"]`).click();
    await expect(page.locator(`.compare-prod-link[href="urun?id=${a}"]`)).toHaveCount(0);
    await expect(page.locator(`.compare-prod-link[href="urun?id=${b}"]`)).toBeVisible();
  });
});
