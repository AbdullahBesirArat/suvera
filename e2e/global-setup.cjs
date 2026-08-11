'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { createRequire } = require('node:module');
const { startDatabase } = require('./lib/database.cjs');
const { cleanup } = require('./lib/lifecycle.cjs');
const { runNpm, startNode, tailLog, waitForHttp } = require('./lib/processes.cjs');
const {
  API_DIR,
  PANELYA_DIR,
  PROJECT_ROOT,
  TEMP_DIR,
  WEB_DIR,
  getFreePorts,
  writeState,
} = require('./lib/state.cjs');

function randomSecret() {
  return crypto.randomBytes(64).toString('base64url');
}

module.exports = async function globalSetup() {
  let state = { services: {} };
  try {
    runNpm(['run', 'build'], { cwd: PROJECT_ROOT });
    const [apiPort, adminPort, storefrontPort] = await getFreePorts(3);
    const apiOrigin = `http://127.0.0.1:${apiPort}`;
    // WebAuthn RP IDs are domain names, not IP literals. localhost is the browser's
    // standards-defined secure-context exception and still resolves to this loopback-only
    // Next process.
    const adminOrigin = `http://localhost:${adminPort}`;
    const storefrontOrigin = `http://127.0.0.1:${storefrontPort}`;
    const database = await startDatabase();
    const paymentCallbackSecret = randomSecret();
    const metricsToken = randomSecret();
    // A29. Recorded in the run state so the suite can decrypt a stored signing secret and
    // prove it round-trips — the same superuser-level visibility the DB credentials already
    // give it. It is generated per run and never leaves the machine.
    const webhookEncryptionKey = crypto.randomBytes(32).toString('base64');
    const mfaEncryptionKey = crypto.randomBytes(32).toString('base64');
    state = {
      ...state,
      createdAt: new Date().toISOString(),
      ports: { api: apiPort, admin: adminPort, storefront: storefrontPort },
      origins: { api: apiOrigin, admin: adminOrigin, storefront: storefrontOrigin },
      database,
      credentials: database.credentials,
      fixtures: database.fixtures,
      smoke: { paymentCallbackSecret, metricsToken },
      integrations: { webhookEncryptionKey },
    };
    writeState(state);

    const apiEnv = {
      NODE_ENV: 'test',
      E2E_TEST_MODE: 'true',
      HOST: '127.0.0.1',
      PORT: String(apiPort),
      DATABASE_URL: database.urls.runtime,
      RUNTIME_DATABASE_URL: database.urls.runtime,
      SYSTEM_DATABASE_URL: database.urls.system,
      MIGRATION_DATABASE_URL: database.urls.migration,
      JWT_SECRET_APP: randomSecret(),
      JWT_SECRET_ADMIN: randomSecret(),
      ACCESS_TOKEN_EXPIRES_IN: '15m',
      REFRESH_TOKEN_EXPIRES_DAYS: '30',
      CORS_ORIGIN: `${adminOrigin},${storefrontOrigin},https://suvera.com.tr`,
      PUBLIC_SITE_URL: storefrontOrigin,
      PUBLIC_API_URL: apiOrigin,
      PAYMENT_PROVIDER: 'mock',
      PAYMENT_MOCK_AUTO_PAY: process.env.E2E_PAYMENT_MOCK_AUTO_PAY || 'true',
      PAYMENT_CALLBACK_SECRET_REQUIRED: 'true',
      PAYMENT_CALLBACK_SECRET: paymentCallbackSecret,
      METRICS_TOKEN: metricsToken,
      // A27: deterministic in-process DNS + test domain provider, so domain verification
      // never touches real internet DNS or a real provider API.
      DOMAIN_DNS_RESOLVER: 'static',
      DOMAIN_PROVIDER: 'test',
      DOMAIN_VERIFY_RATE_LIMIT: '1000',
      API_RATE_LIMIT: '10000',
      LOGIN_RATE_LIMIT: '1000',
      REGISTER_RATE_LIMIT: '1000',
      // Every per-endpoint limiter is raised here, not just the few that have bitten
      // us so far. Production defaults are small and the whole suite shares one window
      // and one client IP, so a limiter left at its default eventually 429s a later
      // spec — which the storefront renders as a dropped session or a failed request,
      // failing tests that assert nothing about rate limiting. No spec asserts on
      // limiter behaviour, so raising these here removes execution-order flakiness
      // without weakening anything.
      CUSTOMER_AUTH_RATE_LIMIT: '1000',
      CUSTOMER_ADDRESS_RATE_LIMIT: '1000',
      ORDER_CLAIM_RATE_LIMIT: '1000',
      CART_RECOVERY_RATE_LIMIT: '1000',
      COMPARISON_RATE_LIMIT: '1000',
      COUPON_EVALUATE_RATE_LIMIT: '1000',
      NOTIFICATION_SUBSCRIBE_RATE_LIMIT: '1000',
      NOTIFICATION_TOKEN_RATE_LIMIT: '1000',
      RECENTLY_VIEWED_RATE_LIMIT: '1000',
      REVIEW_WRITE_RATE_LIMIT: '1000',
      REVIEW_VOTE_RATE_LIMIT: '1000',
      QUESTION_WRITE_RATE_LIMIT: '1000',
      WISHLIST_RATE_LIMIT: '1000',
      UPLOAD_RATE_LIMIT: '1000',
      PLATFORM_RATE_LIMIT: '1000',
      PLATFORM_WRITE_RATE_LIMIT: '1000',
      ORDER_CREATE_RATE_LIMIT: '1000',
      PAYMENT_INIT_RATE_LIMIT: '1000',
      ORDER_NOTIFICATION_OUTBOX_WORKER_ENABLED: 'false',
      // A29. The webhook worker is the thing under test, so it runs for real here; a
      // pipeline only ever driven by hand in tests is one nobody has proven end to end.
      WEBHOOK_WORKER_ENABLED: 'true',
      WEBHOOK_WORKER_INTERVAL_MS: '2000',
      WEBHOOK_SECRET_ENCRYPTION_KEY: webhookEncryptionKey,
      // The local receiver runs on loopback. This unlocks loopback ONLY, only in a test
      // process, and only because both conditions are set: every other private range stays
      // refused, so the SSRF policy under test is the production one.
      WEBHOOK_ALLOW_LOCAL_DELIVERY: 'true',
      WEBHOOK_FAILURE_THRESHOLD: '3',
      INTEGRATION_WRITE_RATE_LIMIT: '1000',
      EXTERNAL_API_RATE_LIMIT: '5000',
      // A30. Passkey ceremonies run against Chromium's CDP virtual authenticator. The
      // relying party is the exact host used by this disposable admin server; no wildcard
      // or request-derived origin is accepted by the API.
      MFA_SECRET_ENCRYPTION_KEY: mfaEncryptionKey,
      MFA_VERIFY_RATE_LIMIT: '1000',
      MFA_SETUP_RATE_LIMIT: '1000',
      WEBAUTHN_RP_ID: 'localhost',
      WEBAUTHN_RP_NAME: 'Panelya E2E',
      WEBAUTHN_EXPECTED_ORIGINS: adminOrigin,
      UPLOAD_DIR: path.join(TEMP_DIR, 'uploads'),
    };
    state.services.api = startNode('api', path.join(API_DIR, 'server.js'), [], { cwd: API_DIR, env: apiEnv });
    writeState(state);

    const webRequire = createRequire(path.join(WEB_DIR, 'package.json'));
    const nextBin = webRequire.resolve('next/dist/bin/next');
    state.services.admin = startNode('admin', nextBin, ['dev', '-H', '127.0.0.1', '-p', String(adminPort)], {
      cwd: WEB_DIR,
      env: {
        NODE_ENV: 'development',
        NEXT_PUBLIC_E2E_TEST_MODE: 'true',
        PANELYA_API_BASE_URL: `${apiOrigin}/api`,
        NEXT_PUBLIC_API_BASE_URL: `${apiOrigin}/api`,
        // A28 theme preview: the frame loads the real storefront, not a second renderer.
        NEXT_PUBLIC_STOREFRONT_URL: storefrontOrigin,
        // This budget applies to EVERY admin request in the suite, not just the one spec
        // that asserts on it. It was pinned at 250 ms so the timeout spec would fail fast,
        // but a bcrypt cost-12 comparison alone measures ~260 ms here: register, login and
        // step-up/verify all land at 300-350 ms and a product create at 70-145 ms, so the
        // budget sat below — or one scheduling hiccup away from — the real service time of
        // ordinary endpoints. That is what produced the "transient" 502s on unrelated
        // routes. 5 s keeps the timeout spec quick while leaving ~14x headroom over the
        // slowest measured endpoint. Production is unaffected: its default is 15 s.
        BFF_TIMEOUT_MS: '5000',
      },
    });
    state.services.storefront = startNode('storefront', path.join(PROJECT_ROOT, 'dev-server.js'), [], {
      cwd: PROJECT_ROOT,
      env: {
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: String(storefrontPort),
        UPSTREAM_API: `${apiOrigin}/api`,
        SUVERA_PUBLIC_ACCESS_TOKEN: database.publicAccessToken,
        SUVERA_ORGANIZATION_SLUG: 'suvera',
        SUVERA_SITE_ORIGIN: storefrontOrigin,
        // A28: the admin frames the storefront to preview a draft. The allowed framer is
        // named here, in server configuration — never taken from the request.
        THEME_PREVIEW_FRAME_ANCESTORS: adminOrigin,
        PROXY_TIMEOUT_MS: '1000',
      },
    });
    writeState(state);

    await Promise.all([
      waitForHttp(`${apiOrigin}/api/health`, {
        ready: async (response) => Boolean((await response.json()).ready),
      }),
      waitForHttp(`${adminOrigin}/login`, { timeoutMs: 180_000 }),
      // Compile A30's lazy admin surfaces outside Playwright's unchanged per-test timeout.
      waitForHttp(`${adminOrigin}/security`, { timeoutMs: 180_000 }),
      waitForHttp(`${adminOrigin}/integrations`, { timeoutMs: 180_000 }),
      waitForHttp(`${adminOrigin}/superadmin`, { timeoutMs: 180_000 }),
      waitForHttp(`${storefrontOrigin}/`, { timeoutMs: 60_000 }),
    ]);
  } catch (error) {
    for (const service of Object.values(state.services || {})) {
      const log = tailLog(service.logFile);
      if (log) process.stderr.write(`\n--- ${service.name} log ---\n${log}\n`);
    }
    cleanup(state);
    throw error;
  }
};
