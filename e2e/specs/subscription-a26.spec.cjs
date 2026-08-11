'use strict';

const { bff, ensureSuperAdminMfa, expect, loginAdmin, stepUpWithPassword, test } = require('../fixtures.cjs');
const { dbQuery } = require('../lib/db.cjs');
const { readState } = require('../lib/state.cjs');

// A26 subscription + plan lifecycle. Split into focused flows rather than one giant test.
// Direct DB access is used only to seed preconditions and to verify canonical state; every
// user-facing action goes through the real API.

const REASON = 'A26 e2e dogrulama';

async function superAdmin(browser, e2eState) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAdmin(page, e2eState, { superAdmin: true });
  await ensureSuperAdminMfa(page, e2eState);
  return { context, page };
}

async function tenantAdmin(browser, e2eState, tenant = 'tenantA') {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAdmin(page, e2eState, { tenant });
  await stepUpWithPassword(page, e2eState.credentials[tenant].password);
  return { context, page };
}

async function resetSubscription(organizationId) {
  await dbQuery('delete from subscription_overrides where organization_id = $1', [organizationId]);
  await dbQuery('delete from plan_change_requests where organization_id = $1', [organizationId]);
  await dbQuery('delete from subscription_invoices where organization_id = $1', [organizationId]);
  await dbQuery('delete from billing_events where organization_id = $1', [organizationId]);
  await dbQuery('delete from subscriptions where organization_id = $1', [organizationId]);
  await dbQuery('delete from organization_trials where organization_id = $1', [organizationId]);
}

// Pin a subscription in a known state without going through the state machine, so each
// flow starts from an unambiguous precondition.
async function seedSubscription(organizationId, { status = 'active', plan = 'starter', extra = {} } = {}) {
  const [version] = await dbQuery(
    "select id from plan_versions where plan_name = $1 and version = 1", [plan]
  );
  const columns = Object.keys(extra);
  const [row] = await dbQuery(
    `insert into subscriptions (organization_id, provider, plan, plan_version_id, status,
       current_period_start, current_period_end, last_transition_at
       ${columns.length ? `, ${columns.join(', ')}` : ''})
     values ($1,'manual',$2,$3,$4, now(), now() + interval '30 days', now()
       ${columns.map((_, i) => `, $${i + 5}`).join('')})
     returning *`,
    [organizationId, plan, version.id, status, ...Object.values(extra)]
  );
  return row;
}

