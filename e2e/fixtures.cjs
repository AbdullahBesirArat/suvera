'use strict';

const path = require('node:path');
const { createRequire } = require('node:module');
const { test: base, expect } = require('@playwright/test');
const { dbQuery } = require('./lib/db.cjs');
const { API_DIR, readState, writeState } = require('./lib/state.cjs');

const { authenticator } = createRequire(path.join(API_DIR, 'package.json'))('otplib');

const test = base.extend({
  e2eState: async ({}, use) => {
    await use(readState());
  },
});

async function loginAdmin(page, state, { superAdmin = false, tenant = 'tenantA' } = {}) {
  const credentials = superAdmin ? state.credentials.superAdmin : state.credentials[tenant];
  await page.goto(`${state.origins.admin}/login`);
  // Next dev serves the form HTML before hydration has necessarily attached handlers.
  // Waiting for the initial module traffic prevents a pre-hydration click from being
  // discarded (and the controlled inputs from being reset).
  await page.waitForLoadState('networkidle');
  await page.getByTestId(superAdmin ? 'login-role-admin' : 'login-role-store').click();
  await page.getByTestId('login-email').fill(superAdmin ? credentials.username : credentials.email);
  await page.getByTestId('login-password').fill(credentials.password);
  if (!superAdmin) await page.getByTestId('login-organization-slug').fill(credentials.slug);
  const loginPath = superAdmin ? '/api/bff/auth/admin/session/login' : '/api/bff/auth/session/login';
  const responsePromise = page.waitForResponse((response) => response.url().includes(loginPath));
  await page.getByTestId('login-submit').click();
  const response = await responsePromise;
  if (response.status() >= 400) {
    throw new Error(`Admin login failed (${response.status()}): ${await response.text()}`);
  }
  await page.waitForURL(superAdmin ? /\/(?:superadmin|security)/ : /\/dashboard/, { timeout: 30_000 });
}

async function stepUpWithPassword(page, password) {
  // Reading the current step-up state before proving a password is what the UI does, and
  // it asserts the route answers before the write. This is not a retry: the password proof
  // below is still submitted exactly once.
  const status = await bff(page, '/security/step-up/status');
  expect(status.status).toBe(200);
  const result = await bff(page, '/security/step-up/verify', {
    method: 'POST', body: { method: 'password', password },
  });
  expect(result.status).toBe(200);
  expect(result.body.method).toBe('password');
  return result.body;
}

async function ensureSuperAdminMfa(page, state) {
  let summary = await bff(page, '/security/summary');
  expect(summary.status).toBe(200);
  let secret = readState().security?.superAdminTotpSecret;
  if (!summary.body.assurance.hasFactor) {
    await stepUpWithPassword(page, state.credentials.superAdmin.password);
    const setup = await bff(page, '/security/totp/setup', { method: 'POST', body: {} });
    expect(setup.status).toBe(200);
    secret = setup.body.secret;
    const verified = await bff(page, '/security/totp/verify', {
      method: 'POST', body: { token: authenticator.generate(secret) },
    });
    expect(verified.status).toBe(200);
    const current = readState();
    current.security = { ...(current.security || {}), superAdminTotpSecret: secret };
    writeState(current);
  } else if (summary.body.assurance.level === 'password') {
    expect(secret, 'E2E super-admin TOTP seed must be available in disposable state').toBeTruthy();
    await dbQuery(
      `update user_mfa_methods set last_used_step = null
        where actor_type = 'admin'
          and admin_id = (select id from admins where username = $1)
          and enabled and disabled_at is null`,
      [state.credentials.superAdmin.username]
    );
    const verified = await bff(page, '/security/step-up/verify', {
      method: 'POST', body: { method: 'totp', token: authenticator.generate(secret) },
    });
    expect(verified.status).toBe(200);
  }
  await page.goto(`${state.origins.admin}/superadmin`);
  await page.waitForURL(/\/superadmin/, { timeout: 30_000 });
  summary = await bff(page, '/security/summary');
  expect(summary.body.assurance.mfaRequired).toBe(true);
  expect(['mfa', 'step_up']).toContain(summary.body.assurance.level);
}

async function bff(page, path, { method = 'GET', body, headers = {} } = {}) {
  return page.evaluate(async ({ pathValue, methodValue, bodyValue, headerValues }) => {
    const response = await fetch(`/api/bff${pathValue}`, {
      method: methodValue,
      headers: {
        ...(bodyValue === undefined ? {} : { 'content-type': 'application/json' }),
        ...headerValues,
      },
      body: bodyValue === undefined ? undefined : JSON.stringify(bodyValue),
      credentials: 'include',
    });
    const contentType = response.headers.get('content-type') || '';
    const responseBody = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text();
    return { status: response.status, body: responseBody };
  }, { pathValue: path, methodValue: method, bodyValue: body, headerValues: headers });
}

function cartItem(product, overrides = {}) {
  return {
    id: product.id || product.productId,
    product_id: product.id || product.productId,
    variant_id: product.variantId,
    name: product.name || product.productName,
    price: Number(product.price || product.productPrice),
    qty: 1,
    color: overrides.color || 'Siyah',
    size: overrides.size || 'S',
    variant: overrides.variant || 'Siyah / S',
    emoji: '🧣',
    ...overrides,
  };
}

async function setCart(page, state, product, overrides = {}) {
  await page.goto(state.origins.storefront);
  const item = cartItem(product, overrides);
  // Seed the canonical server cart through the real API (guest cart + HttpOnly
  // cookie set by the proxy); localStorage is only a mirror hydrated on next load.
  await page.waitForFunction(() => window.SuveraAPI && window.SuveraAPI.cart);
  const result = await page.evaluate(async (it) => {
    const response = await window.SuveraAPI.cart.addItem({
      product_id: it.product_id, variant_id: it.variant_id, quantity: it.qty,
    });
    return response && response.cart ? { ok: true, count: response.cart.item_count } : { ok: false };
  }, item);
  if (!result || !result.ok) throw new Error('setCart: server cart seeding failed');
  return item;
}

async function fillCheckout(page, { email = 'checkout@example.test' } = {}) {
  const acceptConsent = page.locator('[data-consent-action="accept-all"]');
  if (await acceptConsent.isVisible()) await acceptConsent.click();
  await page.locator('#customerEmail').fill(email);
  await page.locator('#firstName').fill('E2E');
  await page.locator('#lastName').fill('Müşteri');
  await page.locator('#customerPhone').fill('05550000123');
  await page.locator('#address').fill('E2E Test Sokak No 1');
  const city = page.locator('#city');
  await expect(city).toBeEnabled();
  await city.fill('ankara');
  await expect(page.locator('#cityOptions [role="option"]')).toHaveCount(1);
  await city.press('ArrowDown');
  await city.press('Enter');
  await expect(city).toHaveValue('Ankara');
  await expect(page.locator('#district')).toBeEnabled();
  await expect.poll(() => page.locator('#district option').count()).toBeGreaterThan(1);
  await page.locator('#district').selectOption({ index: 1 });
}

async function storageSnapshot(page) {
  return page.evaluate(() => ({
    local: Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)])),
    session: Object.fromEntries(Object.keys(sessionStorage).map((key) => [key, sessionStorage.getItem(key)])),
  }));
}

module.exports = {
  bff,
  cartItem,
  ensureSuperAdminMfa,
  expect,
  fillCheckout,
  loginAdmin,
  setCart,
  stepUpWithPassword,
  storageSnapshot,
  test,
};
