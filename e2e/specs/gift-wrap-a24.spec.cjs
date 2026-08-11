'use strict';

const {
  bff, expect, fillCheckout, loginAdmin, setCart, test,
} = require('../fixtures.cjs');
const { dbQuery } = require('../lib/db.cjs');
const { readState } = require('../lib/state.cjs');

// Keep the shared fixture variant stocked so gift checkouts never race the baseline
// suite for the last unit.
test.beforeAll(async () => {
  const state = readState();
  await dbQuery(
    'update product_variants set on_hand = on_hand + 30 where organization_id = $1 and id = $2',
    [state.fixtures.tenantA.organizationId, state.fixtures.tenantA.variantId],
    state
  );
  await dbQuery(
    "update products set status = 'active', stock = stock + 30 where organization_id = $1 and id = $2",
    [state.fixtures.tenantA.organizationId, state.fixtures.tenantA.productId],
    state
  );
});

async function adminSession(browser, e2eState, tenant = 'tenantA') {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAdmin(page, e2eState, { tenant });
  return { context, page };
}

async function serverCartId(page) {
  await expect
    .poll(() => page.evaluate(() => (window.Suvera && window.Suvera.currentServerCart && window.Suvera.currentServerCart.id) || null))
    .toBeTruthy();
  return page.evaluate(() => window.Suvera.currentServerCart.id);
}

