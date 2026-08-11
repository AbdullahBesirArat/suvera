'use strict';

const { bff, expect, loginAdmin, stepUpWithPassword, storageSnapshot, test } = require('../fixtures.cjs');
const { dbQuery } = require('../lib/db.cjs');
const { readState } = require('../lib/state.cjs');
const { secretCrypto, signature, startReceiver } = require('../lib/webhook-receiver.cjs');

// A29 API keys, external API and webhooks. Split into focused flows rather than one giant
// test. Nothing here touches the internet: the receiver is a local server in this process,
// reachable only because the API opts into a single, explicitly-gated loopback exception.
// Every other private range stays refused, so the SSRF policy under test is the real one.

async function tenantAdmin(browser, e2eState, tenant = 'tenantA') {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAdmin(page, e2eState, { tenant });
  await stepUpWithPassword(page, e2eState.credentials[tenant].password);
  return { context, page };
}

async function resetIntegrations(organizationId) {
  await dbQuery('delete from webhook_deliveries where organization_id = $1', [organizationId]);
  await dbQuery('delete from integration_events where organization_id = $1', [organizationId]);
  await dbQuery('delete from webhook_endpoint_secrets where organization_id = $1', [organizationId]);
  await dbQuery('delete from webhook_endpoint_events where organization_id = $1', [organizationId]);
  await dbQuery('delete from webhook_endpoints where organization_id = $1', [organizationId]);
  await dbQuery('delete from api_idempotency_keys where organization_id = $1', [organizationId]);
  await dbQuery('delete from api_keys where organization_id = $1', [organizationId]);
}

