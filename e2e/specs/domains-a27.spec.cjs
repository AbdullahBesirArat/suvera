'use strict';

const { bff, ensureSuperAdminMfa, expect, loginAdmin, stepUpWithPassword, test } = require('../fixtures.cjs');
const { dbQuery } = require('../lib/db.cjs');
const { readState } = require('../lib/state.cjs');

// A27 custom domains. Deterministic in-process DNS (DOMAIN_DNS_RESOLVER=static) and the
// test domain provider are configured by global-setup, so nothing here touches real
// internet DNS or a real provider API. Split into focused flows rather than one giant test.

const REASON = 'A27 e2e dogrulama';

async function tenantAdmin(browser, e2eState, tenant = 'tenantA') {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAdmin(page, e2eState, { tenant });
  await stepUpWithPassword(page, e2eState.credentials[tenant].password);
  return { context, page };
}

async function superAdmin(browser, e2eState) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAdmin(page, e2eState, { superAdmin: true });
  await ensureSuperAdminMfa(page, e2eState);
  return { context, page };
}

// Publishes a TXT record into the API's deterministic resolver.
async function seedTxt(request, e2eState, name, values) {
  const response = await request.post(`${e2eState.origins.api}/api/__e2e__/dns`, {
    data: { name, values: [].concat(values) },
  });
  expect(response.status()).toBe(200);
}

// Give a tenant headroom above the starter ceiling of one domain.
async function domainHeadroom(organizationId, limit = 10) {
  const planName = `a27-e2e-${organizationId.slice(0, 8)}-${Date.now()}`;
  await dbQuery(
    `insert into plan_versions (plan_name, version, status, effective_from, limits, published_at)
     values ($1, 1, 'active', now(), $2::jsonb, now())`,
    [planName, JSON.stringify({
      maxProducts: 100000, maxOrdersMonth: 100000, maxMembers: 1000,
      maxStorageMb: 100000, maxCollections: 1000, maxBlogPosts: 1000, maxDomains: limit,
    })]
  );
  const [version] = await dbQuery('select id from plan_versions where plan_name = $1', [planName]);
  const [previous] = await dbQuery(
    'select id, plan_version_id from subscriptions where organization_id = $1 order by created_at desc limit 1',
    [organizationId]
  );
  if (!previous) {
    const [v1] = await dbQuery("select id from plan_versions where plan_name = 'starter' and version = 1");
    await dbQuery(
      `insert into subscriptions (organization_id, provider, plan, plan_version_id, status,
         current_period_start, current_period_end)
       values ($1,'manual','starter',$2,'active', now(), now() + interval '30 days')`,
      [organizationId, v1.id]
    );
  }
  await dbQuery('update subscriptions set plan_version_id = $2 where organization_id = $1',
    [organizationId, version.id]);
  return async function restore() {
    if (previous) {
      await dbQuery('update subscriptions set plan_version_id = $2 where id = $1',
        [previous.id, previous.plan_version_id]);
    }
    await dbQuery('delete from custom_domains where organization_id = $1', [organizationId]);
    await dbQuery('delete from plan_versions where plan_name = $1', [planName]).catch(() => {});
  };
}

async function resetDomains(organizationId) {
  await dbQuery('delete from custom_domain_events where organization_id = $1', [organizationId]);
  await dbQuery('delete from custom_domains where organization_id = $1', [organizationId]);
}

