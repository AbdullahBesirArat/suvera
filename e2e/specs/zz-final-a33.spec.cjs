'use strict';

const {
  bff,
  expect,
  fillCheckout,
  loginAdmin,
  setCart,
  stepUpWithPassword,
  test,
} = require('../fixtures.cjs');
const { dbQuery } = require('../lib/db.cjs');

test.describe.serial('A33 final mandatory matrix and invariants', () => {
  let checkoutOrder;
  let customerReturn;

  test('production-like metrics require the run-scoped bearer token', async ({ request, e2eState }) => {
    const denied = await request.get(`${e2eState.origins.api}/api/metrics`);
    expect(denied.status()).toBe(401);
    const allowed = await request.get(`${e2eState.origins.api}/api/metrics`, {
      headers: { authorization: `Bearer ${e2eState.smoke.metricsToken}` },
    });
    expect(allowed.status()).toBe(200);
    expect(await allowed.text()).toContain('panelya_requests_total');
  });

  test('storefront checkout creates a reservation, duplicate callback is inert, and customer submits a return', async ({ page, request, e2eState }) => {
    await setCart(page, e2eState, e2eState.fixtures.tenantA);
    await page.goto(`${e2eState.origins.storefront}/siparis`);
    await fillCheckout(page, { email: 'a33-reservation@example.test' });
    await page.locator('#payButton').click();
    await page.waitForURL(/\/tesekkur(?:\?|$)/, { timeout: 30_000 });
    await expect(page.locator('#thankYouOrderCode')).not.toHaveText('-');
    [checkoutOrder] = await dbQuery(
      `select id, organization_id, order_code, payment_status, total
         from orders where organization_id = $1
         order by created_at desc, id desc limit 1`,
      [e2eState.fixtures.tenantA.organizationId]
    );
    expect(checkoutOrder).toBeTruthy();
    const orderCode = checkoutOrder.order_code;
    const [reservation] = await dbQuery(
      'select id, status from inventory_reservations where organization_id = $1 and order_id = $2',
      [checkoutOrder.organization_id, checkoutOrder.id]
    );
    expect(reservation).toBeTruthy();
    expect(['active', 'consumed']).toContain(reservation.status);

    const callback = () => request.post(`${e2eState.origins.api}/api/payment/callback`, {
      headers: { 'x-payment-callback-secret': e2eState.smoke.paymentCallbackSecret },
      data: { orderCode, status: 'paid' },
    });
    const first = await callback();
    expect(first.status()).toBe(200);
    const firstBody = await first.json();
    const [afterFirst] = await dbQuery(
      `select count(*)::int as callback_count
         from payment_callback_events where organization_id = $1 and order_code = $2`,
      [checkoutOrder.organization_id, orderCode]
    );
    const second = await callback();
    expect(second.status()).toBe(200);
    const secondBody = await second.json();
    const [afterSecond] = await dbQuery(
      `select count(*)::int as callback_count
         from payment_callback_events where organization_id = $1 and order_code = $2`,
      [checkoutOrder.organization_id, orderCode]
    );
    expect(secondBody.callbackEventId).toBe(firstBody.callbackEventId);
    expect(afterSecond.callback_count).toBe(afterFirst.callback_count);

    const [customerAccount] = await dbQuery(
      'select id from customer_accounts where organization_id = $1 and email = $2',
      [e2eState.fixtures.tenantA.organizationId, e2eState.credentials.customerA.email]
    );
    await dbQuery(
      `update orders
          set status = 'delivered', order_status = 'delivered', payment_status = 'paid',
              fulfillment_status = 'delivered', customer_id = $3, customer_account_id = $4,
              updated_at = now()
        where organization_id = $1 and id = $2`,
      [e2eState.fixtures.tenantA.organizationId, checkoutOrder.id,
        e2eState.fixtures.tenantA.customerId, customerAccount.id]
    );
    await page.goto(`${e2eState.origins.storefront}/giris`);
    await page.locator('#emailInput').fill(e2eState.credentials.customerA.email);
    await page.locator('#pwInput').fill(e2eState.credentials.customerA.password);
    await page.locator('[data-action="do-login"]').click();
    await page.waitForURL(/\/hesabim/, { timeout: 20_000 });
    await expect.poll(() => page.locator('#returnOrder option').count()).toBeGreaterThan(1);
    await page.locator('#returnOrder').selectOption(String(checkoutOrder.id));
    await page.locator('#returnType').selectOption('return');
    await page.locator('[data-return-item]').first().check();
    await page.locator('#returnReason').selectOption({ index: 1 });
    await page.locator('#returnNote').fill('A33 gerçek tarayıcı iade talebi');
    await page.locator('#returnRequestForm button[type="submit"]').click();
    await expect.poll(async () => {
      [customerReturn] = await dbQuery(
        `select id, status from return_requests
          where organization_id = $1 and order_id = $2
          order by requested_at desc limit 1`,
        [e2eState.fixtures.tenantA.organizationId, checkoutOrder.id]
      );
      return customerReturn?.status;
    }).toBe('requested');
  });

  test('admin inventory, CSV preview/apply, coupon, order operations and team role traverse the real BFF', async ({ page, e2eState }) => {
    await loginAdmin(page, e2eState);
    const stock = await bff(page, '/products/bulk-stock', {
      method: 'PATCH',
      body: { updates: [{
        product_id: e2eState.fixtures.tenantA.productId,
        variant_id: e2eState.fixtures.tenantA.variantId,
        stock: 9,
      }] },
    });
    expect(stock.status).toBe(200);
    const [variant] = await dbQuery(
      'select available from product_variants where organization_id = $1 and id = $2',
      [e2eState.fixtures.tenantA.organizationId, e2eState.fixtures.tenantA.variantId]
    );
    expect(Number(variant.available)).toBe(9);

    const importSku = `A33-IMPORT-${Date.now()}`;
    const preview = await page.evaluate(async ({ sku }) => {
      const form = new FormData();
      form.append('type', 'product_upsert');
      form.append('config', '{}');
      form.append('idempotency_key', `a33-import-${sku}`);
      form.append('file', new File([`sku,name,price,status\n${sku},A33 Import Product,125,active`], 'a33.csv', { type: 'text/csv' }));
      const response = await fetch('/api/bff/imports/preview', { method: 'POST', body: form, credentials: 'include' });
      return { status: response.status, body: await response.json() };
    }, { sku: importSku });
    expect(preview.status, JSON.stringify(preview.body)).toBe(201);
    expect(preview.body.status).toBe('previewed');
    const applied = await bff(page, `/imports/${preview.body.id}/apply`, { method: 'POST', body: {} });
    expect(applied.status).toBe(202);
    expect(applied.body.status).toBe('queued');
    await expect.poll(async () => {
      const [job] = await dbQuery('select status from import_jobs where id = $1', [preview.body.id]);
      return job?.status || '';
    }).toMatch(/queued|processing|completed/);

    const code = `A33${Date.now()}`;
    const coupon = await bff(page, '/coupons', {
      method: 'POST',
      body: { code, name: 'A33 admin coupon', discount_type: 'fixed', value: 15, total_usage_limit: 2 },
    });
    expect(coupon.status).toBe(201);

    const [owner] = await dbQuery(
      `select u.id from app_users u
        join memberships m on m.user_id = u.id
       where m.organization_id = $1 and m.role = 'owner' limit 1`,
      [e2eState.fixtures.tenantA.organizationId]
    );
    const note = await bff(page, `/orders/${checkoutOrder.id}/notes`, {
      method: 'POST', body: { visibility: 'internal', content: 'A33 operasyon notu' },
    });
    expect(note.status).toBe(201);
    const assignment = await bff(page, `/orders/${checkoutOrder.id}/assignment`, {
      method: 'PUT', body: { assignedUserId: owner.id },
    });
    expect(assignment.status).toBe(200);
    const detail = await bff(page, `/orders/${checkoutOrder.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.notes.some((entry) => entry.content === 'A33 operasyon notu')).toBe(true);
    expect(detail.body.events.length).toBeGreaterThan(0);

    const [otherUser] = await dbQuery(
      'select id from app_users where email = $1', [e2eState.credentials.tenantB.email]
    );
    const [membership] = await dbQuery(
      `insert into memberships (organization_id, user_id, role, status)
       values ($1,$2,'member','active')
       on conflict (organization_id, user_id) do update set role = 'member', status = 'active'
       returning id`,
      [e2eState.fixtures.tenantA.organizationId, otherUser.id]
    );
    const role = await bff(page, `/organizations/current/members/${membership.id}`, {
      method: 'PUT', body: { role: 'viewer' },
    });
    expect(role.status).toBe(200);
    const [storedRole] = await dbQuery('select role from memberships where id = $1', [membership.id]);
    expect(storedRole.role).toBe('viewer');
  });

  test('admin shipment, manual invoice and approved return/refund/restock complete end to end', async ({ page, e2eState }) => {
    await loginAdmin(page, e2eState);
    const [orderItem] = await dbQuery(
      'select id from order_items where organization_id = $1 and order_id = $2 order by id limit 1',
      [e2eState.fixtures.tenantA.organizationId, e2eState.fixtures.tenantA.orderId]
    );
    const shipment = await bff(page, '/shipments', {
      method: 'POST',
      body: {
        order_id: e2eState.fixtures.tenantA.orderId,
        provider: 'manual',
        carrier_name: 'A33 Manual Kargo',
        service_name: 'Standart',
        tracking_number: `A33-${Date.now()}`,
        tracking_url: 'https://carrier.example/a33',
        items: [{ order_item_id: orderItem.id, quantity: 1 }],
      },
    });
    expect(shipment.status).toBe(201);

    const invoice = await bff(page, '/invoices', {
      method: 'POST',
      body: {
        order_id: checkoutOrder.id,
        provider: 'manual',
        idempotency_key: `a33-invoice:${checkoutOrder.id}`,
      },
    });
    expect(invoice.status).toBe(201);
    expect(invoice.body.invoice.provider).toBe('manual');

    const decision = await bff(page, `/returns/${customerReturn.id}/decision`, {
      method: 'POST',
      body: { status: 'approved', public_message: 'A33 onay', return_shipping_code: 'A33-RETURN' },
    });
    expect(decision.status).toBe(200);
    const returnItem = decision.body.items[0];
    const before = await dbQuery(
      'select on_hand from product_variants where organization_id = $1 and id = $2',
      [e2eState.fixtures.tenantA.organizationId, e2eState.fixtures.tenantA.variantId]
    );
    const received = await bff(page, `/returns/${customerReturn.id}/receive`, {
      method: 'POST',
      body: {
        public_message: 'A33 teslim alındı',
        items: [{ return_item_id: returnItem.id, received_quantity: 1, restock_quantity: 1, condition: 'unused' }],
      },
    });
    expect(received.status).toBe(200);
    const after = await dbQuery(
      'select on_hand from product_variants where organization_id = $1 and id = $2',
      [e2eState.fixtures.tenantA.organizationId, e2eState.fixtures.tenantA.variantId]
    );
    expect(Number(after[0].on_hand)).toBe(Number(before[0].on_hand) + 1);

    await stepUpWithPassword(page, e2eState.credentials.tenantA.password);
    const refund = await bff(page, `/returns/${customerReturn.id}/refunds`, {
      method: 'POST',
      body: {
        idempotency_key: `a33-refund:${customerReturn.id}`,
        provider: 'manual',
        reason: 'A33 approved return',
        items: [{ order_item_id: returnItem.order_item_id, quantity: 1, reason_code: 'approved_return', requested_resolution: 'refund' }],
      },
    });
    expect(refund.status).toBe(201);
    const replay = await bff(page, `/returns/${customerReturn.id}/refunds`, {
      method: 'POST',
      body: {
        idempotency_key: `a33-refund:${customerReturn.id}`,
        provider: 'manual',
        reason: 'A33 approved return',
        items: [{ order_item_id: returnItem.order_item_id, quantity: 1, reason_code: 'approved_return', requested_resolution: 'refund' }],
      },
    });
    expect(replay.status).toBe(200);
    expect(replay.body.refund.id).toBe(refund.body.refund.id);
  });

  test('A33 invariant queries report zero violations across inventory, money, tenant, theme, domain and media state', async () => {
    const checks = {
      inventory_nonnegative: `select count(*)::int as count from product_variants where available < 0 or reserved < 0 or on_hand < 0`,
      ledger_current: `with latest as (
        select distinct on (organization_id, variant_id) organization_id, variant_id, on_hand_after, reserved_after
          from inventory_movements order by organization_id, variant_id, id desc)
        select count(*)::int as count from latest l join product_variants v
          on v.organization_id=l.organization_id and v.id=l.variant_id
         where v.on_hand<>l.on_hand_after or v.reserved<>l.reserved_after`,
      active_reservations: `with active as (
        select i.organization_id, i.variant_id, sum(i.quantity)::int as quantity
          from inventory_reservation_items i join inventory_reservations r
            on r.organization_id=i.organization_id and r.id=i.reservation_id
         where r.status='active' group by i.organization_id,i.variant_id)
        select count(*)::int as count from product_variants v left join active a
          on a.organization_id=v.organization_id and a.variant_id=v.id
         where v.reserved<>coalesce(a.quantity,0)`,
      refunds_bounded: `select count(*)::int as count from orders o where o.refunded_total > o.total`,
      coupon_limits: `select count(*)::int as count from coupons c where c.total_usage_limit is not null and
        (select count(*) from coupon_redemptions r where r.organization_id=c.organization_id and r.coupon_id=c.id and r.status in ('reserved','redeemed')) > c.total_usage_limit`,
      one_published_theme: `select count(*)::int as count from (
        select organization_id from theme_versions where status='published' group by organization_id having count(*)>1) x`,
      one_canonical_domain: `select count(*)::int as count from (
        select organization_id from custom_domains where status='active' and is_canonical group by organization_id having count(*)>1) x`,
      tenant_relations: `select (
        (select count(*) from order_items i join orders o on o.id=i.order_id where o.organization_id<>i.organization_id) +
        (select count(*) from product_variants v join products p on p.id=v.product_id where p.organization_id<>v.organization_id) +
        (select count(*) from media_references r join upload_assets a on a.id=r.asset_id where a.organization_id<>r.organization_id)
      )::int as count`,
      media_ready: `select count(*)::int as count from media_references r join upload_assets a
        on a.organization_id=r.organization_id and a.id=r.asset_id where a.status<>'ready'`,
    };
    for (const [name, sql] of Object.entries(checks)) {
      const [row] = await dbQuery(sql);
      expect(row.count, name).toBe(0);
    }
    const [order] = await dbQuery(
      `select total, subtotal, discount_total, shipping_fee, net_total, tax_total, gift_wrap_fee
         from orders where id = $1`, [checkoutOrder.id]
    );
    const expected = Number(order.subtotal) - Number(order.discount_total)
      + Number(order.shipping_fee) + Number(order.gift_wrap_fee);
    expect(Math.abs(Number(order.total) - expected)).toBeLessThan(0.01);
    expect(Math.abs(Number(order.total) - Number(order.net_total) - Number(order.tax_total))).toBeLessThan(0.01);
  });
});