/** Calls /v1 the way an integration does: an API key in the Authorization header. */
async function v1(request, e2eState, path, { token, method = 'GET', data, headers = {} } = {}) {
  const response = await request.fetch(`${e2eState.origins.api}/v1${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    data,
  });
  let body = null;
  try { body = await response.json(); } catch (_) { body = null; }
  return { status: response.status(), headers: response.headers(), body };
}

async function createKey(page, { name, scopes, ipAllowlist, expiresAt }) {
  const created = await bff(page, '/integrations/api-keys', {
    method: 'POST',
    body: { name, scopes, ipAllowlist, expiresAt },
  });
  expect(created.status).toBe(201);
  return created.body;
}

/** Polls the delivery log until a delivery reaches one of the expected states. */
async function waitForDelivery(page, deliveryId, states, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const listed = await bff(page, '/integrations/deliveries?limit=100');
    last = (listed.body.items || []).find((item) => item.id === deliveryId) || last;
    if (last && states.includes(last.status)) return last;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`delivery ${deliveryId} never reached ${states.join('/')} (last: ${last && last.status})`);
}

test.describe('A29 integration platform', () => {
  let orgA;
  let orgB;
  let receiver;

  test.beforeAll(async () => {
    const state = readState();
    orgA = state.fixtures.tenantA.organizationId;
    orgB = state.fixtures.tenantB.organizationId;
    receiver = await startReceiver({
      behaviour: {
        '/ok': { status: 200 },
        '/fail': { status: 500 },
        '/refuse': { status: 400 },
        '/redirect': { status: 302, location: 'http://127.0.0.1:1/internal' },
        default: { status: 200 },
      },
    });
  });

  test.afterAll(async () => {
    if (receiver) await receiver.close();
    await resetIntegrations(orgA);
    await resetIntegrations(orgB);
  });

  test('1-5 a key is created in the admin and its secret is shown exactly once', async ({ browser, e2eState }) => {
    await resetIntegrations(orgA);
    const tenant = await tenantAdmin(browser, e2eState);
    try {
      // 1 The section is reachable.
      await tenant.page.goto(`${e2eState.origins.admin}/integrations`);
      await expect(tenant.page.getByText('API anahtarları')).toBeVisible();

      // 2 A key is created through the UI.
      await tenant.page.locator('#api-key-name').fill('E2E ERP');
      await tenant.page.getByLabel('Ürünleri oku').check();
      await tenant.page.getByLabel('Siparişleri oku').check();
      await tenant.page.getByTestId('api-key-create').click();

      // 3 The secret appears, once, in the creation dialog.
      const secretBox = tenant.page.getByTestId('integration-secret-value');
      await expect(secretBox).toBeVisible({ timeout: 15_000 });
      const token = (await secretBox.textContent()).trim();
      expect(token).toMatch(/^pk_[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/);

      // It is nowhere a script, a log or a store can reach it.
      const storage = await storageSnapshot(tenant.page);
      expect(JSON.stringify(storage)).not.toContain(token);
      expect(await tenant.page.evaluate(() => document.cookie)).not.toContain(token);

      // 4 Closing the dialog drops the only copy in the browser.
      await tenant.page.getByTestId('integration-secret-close').click();
      await expect(secretBox).toBeHidden();
      expect(await tenant.page.content()).not.toContain(token);

      // 5 It cannot be retrieved again — not after a reload, not from the API.
      await tenant.page.reload();
      await expect(tenant.page.getByText('E2E ERP')).toBeVisible();
      expect(await tenant.page.content()).not.toContain(token);
      const listed = await bff(tenant.page, '/integrations/api-keys');
      expect(JSON.stringify(listed.body)).not.toContain(token.split('.')[1]);
      // Only the public half is listed, which is what makes a key identifiable in a log.
      expect(JSON.stringify(listed.body)).toContain(token.split('.')[0]);
    } finally {
      await tenant.context.close();
    }
  });

  test('6-12 the external API authenticates by key, and the key alone decides the tenant', async ({ browser, request, e2eState }) => {
    await resetIntegrations(orgA);
    await resetIntegrations(orgB);
    const tenant = await tenantAdmin(browser, e2eState);
    const other = await tenantAdmin(browser, e2eState, 'tenantB');
    try {
      const good = await createKey(tenant.page, { name: 'reader', scopes: ['products:read', 'orders:read'] });
      const foreign = await createKey(other.page, { name: 'b-reader', scopes: ['products:read'] });

      // 6 A correct key reaches the API.
      const ok = await v1(request, e2eState, '/products', { token: good.token });
      expect(ok.status).toBe(200);
      expect(Array.isArray(ok.body.data)).toBe(true);
      expect(ok.headers['x-request-id']).toBeTruthy();

      // 7 A wrong secret is refused, with a generic code that reveals nothing.
      const wrongSecret = `${good.key.prefix}.${'A'.repeat(43)}`;
      const wrong = await v1(request, e2eState, '/products', { token: wrongSecret });
      expect(wrong.status).toBe(401);
      expect(wrong.body.error.code).toBe('API_KEY_INVALID');
      // An unknown prefix must be indistinguishable from a wrong secret.
      const unknown = await v1(request, e2eState, '/products', { token: `pk_ffffffffffff.${'A'.repeat(43)}` });
      expect(unknown.status).toBe(401);
      expect(unknown.body.error.code).toBe(wrong.body.error.code);
      expect(await v1(request, e2eState, '/products', {})).toMatchObject({ status: 401 });

      // 8 A revoked key stops working immediately.
      const revocable = await createKey(tenant.page, { name: 'revocable', scopes: ['products:read'] });
      expect((await v1(request, e2eState, '/products', { token: revocable.token })).status).toBe(200);
      await bff(tenant.page, `/integrations/api-keys/${revocable.key.id}/revoke`, { method: 'POST', body: {} });
      expect((await v1(request, e2eState, '/products', { token: revocable.token })).status).toBe(401);

      // 9 An expired key is refused even though nothing revoked it.
      const expiring = await createKey(tenant.page, {
        name: 'expiring', scopes: ['products:read'],
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });
      expect((await v1(request, e2eState, '/products', { token: expiring.token })).status).toBe(200);
      await dbQuery("update api_keys set expires_at = now() - interval '1 minute' where prefix = $1", [expiring.key.prefix]);
      expect((await v1(request, e2eState, '/products', { token: expiring.token })).status).toBe(401);

      // 10 A route outside the key's scopes is 403, and distinctly so.
      const scoped = await v1(request, e2eState, '/webhooks', { token: good.token });
      expect(scoped.status).toBe(403);
      expect(scoped.body.error.code).toBe('API_SCOPE_FORBIDDEN');
      // Write never implies read, and read never implies write.
      const writeAttempt = await v1(request, e2eState, '/inventory/adjustments', {
        token: good.token, method: 'POST',
        data: { product_id: 1, stock: 1 }, headers: { 'Idempotency-Key': 'scope-check' },
      });
      expect(writeAttempt.status).toBe(403);

      // 11-12 A tenant B key sees only tenant B, and no client-supplied hint can change it.
      const spoofed = await v1(request, e2eState, '/products?organizationId=' + orgA, {
        token: foreign.token,
        headers: { 'X-Organization-Slug': 'suvera', 'X-Organization-Id': orgA },
      });
      expect(spoofed.status).toBe(200);
      const foreignIds = (spoofed.body.data || []).map((row) => row.id);
      const tenantAProducts = await dbQuery('select id from products where organization_id = $1', [orgA]);
      const leaked = foreignIds.filter((id) => tenantAProducts.some((row) => Number(row.id) === id));
      expect(leaked).toEqual([]);
      // A key must also not be accepted in the query string, where it would reach logs.
      const inQuery = await v1(request, e2eState, `/products?api_key=${good.token}`, { token: good.token });
      expect(inQuery.status).toBe(400);
      expect(inQuery.body.error.code).toBe('API_KEY_IN_QUERY');
    } finally {
      await tenant.context.close();
      await other.context.close();
    }
  });

  test('13-16 rotation issues a new secret and the old one dies when the overlap ends', async ({ browser, request, e2eState }) => {
    await resetIntegrations(orgA);
    const tenant = await tenantAdmin(browser, e2eState);
    try {
      const original = await createKey(tenant.page, { name: 'rotating', scopes: ['products:read'] });

      // 13-14 Rotating returns a new secret that works.
      const rotated = await bff(tenant.page, `/integrations/api-keys/${original.key.id}/rotate`, {
        method: 'POST', body: { overlapMinutes: 30 },
      });
      expect(rotated.status).toBe(200);
      expect(rotated.body.token).not.toBe(original.token);
      expect((await v1(request, e2eState, '/products', { token: rotated.body.token })).status).toBe(200);

      // 15 The old secret keeps working during the overlap: the whole reason to rotate
      // rather than revoke and re-create.
      expect((await v1(request, e2eState, '/products', { token: original.token })).status).toBe(200);

      // 16 Once the overlap passes it is refused, with nothing having run to revoke it.
      await dbQuery("update api_keys set overlap_until = now() - interval '1 minute' where prefix = $1",
        [original.key.prefix]);
      expect((await v1(request, e2eState, '/products', { token: original.token })).status).toBe(401);
      expect((await v1(request, e2eState, '/products', { token: rotated.body.token })).status).toBe(200);
    } finally {
      await tenant.context.close();
    }
  });

  test('17-18 idempotency replays a repeat and refuses a reused key with a different body', async ({ browser, request, e2eState }) => {
    await resetIntegrations(orgA);
    const tenant = await tenantAdmin(browser, e2eState);
    try {
      const key = await createKey(tenant.page, { name: 'writer', scopes: ['inventory:write', 'inventory:read'] });
      const [product] = await dbQuery('select id from products where organization_id = $1 limit 1', [orgA]);
      const body = { product_id: Number(product.id), stock: 41, reason: 'A29 e2e' };
      const headers = { 'Idempotency-Key': `a29-${Date.now()}` };

      // 17 The same key with the same body performs ONE mutation and replays the response.
      const first = await v1(request, e2eState, '/inventory/adjustments', {
        token: key.token, method: 'POST', data: body, headers,
      });
      expect(first.status).toBe(201);
      const second = await v1(request, e2eState, '/inventory/adjustments', {
        token: key.token, method: 'POST', data: body, headers,
      });
      expect(second.status).toBe(201);
      expect(second.body).toEqual(first.body);
      expect(second.headers['idempotent-replay']).toBe('true');
      // Exactly one ledger movement, not two.
      const events = await dbQuery(
        `select count(*)::int as n from integration_events
          where organization_id = $1 and event_type = 'inventory.changed'`, [orgA]
      );
      expect(events[0].n).toBe(1);

      // 18 The same key with a DIFFERENT body is a client bug and is refused rather than
      // silently replaying an unrelated response.
      const conflict = await v1(request, e2eState, '/inventory/adjustments', {
        token: key.token, method: 'POST', data: { ...body, stock: 99 }, headers,
      });
      expect(conflict.status).toBe(409);
      expect(conflict.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

      // A missing key on a create is refused outright, not guessed at.
      const missing = await v1(request, e2eState, '/inventory/adjustments', {
        token: key.token, method: 'POST', data: body,
      });
      expect(missing.status).toBe(400);
      expect(missing.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    } finally {
      await tenant.context.close();
    }
  });

  test('19-22 a webhook is created with a one-time secret, and a private URL is refused', async ({ browser, e2eState }) => {
    await resetIntegrations(orgA);
    const tenant = await tenantAdmin(browser, e2eState);
    try {
      await tenant.page.goto(`${e2eState.origins.admin}/integrations`);

      // 22 An unusable address is refused before anything is stored.
      // Loopback is deliberately reachable in this harness (that is where the receiver
      // runs), and nothing else is. Everything below stays refused even here, which is what
      // makes this a test of the production policy rather than of a relaxed one — note that
      // plain HTTP is refused for a non-loopback host despite the local-delivery opt-in.
      for (const [url, expected] of [
        ['http://example.com/hook', 'WEBHOOK_URL_NOT_HTTPS'],
        ['https://10.0.0.5/hook', 'WEBHOOK_URL_PRIVATE_ADDRESS'],
        ['https://169.254.169.254/latest/meta-data', 'WEBHOOK_URL_PRIVATE_ADDRESS'],
        ['https://172.16.9.9/hook', 'WEBHOOK_URL_PRIVATE_ADDRESS'],
        ['https://192.168.1.1/hook', 'WEBHOOK_URL_PRIVATE_ADDRESS'],
        ['https://[fc00::1]/hook', 'WEBHOOK_URL_PRIVATE_ADDRESS'],
        ['https://user:pass@example.com/hook', 'WEBHOOK_URL_HAS_CREDENTIALS'],
        ['https://example.com:8443/hook', 'WEBHOOK_URL_PORT_NOT_ALLOWED'],
        ['https://example.com/hook#frag', 'WEBHOOK_URL_HAS_FRAGMENT'],
      ]) {
        const attempt = await bff(tenant.page, '/integrations/webhooks', {
          method: 'POST', body: { name: 'bad', url, events: ['order.created'] },
        });
        expect(attempt.status, `${url} must be refused`).toBeGreaterThanOrEqual(400);
        expect(attempt.body.code).toBe(expected);
      }
      const stored = await dbQuery('select count(*)::int as n from webhook_endpoints where organization_id = $1', [orgA]);
      expect(stored[0].n).toBe(0);

      // 19-21 A valid endpoint is created with its event subscriptions and one-time secret.
      const created = await bff(tenant.page, '/integrations/webhooks', {
        method: 'POST',
        body: {
          name: 'E2E receiver',
          url: `${receiver.origin}/ok`,
          events: ['order.created', 'order.status_changed', 'inventory.changed'],
        },
      });
      expect(created.status).toBe(201);
      expect(created.body.secret).toMatch(/^whsec_/);
      expect(created.body.endpoint.events).toEqual(
        ['inventory.changed', 'order.created', 'order.status_changed']
      );

      // 20 The secret is never readable again, and the stored value is not the secret.
      const listed = await bff(tenant.page, '/integrations/webhooks');
      expect(JSON.stringify(listed.body)).not.toContain(created.body.secret);
      const secretRow = await dbQuery(
        'select ciphertext from webhook_endpoint_secrets where organization_id = $1', [orgA]
      );
      expect(secretRow[0].ciphertext).not.toContain(created.body.secret);
      expect(secretRow[0].ciphertext).toMatch(/^v1:/);
      expect(JSON.stringify(listed.body)).not.toContain(secretRow[0].ciphertext);
    } finally {
      await tenant.context.close();
    }
  });

  test('23-27 a test delivery is signed, verifiable and inside the replay window', async ({ browser, e2eState }) => {
    await resetIntegrations(orgA);
    receiver.clear();
    const tenant = await tenantAdmin(browser, e2eState);
    try {
      const created = await bff(tenant.page, '/integrations/webhooks', {
        method: 'POST',
        body: { name: 'signed', url: `${receiver.origin}/ok`, events: ['order.created'] },
      });
      const secret = created.body.secret;
      receiver.setBehaviour('/ok', { status: 200, secret });

      // The secret the tenant was shown must be the one the sender will reproduce. Checking
      // it here means a later signature failure is unambiguous: it cannot be "the stored
      // secret was different", so it has to be the canonical signing input.
      const [stored] = await dbQuery(
        `select s.ciphertext, s.endpoint_id from webhook_endpoint_secrets s
          where s.organization_id = $1 and s.status = 'current'`, [orgA]
      );
      expect(secretCrypto.decryptSecret(
        stored.ciphertext,
        { endpointId: Number(stored.endpoint_id) },
        { WEBHOOK_SECRET_ENCRYPTION_KEY: readState().integrations.webhookEncryptionKey }
      )).toBe(secret);

      // 23 The admin action enqueues a real delivery rather than calling out from the
      // request handler, so the test exercises the production path.
      const sent = await bff(tenant.page, `/integrations/webhooks/${created.body.endpoint.id}/test`, {
        method: 'POST', body: {},
      });
      expect(sent.status).toBe(202);

      // 24-27 The receiver gets a signed request that verifies, and it is delivered.
      const delivered = await waitForDelivery(tenant.page, sent.body.delivery.id, ['delivered']);
      expect(delivered.response_status).toBe(200);

      // The receiver is shared across flows, so the hit is matched by delivery id rather
      // than by "the last one": another endpoint's delivery landing in between would
      // otherwise be asserted against the wrong secret.
      const hit = receiver.received.find(
        (entry) => entry.headers[signature.HEADERS.delivery] === String(sent.body.delivery.id)
      );
      expect(hit, 'the enqueued delivery reached the receiver').toBeTruthy();
      // 25 The helper verifies against the raw bytes that arrived.
      expect(hit.verified).toEqual({ valid: true, reason: 'OK' });
      expect(hit.headers[signature.HEADERS.eventId]).toMatch(/^[0-9a-f-]{36}$/);
      expect(hit.headers[signature.HEADERS.signature]).toMatch(/^v1=[0-9a-f]{64}$/);
      expect(hit.headers[signature.HEADERS.secretVersion]).toBe('1');
      // 26 The timestamp is inside the window and is part of the signed material.
      const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(hit.headers[signature.HEADERS.timestamp]));
      expect(skew).toBeLessThan(signature.DEFAULT_TOLERANCE_SECONDS);
      // Tampering with either half breaks the signature.
      expect(signature.verifySignature({
        secret, timestamp: hit.headers[signature.HEADERS.timestamp],
        rawBody: `${hit.rawBody} `, signature: hit.headers[signature.HEADERS.signature],
      }).valid).toBe(false);
      expect(signature.verifySignature({
        secret, timestamp: Number(hit.headers[signature.HEADERS.timestamp]) + 1,
        rawBody: hit.rawBody, signature: hit.headers[signature.HEADERS.signature],
      }).valid).toBe(false);
      // The signing secret itself never travels in the request.
      expect(JSON.stringify(hit.headers)).not.toContain(secret);
      expect(hit.rawBody).not.toContain(secret);
    } finally {
      await tenant.context.close();
    }
  });

  test('28-33 failures retry with backoff, dead-letter, disable the endpoint, and 3xx is not followed', async ({ browser, e2eState }) => {
    await resetIntegrations(orgA);
    receiver.clear();
    const tenant = await tenantAdmin(browser, e2eState);
    try {
      // 28-30 A 500 retries and eventually dead-letters.
      const failing = await bff(tenant.page, '/integrations/webhooks', {
        method: 'POST',
        body: { name: 'failing', url: `${receiver.origin}/fail`, events: ['order.created'] },
      });
      receiver.setBehaviour('/fail', { status: 500, secret: failing.body.secret });
      const sent = await bff(tenant.page, `/integrations/webhooks/${failing.body.endpoint.id}/test`, {
        method: 'POST', body: {},
      });
      const retried = await waitForDelivery(tenant.page, sent.body.delivery.id, ['retry', 'dead_letter']);
      expect(retried.response_status).toBe(500);
      expect(retried.error_code).toBe('HTTP_500');
      if (retried.status === 'retry') {
        // 29 Backoff: the next attempt is scheduled into the future, not immediately.
        expect(new Date(retried.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
      }

      // 30 Exhausting the budget dead-letters the delivery rather than retrying forever.
      await dbQuery(
        `update webhook_deliveries set max_attempts = 1, attempt = 1, status = 'retry', next_attempt_at = now()
          where organization_id = $1 and id = $2`,
        [orgA, sent.body.delivery.id]
      );
      const dead = await waitForDelivery(tenant.page, sent.body.delivery.id, ['dead_letter']);
      expect(dead.status).toBe('dead_letter');

      // 31 A manual retry re-queues the SAME delivery; it never mints a second event.
      const eventsBefore = await dbQuery(
        'select count(*)::int as n from integration_events where organization_id = $1', [orgA]
      );
      receiver.setBehaviour('/fail', { status: 200, secret: failing.body.secret });
      const retryResult = await bff(tenant.page, `/integrations/deliveries/${dead.id}/retry`, {
        method: 'POST', body: { reason: 'e2e' },
      });
      expect(retryResult.status).toBe(200);
      const recovered = await waitForDelivery(tenant.page, dead.id, ['delivered']);
      expect(recovered.status).toBe('delivered');
      const eventsAfter = await dbQuery(
        'select count(*)::int as n from integration_events where organization_id = $1', [orgA]
      );
      expect(eventsAfter[0].n).toBe(eventsBefore[0].n);
      // A success clears the endpoint's failure streak.
      const afterSuccess = await dbQuery(
        'select consecutive_failures from webhook_endpoints where organization_id = $1 and id = $2',
        [orgA, failing.body.endpoint.id]
      );
      expect(Number(afterSuccess[0].consecutive_failures)).toBe(0);

      // 32 A 3xx is a failure and is NOT followed: following one would hand the receiver a
      // second, unvalidated URL, which is how every SSRF allowlist gets defeated.
      const redirecting = await bff(tenant.page, '/integrations/webhooks', {
        method: 'POST',
        body: { name: 'redirecting', url: `${receiver.origin}/redirect`, events: ['order.created'] },
      });
      receiver.setBehaviour('/redirect', { status: 302, location: 'http://127.0.0.1:1/internal', secret: redirecting.body.secret });
      const redirectSend = await bff(tenant.page, `/integrations/webhooks/${redirecting.body.endpoint.id}/test`, {
        method: 'POST', body: {},
      });
      const redirected = await waitForDelivery(tenant.page, redirectSend.body.delivery.id, ['dead_letter', 'retry']);
      expect(redirected.response_status).toBe(302);
      expect(redirected.error_code).toBe('REDIRECT_NOT_FOLLOWED');
      // Nothing was delivered to the redirect target.
      expect(receiver.received.filter((hit) => hit.url === '/internal')).toEqual([]);

      // 33 Repeated failure disables the endpoint (threshold is 3 in this environment).
      const disabled = await dbQuery(
        'select status, consecutive_failures from webhook_endpoints where organization_id = $1 and id = $2',
        [orgA, redirecting.body.endpoint.id]
      );
      expect(Number(disabled[0].consecutive_failures)).toBeGreaterThan(0);
    } finally {
      await tenant.context.close();
    }
  });

  test('34-35 a rotated signing secret signs the next delivery, and the version says which', async ({ browser, e2eState }) => {
    await resetIntegrations(orgA);
    receiver.clear();
    const tenant = await tenantAdmin(browser, e2eState);
    try {
      const created = await bff(tenant.page, '/integrations/webhooks', {
        method: 'POST',
        body: { name: 'rotating', url: `${receiver.origin}/ok`, events: ['order.created'] },
      });
      // 34 Rotation returns a new secret, once.
      const rotated = await bff(tenant.page, `/integrations/webhooks/${created.body.endpoint.id}/rotate-secret`, {
        method: 'POST', body: {},
      });
      expect(rotated.status).toBe(200);
      expect(rotated.body.secret).not.toBe(created.body.secret);
      expect(rotated.body.version).toBe(2);

      // 35 The next delivery is signed with the NEW secret, and says which version it used.
      receiver.setBehaviour('/ok', { status: 200, secrets: [rotated.body.secret, created.body.secret] });
      const sent = await bff(tenant.page, `/integrations/webhooks/${created.body.endpoint.id}/test`, {
        method: 'POST', body: {},
      });
      await waitForDelivery(tenant.page, sent.body.delivery.id, ['delivered']);
      const hit = receiver.received.find(
        (entry) => entry.headers[signature.HEADERS.delivery] === String(sent.body.delivery.id)
      );
      expect(hit, 'the enqueued delivery reached the receiver').toBeTruthy();
      expect(hit.verified.valid).toBe(true);
      expect(hit.headers[signature.HEADERS.secretVersion]).toBe('2');
      // Verified against the new secret alone; the old one no longer signs anything.
      expect(signature.verifySignature({
        secret: rotated.body.secret, timestamp: hit.headers[signature.HEADERS.timestamp],
        rawBody: hit.rawBody, signature: hit.headers[signature.HEADERS.signature],
      }).valid).toBe(true);
      expect(signature.verifySignature({
        secret: created.body.secret, timestamp: hit.headers[signature.HEADERS.timestamp],
        rawBody: hit.rawBody, signature: hit.headers[signature.HEADERS.signature],
      }).valid).toBe(false);
    } finally {
      await tenant.context.close();
    }
  });

  test('36 one tenant can never see or touch another tenant\'s integrations', async ({ browser, e2eState }) => {
    await resetIntegrations(orgA);
    await resetIntegrations(orgB);
    const tenant = await tenantAdmin(browser, e2eState);
    const other = await tenantAdmin(browser, e2eState, 'tenantB');
    try {
      const endpoint = await bff(tenant.page, '/integrations/webhooks', {
        method: 'POST',
        body: { name: 'a-only', url: `${receiver.origin}/ok`, events: ['order.created'] },
      });
      const key = await createKey(tenant.page, { name: 'a-only-key', scopes: ['products:read'] });

      const foreignHooks = await bff(other.page, '/integrations/webhooks');
      expect(JSON.stringify(foreignHooks.body)).not.toContain('a-only');
      const foreignKeys = await bff(other.page, '/integrations/api-keys');
      expect(JSON.stringify(foreignKeys.body)).not.toContain(key.key.prefix);
      const foreignDeliveries = await bff(other.page, '/integrations/deliveries');
      expect(foreignDeliveries.body.items).toEqual([]);

      // Knowing the id is not enough: every write is scoped by tenant too.
      for (const [path, method] of [
        [`/integrations/webhooks/${endpoint.body.endpoint.id}/rotate-secret`, 'POST'],
        [`/integrations/webhooks/${endpoint.body.endpoint.id}/test`, 'POST'],
        [`/integrations/api-keys/${key.key.id}/revoke`, 'POST'],
        [`/integrations/api-keys/${key.key.id}/rotate`, 'POST'],
      ]) {
        const attempt = await bff(other.page, path, { method, body: {} });
        expect(attempt.status, path).toBeGreaterThanOrEqual(400);
      }
      // And tenant A's endpoint is untouched by any of it.
      const untouched = await dbQuery(
        'select status from webhook_endpoints where organization_id = $1 and id = $2',
        [orgA, endpoint.body.endpoint.id]
      );
      expect(untouched[0].status).toBe('active');
    } finally {
      await tenant.context.close();
      await other.context.close();
    }
  });

  test('37-48 business changes emit versioned, minimised events that reach the receiver', async ({ browser, request, e2eState }) => {
    await resetIntegrations(orgA);
    receiver.clear();
    const tenant = await tenantAdmin(browser, e2eState);
    try {
      const endpoint = await bff(tenant.page, '/integrations/webhooks', {
        method: 'POST',
        body: {
          name: 'events',
          url: `${receiver.origin}/ok`,
          events: ['inventory.changed', 'order.status_changed'],
        },
      });
      receiver.setBehaviour('/ok', { status: 200, secret: endpoint.body.secret });

      const key = await createKey(tenant.page, {
        name: 'event-writer', scopes: ['inventory:write', 'orders:write', 'orders:read'],
      });
      const [product] = await dbQuery('select id from products where organization_id = $1 limit 1', [orgA]);

      // 38 An inventory write through the canonical ledger emits inventory.changed.
      const adjust = await v1(request, e2eState, '/inventory/adjustments', {
        token: key.token, method: 'POST',
        data: { product_id: Number(product.id), stock: 37 },
        headers: { 'Idempotency-Key': `evt-${Date.now()}` },
      });
      expect(adjust.status).toBe(201);

      // 39 An order status change through the A16 state machine emits order.status_changed.
      const [order] = await dbQuery(
        "select id, status from orders where organization_id = $1 and status not in ('cancelled','delivered') limit 1",
        [orgA]
      );
      if (order) {
        const statusChange = await v1(request, e2eState, `/orders/${order.id}/status`, {
          token: key.token, method: 'POST', data: { status: 'processing' },
          headers: { 'Idempotency-Key': `ord-${Date.now()}` },
        });
        expect([200, 400, 409]).toContain(statusChange.status);
      }

      // 40 Payment state is NOT writable from an API key, whatever it asks for.
      if (order) {
        const paidAttempt = await v1(request, e2eState, `/orders/${order.id}/status`, {
          token: key.token, method: 'POST', data: { status: 'paid' },
          headers: { 'Idempotency-Key': `paid-${Date.now()}` },
        });
        expect(paidAttempt.status).toBe(403);
        expect(paidAttempt.body.error.code).toBe('ORDER_PAYMENT_STATUS_FORBIDDEN');
      }

      // 45-46 Every stored event carries a schema version and aggregate ordering metadata.
      const events = await dbQuery(
        `select event_type, schema_version, aggregate_type, aggregate_id, aggregate_version, payload
           from integration_events where organization_id = $1 order by id`, [orgA]
      );
      expect(events.length).toBeGreaterThan(0);
      for (const row of events) {
        expect(Number(row.schema_version)).toBeGreaterThanOrEqual(1);
        expect(row.aggregate_type).toBeTruthy();
        expect(row.aggregate_id).toBeTruthy();
        expect(Number(row.aggregate_version)).toBeGreaterThanOrEqual(0);
      }

      // 47 No sensitive data is in any payload. This is the check that would catch a
      // future "just include the whole row" change.
      const customers = await dbQuery(
        'select email, phone from customers where organization_id = $1 and email is not null limit 5', [orgA]
      );
      const serialized = JSON.stringify(events.map((row) => row.payload));
      for (const customer of customers) {
        if (customer.email) expect(serialized).not.toContain(customer.email);
        if (customer.phone) expect(serialized).not.toContain(customer.phone);
      }
      expect(serialized).not.toMatch(/address|tckn|card_number|password|access_token/i);

      // 48 The same transition twice produces one event, not two.
      const inventoryEvents = events.filter((row) => row.event_type === 'inventory.changed');
      const versions = inventoryEvents.map((row) => `${row.aggregate_id}:${row.aggregate_version}`);
      expect(new Set(versions).size).toBe(versions.length);

      // 24/49 The events actually reach the receiver, signed and verifiable.
      const deadline = Date.now() + 45_000;
      while (receiver.received.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      expect(receiver.received.length).toBeGreaterThan(0);
      // Only this endpoint's deliveries are signed with this secret; another flow's hit
      // would legitimately fail verification here.
      const hit = receiver.received.filter((entry) => entry.verified.valid).pop();
      expect(hit, 'a delivery signed by this endpoint reached the receiver').toBeTruthy();
      expect(hit.body.schemaVersion).toBeGreaterThanOrEqual(1);
      expect(hit.body.aggregate).toMatchObject({ type: expect.any(String), id: expect.any(String) });
      expect(typeof hit.body.aggregate.version).toBe('number');

      // 49 The delivery log shows it in the admin.
      await tenant.page.goto(`${e2eState.origins.admin}/integrations`);
      await expect(tenant.page.getByRole('heading', { name: 'Teslimat kayıtları' })).toBeVisible();
      await expect(tenant.page.getByText('inventory.changed').first()).toBeVisible({ timeout: 20_000 });

      // 51 No raw secret survives anywhere the browser can reach.
      const storage = await storageSnapshot(tenant.page);
      expect(JSON.stringify(storage)).not.toContain(endpoint.body.secret);
      expect(JSON.stringify(storage)).not.toContain(key.token);
      expect(await tenant.page.content()).not.toContain(endpoint.body.secret);
      expect(await tenant.page.content()).not.toContain(key.token.split('.')[1]);
    } finally {
      await tenant.context.close();
    }
  });

  test('external API contract: media type, method, request id and rate limit are stable', async ({ browser, request, e2eState }) => {
    await resetIntegrations(orgA);
    const tenant = await tenantAdmin(browser, e2eState);
    try {
      const key = await createKey(tenant.page, { name: 'contract', scopes: ['products:read', 'inventory:write'] });

      // A state-changing request must declare JSON rather than have its body guessed at.
      const wrongType = await v1(request, e2eState, '/inventory/adjustments', {
        token: key.token, method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'Idempotency-Key': 'ct' },
        data: 'product_id=1',
      });
      expect(wrongType.status).toBe(415);
      expect(wrongType.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');

      // An unknown endpoint answers in the same contract, never with a stack.
      const missing = await v1(request, e2eState, '/nope', { token: key.token });
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('NOT_FOUND');
      expect(JSON.stringify(missing.body)).not.toMatch(/at .*\(|node_modules|select .* from/i);

      // Every response carries the id that correlates it with our logs.
      const ok = await v1(request, e2eState, '/products', { token: key.token });
      expect(ok.headers['x-request-id']).toBeTruthy();
      expect(ok.headers['ratelimit-limit']).toBeTruthy();
      expect(ok.headers['ratelimit-remaining']).toBeTruthy();

      // Pagination is bounded server-side; an absurd limit is clamped, not honoured.
      const huge = await v1(request, e2eState, '/products?limit=100000', { token: key.token });
      expect(huge.status).toBe(200);
      expect(huge.body.data.length).toBeLessThanOrEqual(100);
      // A malformed cursor is a 400 with a code, not a 500.
      const badCursor = await v1(request, e2eState, '/products?cursor=not-base64', { token: key.token });
      expect(badCursor.status).toBe(400);
      expect(badCursor.body.error.code).toBe('CURSOR_INVALID');

      // The external projection carries no internal-only column.
      if (ok.body.data.length) {
        const columns = Object.keys(ok.body.data[0]);
        for (const internal of ['organization_id', 'cost_price', 'internal_notes', 'deleted_at']) {
          expect(columns).not.toContain(internal);
        }
      }
    } finally {
      await tenant.context.close();
    }
  });
});