test.describe('A27 custom domains', () => {
  let orgA;
  let orgB;

  test.beforeAll(() => {
    const state = readState();
    orgA = state.fixtures.tenantA.organizationId;
    orgB = state.fixtures.tenantB.organizationId;
  });

  test('1-10 add, verify and activate a domain through the real API', async ({ browser, request, e2eState }) => {
    await resetDomains(orgA);
    const restore = await domainHeadroom(orgA);
    const tenant = await tenantAdmin(browser, e2eState);
    const hostname = `shop-${Date.now()}.tenant-store.com`;

    try {
      // Adding returns the challenge exactly once.
      const created = await bff(tenant.page, '/domains', { method: 'POST', body: { hostname: hostname.toUpperCase() } });
      expect(created.status).toBe(201);
      expect(created.body.domain.hostname).toBe(hostname);
      expect(created.body.domain.status).toBe('pending_verification');
      expect(created.body.challenge.name).toBe(`_panelya-verify.${hostname}`);
      const challengeValue = created.body.challenge.value;
      expect(challengeValue.length).toBeGreaterThan(20);
      const domainId = created.body.domain.id;

      // The raw value is never readable again: only its hash is stored.
      const listed = await bff(tenant.page, '/domains');
      expect(listed.status).toBe(200);
      expect(JSON.stringify(listed.body)).not.toContain(challengeValue);
      const [row] = await dbQuery('select verification_token_hash from custom_domains where id = $1', [domainId]);
      expect(row.verification_token_hash).not.toBe(challengeValue);
      expect(row.verification_token_hash).toMatch(/^[0-9a-f]{64}$/);

      // A wrong TXT leaves it pending, with a machine-readable reason.
      await seedTxt(request, e2eState, created.body.challenge.name, ['not-the-right-value']);
      const wrong = await bff(tenant.page, `/domains/${domainId}/verify`, { method: 'POST', body: {} });
      expect(wrong.status).toBe(200);
      expect(wrong.body.verified).toBe(false);
      expect(wrong.body.errorCode).toBe('TXT_RECORD_NOT_FOUND');

      // Regenerating issues a new value and invalidates the old one.
      const regenerated = await bff(tenant.page, `/domains/${domainId}/challenge`, { method: 'POST', body: {} });
      expect(regenerated.status).toBe(200);
      expect(regenerated.body.challenge.value).not.toBe(challengeValue);

      await seedTxt(request, e2eState, created.body.challenge.name, [challengeValue]);
      const stale = await bff(tenant.page, `/domains/${domainId}/verify`, { method: 'POST', body: {} });
      expect(stale.body.verified).toBe(false);

      // The current challenge verifies.
      await seedTxt(request, e2eState, created.body.challenge.name, ['noise', regenerated.body.challenge.value]);
      const verified = await bff(tenant.page, `/domains/${domainId}/verify`, { method: 'POST', body: {} });
      expect(verified.body.verified).toBe(true);
      expect(verified.body.domain.status).toBe('verified');

      // A verified-but-not-activated domain must not resolve a Host yet.
      const beforeActivation = await request.get(`${e2eState.origins.api}/api/catalog/products`, {
        headers: { 'X-Forwarded-Host': hostname },
      });
      expect(beforeActivation.status()).not.toBe(200);

      const activated = await bff(tenant.page, `/domains/${domainId}/activate`, { method: 'POST', body: {} });
      expect(activated.status).toBe(200);
      expect(activated.body.domain.status).toBe('active');
      // The deterministic test provider reports provisioning; it never fabricates 'active'.
      expect(['provisioning', 'pending', 'not_configured']).toContain(activated.body.domain.ssl_status);
    } finally {
      await tenant.context.close();
      await restore();
    }
  });

  test('11-16 an active Host resolves its own tenant; pending, disabled and foreign hosts do not', async ({ browser, request, e2eState }) => {
    await resetDomains(orgA);
    await resetDomains(orgB);
    const restoreA = await domainHeadroom(orgA);
    const restoreB = await domainHeadroom(orgB);
    const tenant = await tenantAdmin(browser, e2eState);
    const hostname = `host-${Date.now()}.tenant-store.com`;

    try {
      const created = await bff(tenant.page, '/domains', { method: 'POST', body: { hostname } });
      const domainId = created.body.domain.id;

      // Pending host does not resolve.
      const pending = await request.get(`${e2eState.origins.api}/api/catalog/products`, { headers: { 'X-Forwarded-Host': hostname } });
      expect(pending.status()).not.toBe(200);

      await seedTxt(request, e2eState, created.body.challenge.name, [created.body.challenge.value]);
      await bff(tenant.page, `/domains/${domainId}/verify`, { method: 'POST', body: {} });
      await bff(tenant.page, `/domains/${domainId}/activate`, { method: 'POST', body: {} });

      // Active host resolves to the right tenant without any slug/token.
      const active = await request.get(`${e2eState.origins.api}/api/catalog/products`, { headers: { 'X-Forwarded-Host': hostname } });
      expect(active.status()).toBe(200);

      // Tenant B cannot claim a hostname tenant A holds.
      const tenantB = await tenantAdmin(browser, e2eState, 'tenantB');
      const stolen = await bff(tenantB.page, '/domains', { method: 'POST', body: { hostname } });
      expect(stolen.status).toBe(409);
      expect(stolen.body.code).toBe('DOMAIN_ALREADY_CLAIMED');
      await tenantB.context.close();

      // A host/token mismatch is refused rather than resolved to either side.
      const mismatch = await request.get(
        `${e2eState.origins.api}/api/catalog/products?organizationSlug=e2e-tenant-b`,
        { headers: { 'X-Forwarded-Host': hostname } }
      );
      expect([400, 403, 404]).toContain(mismatch.status());

      // Disabling stops resolution but keeps the claim.
      await bff(tenant.page, `/domains/${domainId}/disable`, { method: 'POST', body: { reason: REASON } });
      const disabled = await request.get(`${e2eState.origins.api}/api/catalog/products`, { headers: { 'X-Forwarded-Host': hostname } });
      expect(disabled.status()).not.toBe(200);
      const tenantB2 = await tenantAdmin(browser, e2eState, 'tenantB');
      const stillClaimed = await bff(tenantB2.page, '/domains', { method: 'POST', body: { hostname } });
      expect(stillClaimed.status).toBe(409);
      await tenantB2.context.close();
    } finally {
      await tenant.context.close();
      await restoreA();
      await restoreB();
    }
  });

  test('17-20 canonical selection is single and switching drops the previous one', async ({ browser, request, e2eState }) => {
    await resetDomains(orgA);
    const restore = await domainHeadroom(orgA);
    const tenant = await tenantAdmin(browser, e2eState);
    const stamp = Date.now();

    try {
      const ids = [];
      for (const suffix of ['one', 'two']) {
        const hostname = `canon-${suffix}-${stamp}.tenant-store.com`;
        const created = await bff(tenant.page, '/domains', { method: 'POST', body: { hostname } });
        await seedTxt(request, e2eState, created.body.challenge.name, [created.body.challenge.value]);
        await bff(tenant.page, `/domains/${created.body.domain.id}/verify`, { method: 'POST', body: {} });
        await bff(tenant.page, `/domains/${created.body.domain.id}/activate`, { method: 'POST', body: {} });
        ids.push(created.body.domain.id);
      }

      await bff(tenant.page, `/domains/${ids[0]}/canonical`, { method: 'POST', body: {} });
      let canonical = await dbQuery(
        'select id from custom_domains where organization_id = $1 and is_canonical', [orgA]
      );
      expect(canonical.length).toBe(1);
      expect(Number(canonical[0].id)).toBe(ids[0]);

      await bff(tenant.page, `/domains/${ids[1]}/canonical`, { method: 'POST', body: {} });
      canonical = await dbQuery('select id from custom_domains where organization_id = $1 and is_canonical', [orgA]);
      expect(canonical.length).toBe(1);
      expect(Number(canonical[0].id)).toBe(ids[1]);

      // The database refuses a second canonical outright.
      await expect(dbQuery('update custom_domains set is_canonical = true where id = $1', [ids[0]]))
        .rejects.toThrow(/idx_custom_domains_one_canonical/);
    } finally {
      await tenant.context.close();
      await restore();
    }
  });

  test('21-25 host-header attacks are refused and no arbitrary host resolves a tenant', async ({ request, e2eState }) => {
    // Every one of these must fail to resolve a tenant. They are attacker-controlled
    // strings; none of them is a verified active domain.
    const hostileHosts = [
      'evil.example.com',
      'localhost',
      '127.0.0.1',
      'shop.local',
      'tenant-store.com:8443',
    ];
    for (const host of hostileHosts) {
      const response = await request.get(`${e2eState.origins.api}/api/catalog/products`, { headers: { 'X-Forwarded-Host': host } });
      expect(response.status(), `${host} must not resolve a tenant`).not.toBe(200);
    }

    // X-Forwarded-Host from an untrusted client must not select a tenant either.
    const spoofed = await request.get(`${e2eState.origins.api}/api/catalog/products`, {
      headers: { 'X-Forwarded-Host': 'evil.example.com' },
    });
    expect(spoofed.status()).not.toBe(200);
  });

  test('26-28 the domain plan limit is enforced by the backend even when the UI is bypassed', async ({ browser, e2eState }) => {
    await resetDomains(orgA);
    // Ceiling of exactly one domain.
    const restore = await domainHeadroom(orgA, 1);
    const tenant = await tenantAdmin(browser, e2eState);
    const stamp = Date.now();

    try {
      const first = await bff(tenant.page, '/domains', {
        method: 'POST', body: { hostname: `limit-one-${stamp}.tenant-store.com` },
      });
      expect(first.status).toBe(201);

      // A direct API call (no UI guard involved) is still refused.
      const second = await bff(tenant.page, '/domains', {
        method: 'POST', body: { hostname: `limit-two-${stamp}.tenant-store.com` },
      });
      expect(second.status).toBe(402);
      expect(second.body.code).toBe('PLAN_LIMIT_REACHED');

      const [count] = await dbQuery(
        "select count(*)::int as n from custom_domains where organization_id = $1 and status <> 'released'", [orgA]
      );
      expect(count.n).toBe(1);
    } finally {
      await tenant.context.close();
      await restore();
    }
  });

  test('29-33 invalid hostnames are refused with specific machine-readable codes', async ({ browser, e2eState }) => {
    await resetDomains(orgA);
    const restore = await domainHeadroom(orgA);
    const tenant = await tenantAdmin(browser, e2eState);

    try {
      const cases = [
        ['https://shop.tenant-store.com', 'DOMAIN_SCHEME_NOT_ALLOWED'],
        ['shop.tenant-store.com/path', 'DOMAIN_PATH_NOT_ALLOWED'],
        ['shop.tenant-store.com:8443', 'DOMAIN_PORT_NOT_ALLOWED'],
        ['127.0.0.1', 'DOMAIN_IP_NOT_ALLOWED'],
        ['localhost', 'DOMAIN_NOT_QUALIFIED'],
        ['*.tenant-store.com', 'DOMAIN_WILDCARD_NOT_ALLOWED'],
        ['shop.local', 'DOMAIN_RESERVED_INTERNAL'],
      ];
      for (const [hostname, code] of cases) {
        const response = await bff(tenant.page, '/domains', { method: 'POST', body: { hostname } });
        expect(response.status, `${hostname} must be refused`).toBe(400);
        expect(response.body.code, `${hostname} -> ${code}`).toBe(code);
      }

      const [count] = await dbQuery('select count(*)::int as n from custom_domains where organization_id = $1', [orgA]);
      expect(count.n).toBe(0, 'no invalid hostname was stored');
    } finally {
      await tenant.context.close();
      await restore();
    }
  });

  test('34-38 release is the only hand-over, and the new owner must prove ownership again', async ({ browser, request, e2eState }) => {
    await resetDomains(orgA);
    await resetDomains(orgB);
    const restoreA = await domainHeadroom(orgA);
    const restoreB = await domainHeadroom(orgB);
    const tenantA = await tenantAdmin(browser, e2eState);
    const hostname = `handover-${Date.now()}.tenant-store.com`;

    try {
      const created = await bff(tenantA.page, '/domains', { method: 'POST', body: { hostname } });
      const domainId = created.body.domain.id;
      await seedTxt(request, e2eState, created.body.challenge.name, [created.body.challenge.value]);
      await bff(tenantA.page, `/domains/${domainId}/verify`, { method: 'POST', body: {} });
      await bff(tenantA.page, `/domains/${domainId}/activate`, { method: 'POST', body: {} });

      // An active domain cannot be released directly.
      const tooEarly = await bff(tenantA.page, `/domains/${domainId}`, { method: 'DELETE', body: { reason: REASON } });
      expect(tooEarly.status).toBe(409);
      expect(tooEarly.body.code).toBe('DOMAIN_STILL_ACTIVE');

      await bff(tenantA.page, `/domains/${domainId}/disable`, { method: 'POST', body: { reason: REASON } });
      const released = await bff(tenantA.page, `/domains/${domainId}`, { method: 'DELETE', body: { reason: REASON } });
      expect(released.status).toBe(200);
      const [row] = await dbQuery('select status, released_at from custom_domains where id = $1', [domainId]);
      expect(row.status).toBe('released');
      expect(row.released_at).not.toBeNull();

      // Now tenant B may claim it — with a brand-new challenge; the old proof is worthless.
      const tenantB = await tenantAdmin(browser, e2eState, 'tenantB');
      const reclaimed = await bff(tenantB.page, '/domains', { method: 'POST', body: { hostname } });
      expect(reclaimed.status).toBe(201);
      expect(reclaimed.body.domain.status).toBe('pending_verification');
      expect(reclaimed.body.challenge.value).not.toBe(created.body.challenge.value);

      await seedTxt(request, e2eState, reclaimed.body.challenge.name, [created.body.challenge.value]);
      const oldProof = await bff(tenantB.page, `/domains/${reclaimed.body.domain.id}/verify`, { method: 'POST', body: {} });
      expect(oldProof.body.verified).toBe(false);
      await tenantB.context.close();
    } finally {
      await tenantA.context.close();
      await restoreA();
      await restoreB();
    }
  });

  test('39-44 super-admin overview, mandatory reason, force-disable and audit', async ({ browser, request, e2eState }) => {
    await resetDomains(orgA);
    const restore = await domainHeadroom(orgA);
    const tenant = await tenantAdmin(browser, e2eState);
    const admin = await superAdmin(browser, e2eState);
    const hostname = `ops-${Date.now()}.tenant-store.com`;

    try {
      const created = await bff(tenant.page, '/domains', { method: 'POST', body: { hostname } });
      const domainId = created.body.domain.id;
      await seedTxt(request, e2eState, created.body.challenge.name, [created.body.challenge.value]);
      await bff(tenant.page, `/domains/${domainId}/verify`, { method: 'POST', body: {} });
      await bff(tenant.page, `/domains/${domainId}/activate`, { method: 'POST', body: {} });

      // A tenant admin cannot reach the platform surface at all.
      const forbidden = await bff(tenant.page, '/operations/domains');
      expect([401, 403]).toContain(forbidden.status);

      const overview = await bff(admin.page, '/operations/domains');
      expect(overview.status).toBe(200);
      const found = overview.body.items.find((item) => item.hostname === hostname);
      expect(found).toBeTruthy();
      expect(found.organization_id).toBe(orgA);
      // The verification hash is never exposed on this surface.
      expect(JSON.stringify(overview.body)).not.toContain('verification_token_hash');
      expect(JSON.stringify(overview.body)).not.toContain(created.body.challenge.value);

      // Force-disable demands a reason.
      const noReason = await bff(admin.page, `/operations/domains/${domainId}/force-disable`, {
        method: 'POST', body: {},
      });
      expect(noReason.status).toBe(400);
      expect(noReason.body.code).toBe('REASON_REQUIRED');

      const disabled = await bff(admin.page, `/operations/domains/${domainId}/force-disable`, {
        method: 'POST', body: { reason: REASON },
      });
      expect(disabled.status).toBe(200);
      expect(disabled.body.domain.status).toBe('disabled');

      // A force-disabled domain no longer resolves, and ownership was NOT handed to anyone.
      const afterDisable = await request.get(`${e2eState.origins.api}/api/catalog/products`, { headers: { 'X-Forwarded-Host': hostname } });
      expect(afterDisable.status()).not.toBe(200);
      const [stillOwned] = await dbQuery('select organization_id from custom_domains where id = $1', [domainId]);
      expect(stillOwned.organization_id).toBe(orgA);

      // The action is audited with its reason and a super-admin actor.
      const events = await dbQuery(
        "select event_type, actor_type, reason from custom_domain_events where hostname = $1 and event_type = 'force_disabled'",
        [hostname]
      );
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].actor_type).toBe('super_admin');
      expect(events[0].reason).toBe(REASON);

      // There is deliberately no force-verify: ownership can never be granted without DNS.
      const forceVerify = await bff(admin.page, `/operations/domains/${domainId}/force-verify`, {
        method: 'POST', body: { reason: REASON },
      });
      expect([404, 405]).toContain(forceVerify.status);
    } finally {
      await tenant.context.close();
      await admin.context.close();
      await restore();
    }
  });
});
