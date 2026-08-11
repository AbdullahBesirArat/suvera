'use strict';

const { bff, expect, loginAdmin, test } = require('../fixtures.cjs');
const { dbQuery } = require('../lib/db.cjs');

// Products seeded per test, deleted in afterEach so the shared catalog count other
// specs assert on stays stable (deleting a product cascades its relations).
const seededProductIds = [];

async function seedProduct(organizationId, tag, categoryId) {
  const stamp = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [product] = await dbQuery(
    "insert into products (organization_id, name, category_id, price, status, stock) values ($1,$2,$3,900,'active',5) returning id",
    [organizationId, `A24 ${stamp}`, categoryId]
  );
  await dbQuery(
    `insert into product_variants (organization_id, product_id, color, size, sku, stock, on_hand, reserved, status, is_active, is_default)
     values ($1,$2,'Mavi','M',$3,5,5,0,'active',true,true)`,
    [organizationId, product.id, `A24-${stamp}`]
  );
  seededProductIds.push(product.id);
  return Number(product.id);
}

test.describe('A24.2 related / complementary products', () => {
  test.afterEach(async () => {
    while (seededProductIds.length) {
      const id = seededProductIds.pop();
      await dbQuery('delete from products where id=$1', [id]).catch(() => {});
    }
  });

  test('admin curates a related product and it appears on the source product page; tenant isolated', async ({ page, browser, e2eState }) => {
    const organizationId = e2eState.fixtures.tenantA.organizationId;
    const categoryId = e2eState.fixtures.tenantA.categoryId;
    const source = await seedProduct(organizationId, 'SRC', categoryId);
    const target = await seedProduct(organizationId, 'TGT', categoryId);

    // Admin curates source -> target as a related product through the real BFF.
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAdmin(adminPage, e2eState, { tenant: 'tenantA' });
    const saved = await bff(adminPage, `/operations/relations/${source}`, {
      method: 'PUT', body: { relation_type: 'related', target_product_ids: [target] },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.target_product_ids).toContain(target);

    // A cross-tenant target is rejected (tenant B product on tenant A source).
    const crossTenant = await bff(adminPage, `/operations/relations/${source}`, {
      method: 'PUT', body: { relation_type: 'upsell', target_product_ids: [e2eState.fixtures.tenantB.productId] },
    });
    expect(crossTenant.status).toBeGreaterThanOrEqual(400);
    await adminContext.close();

    // Storefront: the curated related product renders on the source product page.
    await page.goto(`${e2eState.origins.storefront}/urun?id=${source}`);
    await expect(page.locator(`#relatedProducts .related-card[data-nav="urun?id=${target}"]`)).toBeVisible();
  });
});