function money(value) {
  return Number(String(value).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
}

test.describe('A24.5 gift wrap + gift note', () => {
  const created = [];

  test.afterAll(async () => {
    for (const id of created) {
      await dbQuery('update carts set gift_wrap_option_id = null, gift_wrap_fee = 0 where gift_wrap_option_id = $1', [id]).catch(() => {});
      await dbQuery('delete from gift_wrap_options where id = $1', [id]).catch(() => {});
    }
    created.length = 0;
  });

  test('admin creates a wrap; checkout applies only the server fee and the order keeps an immutable snapshot', async ({ page, browser, e2eState }) => {
    const admin = await adminSession(browser, e2eState);
    const createResponse = await bff(admin.page, '/operations/gift-wrap', {
      method: 'POST',
      body: { title: 'E2E Kadife Kutu', description: 'Saten kurdele ile', fee: 75, is_active: true, sort_order: 0 },
    });
    expect(createResponse.status).toBe(201);
    const optionId = createResponse.body.option.id;
    created.push(optionId);
    expect(createResponse.body.option.fee).toBe(75);

    await setCart(page, e2eState, e2eState.fixtures.tenantA);
    await page.goto(`${e2eState.origins.storefront}/siparis`);
    const cartId = await serverCartId(page);

    // The wrap appears at checkout with the server title and the server price.
    const giftSection = page.locator('#giftSection');
    await expect(giftSection).toBeVisible();
    const option = page.locator(`#giftOptions input[data-gift-option-id="${optionId}"]`);
    await expect(option).toBeVisible();
    await expect(giftSection).toContainText('E2E Kadife Kutu');
    await expect(giftSection).toContainText('Saten kurdele ile');

    const totalBefore = money(await page.locator('#summaryTotal').textContent());

    await option.check();
    await expect(page.locator('#giftStatus')).toHaveText('Hediye paketi eklendi.');
    await expect(page.locator('#summaryGiftRow')).toBeVisible();
    await expect(page.locator('#summaryGiftLabel')).toContainText('E2E Kadife Kutu');

    // The total rises by exactly the server fee - not by a client-chosen amount.
    await expect.poll(async () => money(await page.locator('#summaryTotal').textContent()))
      .toBe(totalBefore + 75);

    // A gift note with markup is stored as plain text and rendered, never executed.
    const note = page.locator('#giftNote');
    await note.fill('<img src=x onerror="window.__giftXss=1">Mutlu yıllar');
    await expect(page.locator('#giftNoteCounter')).toContainText('/ 500');
    await page.locator('#giftNoteSave').click();
    await expect(page.locator('#giftStatus')).toHaveText('Hediye notu kaydedildi.');
    expect(await page.evaluate(() => window.__giftXss)).toBeUndefined();
    expect(await page.locator('#giftNote').inputValue()).toBe('Mutlu yıllar');

    const [cartRow] = await dbQuery('select gift_wrap_option_id, gift_wrap_fee, gift_note from carts where id = $1', [cartId]);
    expect(Number(cartRow.gift_wrap_option_id)).toBe(optionId);
    expect(Number(cartRow.gift_wrap_fee)).toBe(75);
    expect(cartRow.gift_note).toBe('Mutlu yıllar');

    // Place the order.
    await fillCheckout(page, { email: 'a245-gift@example.test' });
    await page.locator('input[name="paymentMethod"][value="iban"]').check();
    await page.locator('#payButton').click();
    await page.waitForURL(/\/tesekkur\?order=/, { timeout: 30_000 });

    const [converted] = await dbQuery('select converted_order_id from carts where id = $1', [cartId]);
    const orderId = converted.converted_order_id;
    expect(orderId).not.toBeNull();

    const [order] = await dbQuery(
      'select gift_wrap, gift_wrap_fee, gift_note, gift_wrap_snapshot, total from orders where id = $1',
      [orderId]
    );
    expect(order.gift_wrap).toBe(true);
    expect(Number(order.gift_wrap_fee)).toBe(75);
    expect(order.gift_note).toBe('Mutlu yıllar');
    expect(order.gift_wrap_snapshot.title).toBe('E2E Kadife Kutu');
    expect(order.gift_wrap_snapshot.fee).toBe(75);

    // The admin order detail shows the snapshot.
    const detail = await bff(admin.page, `/orders/${orderId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.gift_wrap_snapshot.title).toBe('E2E Kadife Kutu');
    expect(Number(detail.body.gift_wrap_fee)).toBe(75);
    expect(detail.body.gift_note).toBe('Mutlu yıllar');
    expect(detail.body.packing_list.giftNote).toBe('Mutlu yıllar');

    // Changing the option afterwards must not touch the placed order.
    const updated = await bff(admin.page, `/operations/gift-wrap/${optionId}`, {
      method: 'PUT',
      body: { title: 'Degistirilmis Kutu', description: '', fee: 5, is_active: true, sort_order: 0 },
    });
    expect(updated.status).toBe(200);
    const [afterEdit] = await dbQuery('select gift_wrap_fee, gift_wrap_snapshot from orders where id = $1', [orderId]);
    expect(Number(afterEdit.gift_wrap_fee)).toBe(75);
    expect(afterEdit.gift_wrap_snapshot.title).toBe('E2E Kadife Kutu');

    await admin.context.close();
  });

  test('a wrap selection survives a failed payment, and a deactivated wrap is dropped with an adjustment', async ({ page, browser, e2eState }) => {
    const admin = await adminSession(browser, e2eState);
    const createResponse = await bff(admin.page, '/operations/gift-wrap', {
      method: 'POST',
      body: { title: 'E2E Basarisiz Odeme Kutusu', fee: 40, is_active: true },
    });
    expect(createResponse.status).toBe(201);
    const optionId = createResponse.body.option.id;
    created.push(optionId);

    await setCart(page, e2eState, e2eState.fixtures.tenantA);
    await page.goto(`${e2eState.origins.storefront}/siparis`);
    const cartId = await serverCartId(page);
    await page.locator(`#giftOptions input[data-gift-option-id="${optionId}"]`).check();
    await expect(page.locator('#summaryGiftRow')).toBeVisible();

    // Simulate the failed-payment path: the cart is converted and then restored.
    const [orderRow] = await dbQuery(
      `insert into orders (organization_id, order_code, customer_id, total)
       select organization_id, $2, $3, 1 from carts where id = $1 returning id`,
      [cartId, `E2E-GIFT-FAIL-${Date.now()}`, e2eState.fixtures.tenantA.customerId]
    );
    await dbQuery("update carts set status = 'converted', converted_order_id = $2 where id = $1", [cartId, orderRow.id]);
    await dbQuery("update carts set status = 'active', converted_order_id = null where id = $1", [cartId]);

    await page.reload();
    await expect(page.locator(`#giftOptions input[data-gift-option-id="${optionId}"]`)).toBeChecked();
    await expect(page.locator('#summaryGiftRow')).toBeVisible();

    // Deactivating the wrap drops it from the live cart on the next revalidation.
    const deactivated = await bff(admin.page, `/operations/gift-wrap/${optionId}/active`, {
      method: 'POST',
      body: { is_active: false },
    });
    expect(deactivated.status).toBe(200);

    await page.reload();
    // The revalidation happens server-side on the next cart read, so wait on the
    // canonical row before asserting the UI mirrors it.
    await expect.poll(async () => {
      const [row] = await dbQuery('select gift_wrap_option_id from carts where id = $1', [cartId]);
      return row.gift_wrap_option_id;
    }, { timeout: 15_000 }).toBeNull();
    const [afterDeactivate] = await dbQuery('select gift_wrap_fee from carts where id = $1', [cartId]);
    expect(Number(afterDeactivate.gift_wrap_fee)).toBe(0);
    await expect(page.locator('#summaryGiftRow')).toBeHidden();

    await dbQuery('delete from orders where id = $1', [orderRow.id]).catch(() => {});
    await admin.context.close();
  });

  test("another tenant's wrap is neither listed nor selectable on this storefront", async ({ page, browser, e2eState }) => {
    const adminB = await adminSession(browser, e2eState, 'tenantB');
    const createResponse = await bff(adminB.page, '/operations/gift-wrap', {
      method: 'POST',
      body: { title: 'E2E B Tenant Kutusu', fee: 999, is_active: true },
    });
    expect(createResponse.status).toBe(201);
    const foreignOptionId = createResponse.body.option.id;
    created.push(foreignOptionId);
    await adminB.context.close();

    await setCart(page, e2eState, e2eState.fixtures.tenantA);
    await page.goto(`${e2eState.origins.storefront}/siparis`);
    await serverCartId(page);

    // Not offered in tenant A's checkout.
    await expect(page.locator(`#giftOptions input[data-gift-option-id="${foreignOptionId}"]`)).toHaveCount(0);
    await expect(page.locator('#giftSection')).not.toContainText('E2E B Tenant Kutusu');

    // And selecting it directly through the API is rejected, not silently priced.
    const forced = await page.evaluate(async (id) => {
      const view = window.Suvera.currentServerCart;
      try {
        await window.SuveraAPI.cart.setGiftWrap({ gift_wrap_option_id: id }, view.version);
        return { ok: true };
      } catch (error) {
        return { ok: false, message: String(error && error.message) };
      }
    }, foreignOptionId);
    expect(forced.ok).toBe(false);

    const cartId = await page.evaluate(() => window.Suvera.currentServerCart.id);
    const [cartRow] = await dbQuery('select gift_wrap_option_id, gift_wrap_fee from carts where id = $1', [cartId]);
    expect(cartRow.gift_wrap_option_id).toBeNull();
    expect(Number(cartRow.gift_wrap_fee)).toBe(0);
  });

  test('an over-length gift note is rejected by the server, not silently truncated', async ({ page, browser, e2eState }) => {
    const admin = await adminSession(browser, e2eState);
    const createResponse = await bff(admin.page, '/operations/gift-wrap', {
      method: 'POST',
      body: { title: 'E2E Not Sinir Kutusu', fee: 10, is_active: true },
    });
    const optionId = createResponse.body.option.id;
    created.push(optionId);
    await admin.context.close();

    await setCart(page, e2eState, e2eState.fixtures.tenantA);
    await page.goto(`${e2eState.origins.storefront}/siparis`);
    const cartId = await serverCartId(page);
    await page.locator(`#giftOptions input[data-gift-option-id="${optionId}"]`).check();
    await expect(page.locator('#giftStatus')).toHaveText('Hediye paketi eklendi.');

    // The textarea caps input, so drive the API directly to prove the server enforces it.
    const rejected = await page.evaluate(async () => {
      const view = window.Suvera.currentServerCart;
      try {
        await window.SuveraAPI.cart.setGiftWrap({ gift_note: 'x'.repeat(501) }, view.version);
        return { ok: true };
      } catch (error) {
        return { ok: false, message: String(error && error.message) };
      }
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.message).toContain('500');

    const [cartRow] = await dbQuery('select gift_note from carts where id = $1', [cartId]);
    expect(cartRow.gift_note).toBeNull();
  });
});
