'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

function productionCsp() {
  const config = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  const catchAll = config.headers.find((entry) => entry.source === '/(.*)');
  return catchAll.headers.find((header) => header.key.toLowerCase() === 'content-security-policy').value;
}

function developmentCsp() {
  const source = fs.readFileSync('dev-server.js', 'utf8');
  const match = source.match(/'Content-Security-Policy':\s*"([^"]+)"/);
  assert.ok(match, 'dev-server Content-Security-Policy header must exist');
  return match[1];
}

test('development and production storefront CSP stay identical and strict', () => {
  const production = productionCsp();
  const development = developmentCsp();
  assert.equal(development, production);
  assert.match(production, /script-src 'self'(?:;|$)/);
  assert.match(production, /style-src 'self' https:\/\/fonts\.googleapis\.com(?:;|$)/);
  assert.match(production, /style-src-attr 'none'(?:;|$)/);
  assert.doesNotMatch(production, /(?:script-src|style-src)[^;]*'unsafe-inline'/);
  // A28 themes are applied through a same-origin stylesheet, so the feature must not have
  // widened style-src (no blob:, no data:, no extra host) to make itself work.
  assert.doesNotMatch(production, /style-src[^;]*(blob:|data:|\*)/);
});