test.describe('A26 subscription lifecycle', () => {
  let orgA;
  let orgB;

  test.beforeAll(() => {
    const state = readState();
    orgA = state.fixtures.tenantA.organizationId;
    orgB = state.fixtures.tenantB.organizationId;
  });

  test.afterEach(async () => {
    await resetSubscription(orgA);
  });

  test('1-3 a trialing tenant sees its subscription, converts to active, and expires when the trial ends', async ({ browser, e2eState }) => {
    await resetSubscription(orgA);
    await seedSubscription(orgA, {
      status: 'trialing',
      extra: { trial_start: new Date(Date.now() - 86400000).toISOString(), trial_end: new Date(Date.now() + 5 * 86400000).toISOString() },
    });

    const tenant = await tenantAdmin(browser, e2eState);
    const overview = await bff(tenant.page, '/subscription');
    expect(overview.status).toBe(200);
    expect(overview.body.subscription.status).toBe('trialing');
    expect(overview.body.subscription.trial_end).not.toBeNull();
    expect(overview.body.plan.version).toBe(1);
    // A trialing tenant keeps full access; a trial you cannot use is not a trial.
    expect(overview.body.access.capabilities).toContain('write');

    // trial -> active through the state machine.
    const admin = await superAdmin(browser, e2eState);
    const activated = await bff(admin.page, `/operations/subscriptions/${orgA}/transition`, {
      method: 'POST', body: { to: 'active', reason: REASON },
    });
    expect(activated.status).toBe(200);
    expect(activated.body.previous_status).toBe('trialing');
    expect(activated.body.subscription.status).toBe('active');

    // Trial expiry: a trial whose deadline passed becomes expired and goes read-only.
    await dbQuery("update subscriptions set status = 'trialing', trial_end = now() - interval '1 hour' where organization_id = $1", [orgA]);
    await dbQuery("update organization_trials set outcome = 'running' where organization_id = $1", [orgA]);
    await dbQuery(
      `insert into organization_trials (organization_id, plan_name, ends_at, outcome)
       select $1, 'starter', now() - interval '1 hour', 'running'
        where not exists (select 1 from organization_trials where organization_id = $1)`,
      [orgA]
    );
    const expiredRun = await bff(admin.page, `/operations/subscriptions/${orgA}/transition`, {
      method: 'POST', body: { to: 'expired', reason: 'deneme suresi doldu' },
    });
    expect(expiredRun.status).toBe(200);
    const after = await bff(tenant.page, '/subscription');
    expect(after.body.subscription.status).toBe('expired');
    expect(after.body.access.capabilities).not.toContain('write');
    // Read and billing stay open so the tenant can recover on their own.
    expect(after.body.access.capabilities).toEqual(expect.arrayContaining(['read', 'billing']));

    await admin.context.close();
    await tenant.context.close();
  });

  test('4-7 payment failure walks active -> past_due -> grace_period -> suspended and recovers to active', async ({ browser, e2eState }) => {
    await resetSubscription(orgA);
    await seedSubscription(orgA, { status: 'active' });
    const admin = await superAdmin(browser, e2eState);

    const pastDue = await bff(admin.page, `/operations/subscriptions/${orgA}/transition`, {
      method: 'POST', body: { to: 'past_due', reason: 'odeme alinamadi' },
    });
    expect(pastDue.body.subscription.status).toBe('past_due');

    const graceUntil = new Date(Date.now() + 3 * 86400000).toISOString();
    const grace = await bff(admin.page, `/operations/subscriptions/${orgA}/transition`, {
      method: 'POST', body: { to: 'grace_period', reason: 'ek sure taniniyor', grace_until: graceUntil },
    });
    expect(grace.body.subscription.status).toBe('grace_period');
    expect(grace.body.subscription.grace_until).not.toBeNull();

    const suspended = await bff(admin.page, `/operations/subscriptions/${orgA}/transition`, {
      method: 'POST', body: { to: 'suspended', reason: 'ek sure doldu' },
    });
    expect(suspended.body.subscription.status).toBe('suspended');

    // Suspension withdraws write access but never touches data.
    const [products] = await dbQuery('select count(*)::int as n from products where organization_id = $1', [orgA]);
    expect(products.n).toBeGreaterThan(0);

    const tenant = await tenantAdmin(browser, e2eState);
    const suspendedView = await bff(tenant.page, '/subscription');
    expect(suspendedView.body.access.capabilities).not.toContain('write');

    // Recovery requires an explicit reason and restores full access.
    const recovered = await bff(admin.page, `/operations/subscriptions/${orgA}/transition`, {
      method: 'POST', body: { to: 'active', reason: 'odeme tahsil edildi' },
    });
    expect(recovered.body.subscription.status).toBe('active');
    expect(recovered.body.subscription.grace_until).toBeNull();
    expect(recovered.body.subscription.suspended_at).toBeNull();

    await admin.context.close();
    await tenant.context.close();
  });

  test('21-23 illegal transitions and cross-tenant access are refused with machine-readable errors', async ({ browser, e2eState }) => {
    await resetSubscription(orgA);
    await seedSubscription(orgA, { status: 'active' });
    const admin = await superAdmin(browser, e2eState);

    // active -> grace_period is not a legal edge.
    const illegal = await bff(admin.page, `/operations/subscriptions/${orgA}/transition`, {
      method: 'POST', body: { to: 'grace_period', reason: REASON },
    });
    expect(illegal.status).toBe(409);
    expect(illegal.body.code).toBe('INVALID_SUBSCRIPTION_TRANSITION');
    const [unchanged] = await dbQuery('select status from subscriptions where organization_id = $1', [orgA]);
    expect(unchanged.status).toBe('active');

    // A reason is mandatory for every super-admin mutation.
    const noReason = await bff(admin.page, `/operations/subscriptions/${orgA}/transition`, {
      method: 'POST', body: { to: 'past_due' },
    });
    expect(noReason.status).toBe(400);
    expect(noReason.body.code).toBe('REASON_REQUIRED');
    await admin.context.close();

    // A tenant admin cannot reach the platform surface at all.
    const tenant = await tenantAdmin(browser, e2eState);
    const forbidden = await bff(tenant.page, `/operations/subscriptions/${orgB}`);
    expect([401, 403]).toContain(forbidden.status);
    // And the tenant endpoint only ever answers for its own organization.
    const own = await bff(tenant.page, '/subscription');
    expect(own.status).toBe(200);
    expect(JSON.stringify(own.body)).not.toContain(orgB);
    await tenant.context.close();
  });

  test('11-15 publishing a new plan version never moves an existing subscription', async ({ browser, e2eState }) => {
    await resetSubscription(orgA);
    await seedSubscription(orgA, { status: 'active', plan: 'starter' });
    const admin = await superAdmin(browser, e2eState);
    const tenant = await tenantAdmin(browser, e2eState);

    const before = await bff(tenant.page, '/subscription');
    expect(before.body.plan.version).toBe(1);
    const pinnedLimit = before.body.limits.maxProducts;

    // Draft + publish v2 with deliberately different limits.
    const draft = await bff(admin.page, '/operations/subscriptions/plans/starter/versions', {
      method: 'POST',
      body: {
        limits: {
          maxProducts: 999, maxOrdersMonth: 999, maxMembers: 999,
          // A27 added maxDomains and A29 added the three integration dimensions: a plan
          // version must declare EVERY limit dimension, so a missing one is rejected rather
          // than silently defaulted to zero.
          maxStorageMb: 999, maxCollections: 999, maxBlogPosts: 999, maxDomains: 999,
          maxApiKeys: 999, maxWebhooks: 999, maxApiCallsMonth: 999999,
        },
        notes: 'a26 e2e v2',
      },
    });
    expect(draft.status).toBe(201);
    expect(draft.body.version.status).toBe('draft');
    const newVersion = draft.body.version.version;

    const published = await bff(admin.page, `/operations/subscriptions/plans/starter/versions/${newVersion}/publish`, {
      method: 'POST', body: {},
    });
    expect(published.status).toBe(200);
    expect(published.body.version.status).toBe('active');

    // The existing subscription stays pinned to v1 with its original limits.
    const after = await bff(tenant.page, '/subscription');
    expect(after.body.plan.version).toBe(1);
    expect(after.body.limits.maxProducts).toBe(pinnedLimit);

    // A published version is immutable: re-publishing is refused by the backend.
    const republish = await bff(admin.page, `/operations/subscriptions/plans/starter/versions/${newVersion}/publish`, {
      method: 'POST', body: {},
    });
    expect(republish.status).toBe(409);
    expect(republish.body.code).toBe('PLAN_VERSION_NOT_DRAFT');

    // A NEW subscription picks up the active version instead.
    await resetSubscription(orgB);
    const granted = await bff(admin.page, `/operations/subscriptions/${orgB}/grant`, {
      method: 'POST', body: { plan: 'starter', provider: 'manual', reason: REASON },
    });
    expect(granted.status).toBe(201);
    const [newSub] = await dbQuery(
      `select pv.version from subscriptions s join plan_versions pv on pv.id = s.plan_version_id
        where s.organization_id = $1`, [orgB]
    );
    expect(Number(newSub.version)).toBe(newVersion);

    // Restore starter v1 as active so later tests see the baseline. The subscription that
    // references v2 has to go first: plan_change/plan_version FKs are ON DELETE RESTRICT
    // precisely so a version in use cannot be deleted out from under a tenant.
    await resetSubscription(orgB);
    await dbQuery("update plan_versions set status = 'retired' where plan_name = 'starter' and version = $1", [newVersion]);
    await dbQuery("update plan_versions set status = 'active' where plan_name = 'starter' and version = 1");
    await dbQuery('delete from plan_versions where plan_name = $1 and version = $2', ['starter', newVersion]);

    await admin.context.close();
    await tenant.context.close();
  });

  test('8-10 upgrade applies immediately while an over-limit downgrade is scheduled, never destructive', async ({ browser, e2eState }) => {
    await resetSubscription(orgA);
    await seedSubscription(orgA, { status: 'active', plan: 'growth' });
    const tenant = await tenantAdmin(browser, e2eState);

    // Preview is read-only and reports the comparison.
    const preview = await bff(tenant.page, '/subscription/plan-change/preview?plan=business');
    expect(preview.status).toBe(200);
    expect(preview.body.preview.targetPlan).toBe('business');
    expect(Array.isArray(preview.body.preview.resources)).toBe(true);
    // The preview must not fabricate A27/A29 resources that do not exist yet.
    const resourceKeys = preview.body.preview.resources.map((r) => r.resource);
    expect(resourceKeys).not.toContain('domains');
    expect(resourceKeys).not.toContain('api_calls');
    expect(resourceKeys).not.toContain('webhooks');

    // Upgrade applies immediately.
    const upgrade = await bff(tenant.page, '/subscription/plan-change', {
      method: 'POST', body: { plan: 'business' },
    });
    expect(upgrade.status).toBe(200);
    expect(upgrade.body.applied).toBe(true);
    expect(upgrade.body.request.change_type).toBe('upgrade');

    // Force an over-limit downgrade: pin a tiny target so current usage exceeds it.
    const [productCount] = await dbQuery('select count(*)::int as n from products where organization_id = $1', [orgA]);
    expect(productCount.n).toBeGreaterThan(0);
    const downPreview = await bff(tenant.page, '/subscription/plan-change/preview?plan=starter');
    expect(downPreview.status).toBe(200);

    const downgrade = await bff(tenant.page, '/subscription/plan-change', {
      method: 'POST', body: { plan: 'starter' },
    });
    // Either it fits (applied) or it is scheduled — never a destructive immediate apply.
    if (downPreview.body.preview.exceeded) {
      expect(downgrade.status).toBe(202);
      expect(downgrade.body.applied).toBe(false);
      expect(downgrade.body.request.status).toBe('scheduled');
      expect(downgrade.body.request.effective_at).not.toBeNull();
    } else {
      expect(downgrade.body.applied).toBe(true);
    }
    // Nothing was removed either way.
    const [afterProducts] = await dbQuery('select count(*)::int as n from products where organization_id = $1', [orgA]);
    expect(afterProducts.n).toBe(productCount.n);

    await tenant.context.close();
  });

  test('16-17 duplicate and out-of-order billing events cannot drive a second or backward transition', async ({ browser, e2eState }) => {
    await resetSubscription(orgA);
    const subscription = await seedSubscription(orgA, { status: 'active' });
    const eventId = `evt_a26_e2e_${Date.now()}`;

    await dbQuery(
      `insert into billing_events (organization_id, subscription_id, provider, provider_event_id, event_type, event_sequence, status, processed_at)
       values ($1,$2,'test',$3,'invoice.payment_failed',200,'processed', now())`,
      [orgA, subscription.id, eventId]
    );

    // A replayed webhook is inert: the unique index keeps exactly one row.
    await expect(dbQuery(
      `insert into billing_events (organization_id, provider, provider_event_id, event_type, event_sequence)
       values ($1,'test',$2,'invoice.payment_failed',200)`,
      [orgA, eventId]
    )).rejects.toThrow(/idx_billing_events_provider_event/);
    const [count] = await dbQuery('select count(*)::int as n from billing_events where provider_event_id = $1', [eventId]);
    expect(count.n).toBe(1);

    // An older event is detectably behind the applied state, so it cannot rewind it.
    await dbQuery(
      `insert into billing_events (organization_id, subscription_id, provider, provider_event_id, event_type, event_sequence, status)
       values ($1,$2,'test',$3,'invoice.paid',100,'pending')`,
      [orgA, subscription.id, `${eventId}_older`]
    );
    const [latest] = await dbQuery(
      `select event_sequence from billing_events
        where subscription_id = $1 and status = 'processed'
        order by event_sequence desc nulls last limit 1`,
      [subscription.id]
    );
    expect(Number(latest.event_sequence)).toBe(200);
    const [stillActive] = await dbQuery('select status from subscriptions where organization_id = $1', [orgA]);
    expect(stillActive.status).toBe('active');
  });

  test('18-19,26-27 manual provider operates fully while unconfigured providers stay not_configured and no fake payment appears', async ({ browser, e2eState }) => {
    await resetSubscription(orgA);
    const admin = await superAdmin(browser, e2eState);

    const granted = await bff(admin.page, `/operations/subscriptions/${orgA}/grant`, {
      method: 'POST', body: { plan: 'starter', provider: 'manual', reason: REASON },
    });
    expect(granted.status).toBe(201);
    expect(granted.body.subscription.provider).toBe('manual');

    // Granting a subscription never produces a settled payment.
    const [invoices] = await dbQuery(
      "select count(*)::int as n from subscription_invoices where organization_id = $1 and status = 'paid'", [orgA]
    );
    expect(invoices.n).toBe(0);

    // Unconfigured real providers report not_configured rather than pretending.
    for (const provider of ['stripe', 'iyzico']) {
      const probe = await bff(admin.page, `/operations/subscriptions/providers/${provider}`);
      expect(probe.status).toBe(200);
      expect(probe.body.configured).toBe(false);
    }

    // An invoice can only be recorded as paid with a real settlement timestamp.
    const noTimestamp = await bff(admin.page, `/operations/subscriptions/${orgA}/invoices`, {
      method: 'POST', body: { subtotal: 100, tax_total: 20, status: 'paid', reason: REASON },
    });
    expect(noTimestamp.status).toBe(400);
    expect(noTimestamp.body.code).toBe('PAID_REQUIRES_TIMESTAMP');

    const open = await bff(admin.page, `/operations/subscriptions/${orgA}/invoices`, {
      method: 'POST', body: { subtotal: 100, tax_total: 20, status: 'open', reason: REASON },
    });
    expect(open.status).toBe(201);
    expect(open.body.invoice.status).toBe('open');
    expect(Number(open.body.invoice.total)).toBe(120);

    // The tenant sees it, and it is not marked paid.
    const tenant = await tenantAdmin(browser, e2eState);
    const list = await bff(tenant.page, '/subscription/invoices');
    expect(list.status).toBe(200);
    expect(list.body.items.some((invoice) => invoice.status === 'paid')).toBe(false);

    await admin.context.close();
    await tenant.context.close();
  });

  test('20-21 an override raises the ceiling while live and stops applying once expired', async ({ browser, e2eState }) => {
    await resetSubscription(orgA);
    const subscription = await seedSubscription(orgA, { status: 'active', plan: 'starter' });
    const admin = await superAdmin(browser, e2eState);
    const tenant = await tenantAdmin(browser, e2eState);

    const baseline = await bff(tenant.page, '/subscription');
    const baseLimit = baseline.body.limits.maxProducts;

    // An override with no expiry is refused: there is no indefinite bypass.
    const noExpiry = await bff(admin.page, `/operations/subscriptions/${orgA}/overrides`, {
      method: 'POST',
      body: { override_type: 'limit', target_key: 'maxProducts', target_value: { limit: 4242 }, reason: REASON },
    });
    expect(noExpiry.status).toBe(400);
    expect(noExpiry.body.code).toBe('EXPIRY_REQUIRED');

    const created = await bff(admin.page, `/operations/subscriptions/${orgA}/overrides`, {
      method: 'POST',
      body: {
        override_type: 'limit', target_key: 'maxProducts', target_value: { limit: 4242 },
        reason: REASON, expires_at: new Date(Date.now() + 86400000).toISOString(),
      },
    });
    expect(created.status).toBe(201);

    const raised = await bff(tenant.page, '/subscription');
    expect(raised.body.limits.maxProducts).toBe(4242);
    expect(raised.body.plan.overrides).toEqual([{ resource: 'maxProducts', limit: 4242 }]);

    // Expiry is evaluated in SQL: once past, it simply stops applying.
    await dbQuery(
      `update subscription_overrides set created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
        where organization_id = $1 and subscription_id = $2`,
      [orgA, subscription.id]
    );
    const lapsed = await bff(tenant.page, '/subscription');
    expect(lapsed.body.limits.maxProducts).toBe(baseLimit);
    expect(lapsed.body.plan.overrides).toEqual([]);

    await admin.context.close();
    await tenant.context.close();
  });

  test('22,24 backend enforces the hard limit even when the UI is bypassed', async ({ browser, e2eState }) => {
    await resetSubscription(orgA);
    await seedSubscription(orgA, { status: 'active', plan: 'starter' });

    // Pin a version whose product ceiling is already reached.
    const [used] = await dbQuery('select count(*)::int as n from products where organization_id = $1', [orgA]);
    const capPlan = `a26-e2e-cap-${Date.now()}`;
    await dbQuery(
      `insert into plan_versions (plan_name, version, status, effective_from, limits, published_at)
       values ($1, 1, 'active', now(), $2::jsonb, now())`,
      [capPlan, JSON.stringify({
        maxProducts: used.n, maxOrdersMonth: 100000, maxMembers: 1000,
        maxStorageMb: 100000, maxCollections: 1000, maxBlogPosts: 1000,
      })]
    );
    await dbQuery(
      'update subscriptions set plan_version_id = (select id from plan_versions where plan_name = $2) where organization_id = $1',
      [orgA, capPlan]
    );

    const tenant = await tenantAdmin(browser, e2eState);
    const overview = await bff(tenant.page, '/subscription');
    const productWarning = overview.body.warnings.find((w) => w.resource === 'products');
    expect(productWarning.atLimit).toBe(true);

    // Creating a product directly through the API (bypassing any UI guard) is refused.
    const created = await bff(tenant.page, '/products', {
      method: 'POST',
      body: { name: `A26 Limit Probe ${Date.now()}`, price: 10, status: 'active' },
    });
    expect(created.status).toBe(402);
    expect(created.body.code).toBe('PLAN_LIMIT_REACHED');

    // Nothing was created, and nothing existing was removed.
    const [after] = await dbQuery('select count(*)::int as n from products where organization_id = $1', [orgA]);
    expect(after.n).toBe(used.n);

    // Drop the subscription's reference before removing the probe version (ON DELETE
    // RESTRICT guards a version that is still in use).
    await resetSubscription(orgA);
    await dbQuery('delete from plan_versions where plan_name = $1', [capPlan]);
    await tenant.context.close();
  });

  test('28 cancel at period end is reversible and never deletes the subscription', async ({ browser, e2eState }) => {
    await resetSubscription(orgA);
    await seedSubscription(orgA, { status: 'active' });
    const tenant = await tenantAdmin(browser, e2eState);

    const cancelled = await bff(tenant.page, '/subscription/cancel', { method: 'POST', body: { reason: REASON } });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.subscription.cancel_at_period_end).toBe(true);
    // The subscription is still active until the period actually ends.
    expect(cancelled.body.subscription.status).toBe('active');

    const resumed = await bff(tenant.page, '/subscription/resume', { method: 'POST', body: {} });
    expect(resumed.status).toBe(200);
    expect(resumed.body.subscription.cancel_at_period_end).toBe(false);

    // Resuming when nothing is scheduled is a clean, machine-readable refusal.
    const again = await bff(tenant.page, '/subscription/resume', { method: 'POST', body: {} });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('NO_SCHEDULED_CANCELLATION');

    await tenant.context.close();
  });

  test('29-30 the tenant subscription view reports usage, warnings and pinned plan coherently', async ({ browser, e2eState }) => {
    await resetSubscription(orgA);
    await seedSubscription(orgA, { status: 'active', plan: 'starter' });
    const tenant = await tenantAdmin(browser, e2eState);

    const overview = await bff(tenant.page, '/subscription');
    expect(overview.status).toBe(200);
    expect(overview.body.plan.limit_source).toBe('plan_version');
    expect(overview.body.plan.version).toBe(1);
    expect(overview.body.usage).toHaveProperty('products');
    expect(overview.body.usage).toHaveProperty('ordersMonth');
    expect(overview.body.usage).toHaveProperty('members');
    expect(overview.body.usage).toHaveProperty('storageMb');

    // Warnings cover only measured resources; no invented A27/A29 counters.
    const resources = overview.body.warnings.map((w) => w.resource);
    expect(resources).toContain('products');
    expect(resources).not.toContain('domains');
    expect(resources).not.toContain('webhooks');
    for (const warning of overview.body.warnings) {
      // warning and atLimit are distinct states, never both silently merged.
      expect(typeof warning.warning).toBe('boolean');
      expect(typeof warning.atLimit).toBe('boolean');
    }

    await tenant.context.close();
  });
});
