'use strict';

const fs = require('node:fs');
const { expect, test } = require('../fixtures.cjs');

function productionCsp() {
  const config = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  const catchAll = config.headers.find((entry) => entry.source === '/(.*)');
  return catchAll.headers.find((header) => header.key.toLowerCase() === 'content-security-policy').value;
}

test('A03 E2E storefront CSP production policy ile birebir aynıdır', async ({ request, e2eState }) => {
  const response = await request.get(e2eState.origins.storefront);
  expect(response.status()).toBe(200);
  const csp = response.headers()['content-security-policy'];
  expect(csp).toBe(productionCsp());
  expect(csp).not.toMatch(/(?:script-src|style-src)[^;]*'unsafe-inline'/);
  expect(csp).toContain("style-src-attr 'none'");
});
