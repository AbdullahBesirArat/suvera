'use strict';

const { bff, expect, loginAdmin, test } = require('../fixtures.cjs');
const { dbQuery } = require('../lib/db.cjs');

test.describe('A24.3 size guides', () => {
  let guideId = null;

  test.afterEach(async () => {
    if (guideId) {
      await dbQuery('delete from size_guides where id=$1', [guideId]).catch(() => {});
      guideId = null;
    }
  });

  test('admin creates a category guide; the product page opens an accessible modal with cm/inch conversion', async ({ page, browser, e2eState }) => {
    const categoryId = e2eState.fixtures.tenantA.categoryId;
    const organizationId = e2eState.fixtures.tenantA.organizationId;
    const [product] = await dbQuery(
      `select p.id
         from products p
        where p.organization_id = $1
          and p.category_id = $2
          and not exists (
            select 1 from product_size_guides psg
             where psg.organization_id = p.organization_id
               and psg.product_id = p.id
          )
        order by p.id
        limit 1`,
      [organizationId, categoryId]
    );
    expect(product).toBeTruthy();
    const productId = product.id;

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAdmin(adminPage, e2eState, { tenant: 'tenantA' });
    const created = await bff(adminPage, '/operations/size-guides', {
      method: 'POST',
      body: {
        name: 'E2E Beden Rehberi', description: 'Ölçüler', measurement_unit: 'cm',
        category_id: categoryId, status: 'active',
        columns: [{ key: 'chest', label: 'Göğüs' }, { key: 'waist', label: 'Bel' }],
        rows: [{ label: 'M', cells: { chest: '90-94', waist: '74' } }],
      },
    });
    expect(created.status).toBe(201);
    guideId = created.body.guide.id;
    await adminContext.close();

    await page.goto(`${e2eState.origins.storefront}/urun?id=${productId}`);
    const trigger = page.locator('#sizeGuideBtn');
    await expect(trigger).toBeVisible();
    await trigger.click();

    const modal = page.locator('#sizeGuideModal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#sizeGuideTitle')).toHaveText('E2E Beden Rehberi');
    await expect(modal.locator('.size-guide-table')).toContainText('Göğüs');
    await expect(modal.locator('.size-guide-table')).toContainText('90-94');

    // cm -> inch toggle converts each end of the range (90 cm ≈ 35,4 inch).
    await modal.locator('[data-unit="inch"]').click();
    await expect(modal.locator('.size-guide-table')).toContainText('35,4');

    // Escape closes the modal.
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
  });
});
