'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const {
  bff, expect, loginAdmin, stepUpWithPassword, storageSnapshot, test,
} = require('../fixtures.cjs');
const { dbQuery } = require('../lib/db.cjs');
const { API_DIR } = require('../lib/state.cjs');

const apiRequire = createRequire(path.join(API_DIR, 'package.json'));
const { authenticator } = apiRequire('otplib');
const bcrypt = apiRequire('bcryptjs');

function codeOf(result) {
  return result.body?.code || result.body?.error?.code || null;
}

async function tenantSession(browser, state, tenant = 'tenantA') {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAdmin(page, state, { tenant });
  return { context, page };
}

async function currentSession(page) {
  const summary = await bff(page, '/security/summary');
  expect(summary.status).toBe(200);
  return summary.body.sessions.find((session) => session.is_current);
}

async function expireStepUp(page) {
  const session = await currentSession(page);
  await dbQuery(
    "update auth_sessions set step_up_verified_at = now() - interval '1 hour' where id = $1",
    [session.id]
  );
  return session.id;
}

async function addVirtualAuthenticator(context, page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

test.describe('A30 account security acceptance', () => {
  test('discoverable passkey options API creates an unbound no-store authentication challenge', async ({ request, e2eState }) => {
    const response = await request.post(`${e2eState.origins.api}/api/auth/passkey/options`, {
      data: {},
    });
    const body = await response.json();
    expect(response.status(), JSON.stringify(body)).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(body.challengeId).toBeTruthy();
    expect(body.options.challenge).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(body.options.rpId).toBe('localhost');
    expect(body.options.userVerification).toBe('required');
    expect(body.options.allowCredentials).toBeUndefined();

    const [challenge] = await dbQuery(
      `select purpose, actor_type, user_id, admin_id, session_id
         from webauthn_challenges where id = $1`,
      [body.challengeId]
    );
    expect(challenge).toEqual({
      purpose: 'authentication',
      actor_type: null,
      user_id: null,
      admin_id: null,
      session_id: null,
    });
  });

  test('sessions are owner-scoped; single revoke and revoke-others invalidate live access immediately', async ({ browser, e2eState }) => {
    const primary = await tenantSession(browser, e2eState);
    const secondary = await tenantSession(browser, e2eState);
    try {
      const first = await currentSession(primary.page);
      const second = await currentSession(secondary.page);
      expect(first.id).not.toBe(second.id);

      const revoked = await bff(primary.page, `/security/sessions/${second.id}/revoke`, {
        method: 'POST', body: {},
      });
      expect(revoked.status).toBe(200);
      expect((await bff(secondary.page, '/products?limit=1')).status).toBe(401);

      const third = await tenantSession(browser, e2eState);
      try {
        const otherId = (await currentSession(third.page)).id;
        const allOthers = await bff(primary.page, '/security/sessions/revoke-others', {
          method: 'POST', body: {},
        });
        expect(allOthers.status).toBe(200);
        expect(allOthers.body.revoked).toBeGreaterThanOrEqual(1);
        expect((await bff(primary.page, '/products?limit=1')).status).toBe(200);
        expect((await bff(third.page, '/products?limit=1')).status).toBe(401);
        const [row] = await dbQuery('select revoked_at from auth_sessions where id = $1', [otherId]);
        expect(row.revoked_at).not.toBeNull();
      } finally {
        await third.context.close();
      }
    } finally {
      await primary.context.close();
      await secondary.context.close();
    }
  });

  test('TOTP replay/concurrency, recovery one-time use, tenant policy and MFA disable are enforced', async ({ browser, e2eState }) => {
    const tenant = await tenantSession(browser, e2eState);
    const orgId = e2eState.fixtures.tenantA.organizationId;
    const email = e2eState.credentials.tenantA.email;
    let secret;
    try {
      await stepUpWithPassword(tenant.page, e2eState.credentials.tenantA.password);
      const setup = await bff(tenant.page, '/security/totp/setup', { method: 'POST', body: {} });
      expect(setup.status).toBe(200);
      secret = setup.body.secret;
      expect(setup.body.otpauthUri).toContain('otpauth://totp/');
      const [stored] = await dbQuery(
        `select encrypted_secret from user_mfa_methods
          where user_id = (select id from app_users where email = $1) and disabled_at is null`,
        [email]
      );
      expect(stored.encrypted_secret).not.toContain(secret);
      expect(stored.encrypted_secret).toMatch(/^v1:/);

      const token = authenticator.generate(secret);
      expect((await bff(tenant.page, '/security/totp/verify', {
        method: 'POST', body: { token },
      })).status).toBe(200);
      const replay = await bff(tenant.page, '/security/step-up/verify', {
        method: 'POST', body: { method: 'totp', token },
      });
      expect(replay.status).toBe(400);
      expect(codeOf(replay)).toBe('MFA_CODE_REPLAYED');

      await dbQuery(
        `update user_mfa_methods set last_used_step = null
          where user_id = (select id from app_users where email = $1) and enabled`, [email]
      );
      const race = await tenant.page.evaluate(async (raceToken) => Promise.all([0, 1].map(async () => {
        const response = await fetch('/api/bff/security/step-up/verify', {
          method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method: 'totp', token: raceToken }),
        });
        return { status: response.status, body: await response.json() };
      })), authenticator.generate(secret));
      expect(race.map((entry) => entry.status).sort()).toEqual([200, 400]);
      expect(race.find((entry) => entry.status === 400).body.code).toBe('MFA_CODE_REPLAYED');

      const firstGeneration = await bff(tenant.page, '/security/recovery-codes/regenerate', {
        method: 'POST', body: {},
      });
      expect(firstGeneration.status).toBe(200);
      expect(firstGeneration.body.codes.length).toBeGreaterThanOrEqual(8);
      const oldCodes = firstGeneration.body.codes;
      const hashes = await dbQuery(
        `select code_hash from mfa_recovery_codes
          where user_id = (select id from app_users where email = $1)`, [email]
      );
      for (const raw of oldCodes) expect(JSON.stringify(hashes)).not.toContain(raw.replace('-', ''));

      await expireStepUp(tenant.page);
      const used = await bff(tenant.page, '/security/step-up/verify', {
        method: 'POST', body: { method: 'recovery_code', code: oldCodes[0] },
      });
      expect(used.status).toBe(200);
      const usedAgain = await bff(tenant.page, '/security/step-up/verify', {
        method: 'POST', body: { method: 'recovery_code', code: oldCodes[0] },
      });
      expect(usedAgain.status).toBe(400);

      const secondGeneration = await bff(tenant.page, '/security/recovery-codes/regenerate', {
        method: 'POST', body: {},
      });
      expect(secondGeneration.status).toBe(200);
      await expireStepUp(tenant.page);
      expect((await bff(tenant.page, '/security/step-up/verify', {
        method: 'POST', body: { method: 'recovery_code', code: oldCodes[1] },
      })).status).toBe(400);
      expect((await bff(tenant.page, '/security/step-up/verify', {
        method: 'POST', body: { method: 'recovery_code', code: secondGeneration.body.codes[0] },
      })).status).toBe(200);

      const policy = await bff(tenant.page, '/security/policy', {
        method: 'PUT', body: { require_mfa_for_owner: true, require_mfa_for_admin: false },
      });
      expect(policy.status).toBe(200);
      const challenged = await tenantSession(browser, e2eState);
      try {
        const blocked = await bff(challenged.page, '/products?limit=1');
        expect(blocked.status).toBe(403);
        expect(codeOf(blocked)).toBe('MFA_REQUIRED');
      } finally {
        await challenged.context.close();
      }

      await expireStepUp(tenant.page);
      const beforeDisable = await dbQuery(
        `select disabled_at from user_mfa_methods
          where user_id = (select id from app_users where email = $1) and enabled`, [email]
      );
      const deniedDisable = await bff(tenant.page, '/security/totp/disable', { method: 'POST', body: {} });
      expect(deniedDisable.status).toBe(403);
      expect(beforeDisable[0].disabled_at).toBeNull();
      expect((await dbQuery(
        `select disabled_at from user_mfa_methods
          where user_id = (select id from app_users where email = $1) and enabled`, [email]
      ))[0].disabled_at).toBeNull();

      expect((await bff(tenant.page, '/security/step-up/verify', {
        method: 'POST', body: { method: 'recovery_code', code: secondGeneration.body.codes[1] },
      })).status).toBe(200);
      expect((await bff(tenant.page, '/security/policy', {
        method: 'PUT', body: { require_mfa_for_owner: false, require_mfa_for_admin: false },
      })).status).toBe(200);
      expect((await bff(tenant.page, '/security/totp/disable', { method: 'POST', body: {} })).status).toBe(200);

      await tenant.page.reload();
      expect(JSON.stringify(await storageSnapshot(tenant.page))).not.toContain(secret);

      const customer = await browser.newContext();
      const customerPage = await customer.newPage();
      try {
        await customerPage.goto(`${e2eState.origins.storefront}/giris`);
        await customerPage.locator('#emailInput').fill(e2eState.credentials.customerA.email);
        await customerPage.locator('#pwInput').fill(e2eState.credentials.customerA.password);
        await customerPage.locator('#loginSubmit').click();
        await customerPage.waitForURL(/\/hesabim/, { timeout: 20_000 });
        await expect(customerPage.locator('body')).toContainText(e2eState.credentials.customerA.email);
      } finally {
        await customer.close();
      }
    } finally {
      await dbQuery('delete from organization_security_policies where organization_id = $1', [orgId]);
      await tenant.context.close();
    }
  });

  test('Chromium CDP performs real resident-key WebAuthn registration, step-up and discoverable login', async ({ browser, e2eState }) => {
    const tenant = await tenantSession(browser, e2eState);
    const { cdp, authenticatorId } = await addVirtualAuthenticator(tenant.context, tenant.page);
    const email = e2eState.credentials.tenantA.email;
    let credentialId;
    try {
      await stepUpWithPassword(tenant.page, e2eState.credentials.tenantA.password);
      await tenant.page.goto(`${e2eState.origins.admin}/security`);
      await expect(tenant.page.getByText("Passkey'ler")).toBeVisible();

      let expiredPayload;
      await tenant.page.route('**/api/bff/security/passkeys/register', async (route) => {
        expiredPayload = route.request().postDataJSON();
        await dbQuery(
          "update webauthn_challenges set expires_at = created_at + interval '1 millisecond' where id = $1",
          [expiredPayload.challengeId]
        );
        await route.continue();
      });
      await tenant.page.locator('#passkey-name').fill('Expired ceremony');
      const expiredResponsePromise = tenant.page.waitForResponse(
        (response) => response.url().includes('/security/passkeys/register')
      );
      await tenant.page.getByRole('button', { name: 'Passkey ekle' }).click();
      expect((await expiredResponsePromise).status()).toBe(400);
      expect(expiredPayload.response).toBeTruthy();
      await tenant.page.unroute('**/api/bff/security/passkeys/register');

      let registrationPayload;
      tenant.page.on('request', (request) => {
        if (request.url().includes('/security/passkeys/register') && request.method() === 'POST') {
          registrationPayload = request.postDataJSON();
        }
      });
      const optionsPromise = tenant.page.waitForResponse(
        (response) => response.url().includes('/security/passkeys/registration-options')
      );
      const registeredPromise = tenant.page.waitForResponse(
        (response) => response.url().includes('/security/passkeys/register') && response.status() === 201
      );
      await tenant.page.locator('#passkey-name').fill('CDP resident key');
      await tenant.page.getByRole('button', { name: 'Passkey ekle' }).click();
      const registrationOptions = await (await optionsPromise).json();
      expect(registrationOptions.options.rp.id).toBe('localhost');
      expect(registrationOptions.options.authenticatorSelection.residentKey).toBe('required');
      expect(registrationOptions.options.authenticatorSelection.userVerification).toBe('required');
      expect((await registeredPromise).status()).toBe(201);
      expect(registrationPayload.response).toBeTruthy();
      const clientData = JSON.parse(Buffer.from(
        registrationPayload.response.response.clientDataJSON, 'base64url'
      ).toString('utf8'));
      expect(clientData.origin).toBe(e2eState.origins.admin);
      expect(clientData.challenge).toBe(registrationOptions.options.challenge);

      credentialId = registrationPayload.response.id;
      const [stored] = await dbQuery(
        `select id, credential_id, counter, public_key, last_used_at from webauthn_credentials
          where user_id = (select id from app_users where email = $1) and credential_id = $2`,
        [email, credentialId]
      );
      expect(stored.credential_id).toBe(credentialId);
      expect(stored.public_key).toBeTruthy();
      const replay = await bff(tenant.page, '/security/passkeys/register', {
        method: 'POST', body: registrationPayload,
      });
      expect(replay.status).toBe(400);
      expect(codeOf(replay)).toBe('WEBAUTHN_CHALLENGE_INVALID');

      const foreign = await tenantSession(browser, e2eState, 'tenantB');
      try {
        await stepUpWithPassword(foreign.page, e2eState.credentials.tenantB.password);
        const isolated = await bff(foreign.page, '/security/step-up/webauthn/options', {
          method: 'POST', body: {},
        });
        expect(isolated.status).toBe(404);
        expect(codeOf(isolated)).toBe('WEBAUTHN_NO_CREDENTIAL');
      } finally {
        await foreign.context.close();
      }

      await expireStepUp(tenant.page);
      const deniedCount = (await dbQuery(
        'select count(*)::int as n from api_keys where organization_id = $1',
        [e2eState.fixtures.tenantA.organizationId]
      ))[0].n;
      const denied = await bff(tenant.page, '/integrations/api-keys', {
        method: 'POST', body: { name: 'A30 denied', scopes: ['products:read'] },
      });
      expect(denied.status).toBe(403);
      expect(codeOf(denied)).toBe('STEP_UP_REQUIRED');
      expect((await dbQuery(
        'select count(*)::int as n from api_keys where organization_id = $1',
        [e2eState.fixtures.tenantA.organizationId]
      ))[0].n).toBe(deniedCount);

      await tenant.page.goto(`${e2eState.origins.admin}/integrations`);
      await tenant.page.locator('#api-key-name').fill('A30 passkey key');
      await tenant.page.getByLabel('Ürünleri oku').check();
      await tenant.page.getByTestId('api-key-create').click();
      await expect(tenant.page.getByRole('heading', { name: 'Kimliğinizi yeniden doğrulayın' })).toBeVisible();
      const beforeCounter = Number(stored.counter);
      const stepUpVerify = tenant.page.waitForResponse(
        (response) => response.url().includes('/security/step-up/webauthn/verify')
      );
      await tenant.page.getByRole('button', { name: 'Passkey kullan' }).click();
      expect((await stepUpVerify).status()).toBe(200);
      await expect(tenant.page.getByTestId('integration-secret-value')).toBeVisible();
      const [afterStepUp] = await dbQuery(
        'select counter, last_used_at from webauthn_credentials where credential_id = $1', [credentialId]
      );
      expect(Number(afterStepUp.counter)).toBeGreaterThanOrEqual(beforeCounter);
      expect(afterStepUp.last_used_at).not.toBeNull();
      const virtualCredentials = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
      const virtualCredential = virtualCredentials.credentials.find(
        (item) => Buffer.from(item.credentialId, 'base64').toString('base64url') === credentialId
      );
      expect(virtualCredential).toBeTruthy();
      expect(virtualCredential.rpId).toBe('localhost');
      expect(virtualCredential.isResidentCredential).toBe(true);
      expect(Number(afterStepUp.counter)).toBe(Number(virtualCredential.signCount));

      await bff(tenant.page, '/auth/session/logout', { method: 'POST', body: {} });
      await tenant.page.goto(`${e2eState.origins.admin}/login`);
      await tenant.page.waitForLoadState('networkidle');

      let authPayload;
      tenant.page.on('request', (request) => {
        if (request.url().includes('/auth/passkey/verify')) authPayload = request.postDataJSON();
      });
      const authOptionsPromise = tenant.page.waitForResponse(
        (response) => response.url().includes('/auth/passkey/options')
      );
      const authVerifyPromise = tenant.page.waitForResponse(
        (response) => response.url().includes('/auth/passkey/verify') && response.status() === 200
      );
      await tenant.page.getByTestId('passkey-login').click();
      const authOptionsResponse = await authOptionsPromise;
      const authOptions = await authOptionsResponse.json();
      expect(authOptionsResponse.status(), JSON.stringify(authOptions)).toBe(200);
      expect(authOptions.options.rpId).toBe('localhost');
      expect(authOptions.options.userVerification).toBe('required');
      expect(authOptions.options.allowCredentials || []).toEqual([]);
      await authVerifyPromise;
      await tenant.page.waitForURL(/\/dashboard/);
      const authReplay = await bff(tenant.page, '/auth/passkey/verify', {
        method: 'POST', body: authPayload,
      });
      expect(authReplay.status).toBe(400);
      expect(codeOf(authReplay)).toBe('WEBAUTHN_CHALLENGE_INVALID');

      await bff(tenant.page, '/auth/session/logout', { method: 'POST', body: {} });
      await dbQuery('update webauthn_credentials set revoked_at = now() where credential_id = $1', [credentialId]);
      await tenant.page.goto(`${e2eState.origins.admin}/login`);
      await tenant.page.waitForLoadState('networkidle');
      const revokedVerify = tenant.page.waitForResponse(
        (response) => response.url().includes('/auth/passkey/verify')
      );
      await tenant.page.getByTestId('passkey-login').click();
      expect((await revokedVerify).status()).toBe(404);
    } finally {
      await dbQuery(
        `delete from webauthn_credentials
          where user_id = (select id from app_users where email = $1)`, [email]
      );
      await tenant.context.close();
    }
  });

  test('billing, domain release and refund routes deny before mutation and succeed after central step-up', async ({ browser, e2eState }) => {
    const tenant = await tenantSession(browser, e2eState);
    const orgId = e2eState.fixtures.tenantA.organizationId;
    const reason = 'A30 acceptance proof';
    let domainId;
    let returnId;
    let orderBefore;
    try {
      const [version] = await dbQuery("select id from plan_versions where plan_name = 'starter' and version = 1");
      await dbQuery('delete from subscriptions where organization_id = $1', [orgId]);
      await dbQuery(
        `insert into subscriptions
          (organization_id, provider, plan, plan_version_id, status, current_period_start, current_period_end, last_transition_at)
         values ($1,'manual','starter',$2,'active',now(),now() + interval '30 days',now())`,
        [orgId, version.id]
      );
      const deniedBilling = await bff(tenant.page, '/subscription/cancel', {
        method: 'POST', body: { reason },
      });
      expect(deniedBilling.status).toBe(403);
      expect((await dbQuery(
        'select cancel_at_period_end from subscriptions where organization_id = $1', [orgId]
      ))[0].cancel_at_period_end).toBe(false);
      await stepUpWithPassword(tenant.page, e2eState.credentials.tenantA.password);
      expect((await bff(tenant.page, '/subscription/cancel', {
        method: 'POST', body: { reason },
      })).status).toBe(200);

      const createdDomain = await bff(tenant.page, '/domains', {
        method: 'POST', body: { hostname: `a30-${Date.now()}.tenant-store.com` },
      });
      expect(createdDomain.status).toBe(201);
      domainId = createdDomain.body.domain.id;
      expect((await bff(tenant.page, `/domains/${domainId}/disable`, {
        method: 'POST', body: { reason },
      })).status).toBe(200);
      await expireStepUp(tenant.page);
      const deniedRelease = await bff(tenant.page, `/domains/${domainId}`, {
        method: 'DELETE', body: { reason },
      });
      expect(deniedRelease.status).toBe(403);
      expect((await dbQuery('select status from custom_domains where id = $1', [domainId]))[0].status).toBe('disabled');
      await stepUpWithPassword(tenant.page, e2eState.credentials.tenantA.password);
      expect((await bff(tenant.page, `/domains/${domainId}`, {
        method: 'DELETE', body: { reason },
      })).status).toBe(200);

      const [orderItem] = await dbQuery(
        'select id from order_items where organization_id = $1 and order_id = $2 order by id limit 1',
        [orgId, e2eState.fixtures.tenantA.orderId]
      );
      [orderBefore] = await dbQuery(
        'select payment_status, order_status, refunded_total from orders where organization_id = $1 and id = $2',
        [orgId, e2eState.fixtures.tenantA.orderId]
      );
      const [returnRow] = await dbQuery(
        `insert into return_requests
          (organization_id, order_id, customer_account_id, request_type, status, reason_code, approved_at)
         values ($1,$2,$3,'return','approved','a30_acceptance',now()) returning id`,
        [orgId, e2eState.fixtures.tenantA.orderId, e2eState.fixtures.tenantA.customerId]
      );
      returnId = returnRow.id;
      await dbQuery(
        `insert into return_items
          (organization_id, return_request_id, order_item_id, quantity, reason_code, requested_resolution)
         values ($1,$2,$3,1,'a30_acceptance','refund')`, [orgId, returnId, orderItem.id]
      );
      await expireStepUp(tenant.page);
      const refundBody = {
        idempotency_key: `a30-refund-${Date.now()}`, provider: 'manual', refund_shipping: false,
        reason, items: [{ order_item_id: Number(orderItem.id), quantity: 1 }],
      };
      const deniedRefund = await bff(tenant.page, `/returns/${returnId}/refunds`, {
        method: 'POST', body: refundBody,
      });
      expect(deniedRefund.status).toBe(403);
      expect((await dbQuery('select count(*)::int as n from refunds where return_request_id = $1', [returnId]))[0].n).toBe(0);
      await stepUpWithPassword(tenant.page, e2eState.credentials.tenantA.password);
      expect((await bff(tenant.page, `/returns/${returnId}/refunds`, {
        method: 'POST', body: refundBody,
      })).status).toBe(201);
      expect((await dbQuery('select count(*)::int as n from refunds where return_request_id = $1', [returnId]))[0].n).toBe(1);
    } finally {
      // Return/refund audit rows are intentionally append-only. The entire database is a
      // project-scoped disposable container and is removed by global teardown, so do not
      // bypass that production invariant merely to delete a test row early.
      if (orderBefore) {
        await dbQuery(
          `update orders set payment_status = $3, order_status = $4, refunded_total = $5
            where organization_id = $1 and id = $2`,
          [orgId, e2eState.fixtures.tenantA.orderId, orderBefore.payment_status,
            orderBefore.order_status, orderBefore.refunded_total]
        );
      }
      if (domainId) await dbQuery('delete from custom_domains where id = $1', [domainId]);
      await dbQuery('delete from subscriptions where organization_id = $1', [orgId]);
      await tenant.context.close();
    }
  });

  test('a fresh super-admin is enrollment-gated and impersonation has no denied side effect', async ({ browser, e2eState }) => {
    const username = `a30-super-${Date.now()}@example.test`;
    const password = `A30-${Date.now()}-Strong!`;
    const hash = await bcrypt.hash(password, 4);
    const [admin] = await dbQuery(
      "insert into admins (username,password_hash,role) values ($1,$2,'super_admin') returning id",
      [username, hash]
    );
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`${e2eState.origins.admin}/login`);
      await page.waitForLoadState('networkidle');
      await page.getByTestId('login-role-admin').click();
      await page.getByTestId('login-email').fill(username);
      await page.getByTestId('login-password').fill(password);
      const loginResponsePromise = page.waitForResponse(
        (response) => response.url().includes('/api/bff/auth/admin/session/login')
      );
      await page.getByTestId('login-submit').click();
      expect((await loginResponsePromise).status()).toBe(200);
      await page.waitForURL(/\/security/);
      const summary = await bff(page, '/security/summary');
      expect(summary.body.assurance).toMatchObject({ mfaRequired: true, enrollmentRequired: true });

      const countBefore = (await dbQuery(
        'select count(*)::int as n from platform_impersonation_logs where super_admin_id = $1', [admin.id]
      ))[0].n;
      const denied = await bff(page, `/platform/stores/${e2eState.fixtures.tenantA.organizationId}/impersonate`, {
        method: 'POST', body: { reason: 'A30 denied bootstrap' },
      });
      expect(denied.status).toBe(403);
      expect(codeOf(denied)).toBe('MFA_ENROLLMENT_REQUIRED');
      expect((await dbQuery(
        'select count(*)::int as n from platform_impersonation_logs where super_admin_id = $1', [admin.id]
      ))[0].n).toBe(countBefore);

      await stepUpWithPassword(page, password);
      const setup = await bff(page, '/security/totp/setup', { method: 'POST', body: {} });
      expect(setup.status).toBe(200);
      expect((await bff(page, '/security/totp/verify', {
        method: 'POST', body: { token: authenticator.generate(setup.body.secret) },
      })).status).toBe(200);
      const afterEnrollment = await bff(page, '/security/summary');
      expect(afterEnrollment.body.assurance.enrollmentRequired).toBe(false);
      expect(['mfa', 'step_up']).toContain(afterEnrollment.body.assurance.level);
      expect((await bff(page, '/platform/overview')).status).toBe(200);
    } finally {
      await dbQuery('delete from platform_impersonation_logs where super_admin_id = $1', [admin.id]);
      await dbQuery('delete from admins where id = $1', [admin.id]);
    }
  });

  test('final database gate has A30 migrations, constraints, indexes and no raw credential columns', async () => {
    const migrations = await dbQuery(
      "select filename from schema_migrations where filename like '06%auth%' or filename like '070%' order by filename"
    );
    expect(migrations.map((row) => row.filename)).toEqual([
      '068_auth_sessions_mfa.sql',
      '069_auth_session_backfill.sql',
      '070_auth_session_challenge_invariants.sql',
    ]);
    const constraints = await dbQuery(
      `select conname from pg_constraint
        where conname in ('auth_sessions_actor_owner','auth_sessions_mfa_consistent','webauthn_challenges_binding')`
    );
    expect(constraints.map((row) => row.conname).sort()).toEqual([
      'auth_sessions_actor_owner', 'auth_sessions_mfa_consistent', 'webauthn_challenges_binding',
    ]);
    const indexes = await dbQuery(
      `select indexname from pg_indexes where indexname in
        ('idx_auth_sessions_family','idx_webauthn_credential_id','idx_mfa_recovery_hash')`
    );
    expect(indexes.map((row) => row.indexname).sort()).toEqual([
      'idx_auth_sessions_family', 'idx_mfa_recovery_hash', 'idx_webauthn_credential_id',
    ]);
    const columns = await dbQuery(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public'
          and table_name in ('user_mfa_methods','mfa_recovery_codes','webauthn_credentials')`
    );
    const names = columns.map((row) => `${row.table_name}.${row.column_name}`);
    expect(names).not.toContain('user_mfa_methods.secret');
    expect(names).not.toContain('mfa_recovery_codes.code');
    expect(names).not.toContain('webauthn_credentials.private_key');

    const migrationDir = path.join(API_DIR, 'db', 'migrations');
    expect(fs.existsSync(path.join(migrationDir, '070_auth_session_challenge_invariants.sql'))).toBe(true);
  });
});
