const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { resolveUpstreamApi } = require('../scripts/resolve-upstream.js');

const PROD = 'https://panelya-api-production.up.railway.app/api';

test('R1: no UPSTREAM_API means no upstream — the dev proxy never defaults to production', () => {
  assert.throws(() => resolveUpstreamApi({}), /UPSTREAM_API/);
  assert.throws(() => resolveUpstreamApi({ UPSTREAM_API: '   ' }), /UPSTREAM_API/);
});

test('R1: loopback upstreams are accepted and the trailing slash is trimmed', () => {
  assert.equal(resolveUpstreamApi({ UPSTREAM_API: 'http://127.0.0.1:3001/api/' }), 'http://127.0.0.1:3001/api');
  assert.equal(resolveUpstreamApi({ UPSTREAM_API: 'http://localhost:3001/api' }), 'http://localhost:3001/api');
  assert.equal(resolveUpstreamApi({ UPSTREAM_API: 'http://[::1]:3001/api' }), 'http://[::1]:3001/api');
});

test('R1: a remote upstream (including production) needs an explicit opt-in', () => {
  assert.throws(() => resolveUpstreamApi({ UPSTREAM_API: PROD }), /ALLOW_REMOTE_UPSTREAM/);
  assert.throws(() => resolveUpstreamApi({ UPSTREAM_API: 'https://staging.example.com/api' }), /ALLOW_REMOTE_UPSTREAM/);
  assert.throws(() => resolveUpstreamApi({ UPSTREAM_API: PROD, ALLOW_REMOTE_UPSTREAM: 'yes' }), /ALLOW_REMOTE_UPSTREAM/);
  assert.equal(resolveUpstreamApi({ UPSTREAM_API: PROD, ALLOW_REMOTE_UPSTREAM: '1' }), PROD);
});

test('R1: lookalike hosts and non-http schemes are not treated as loopback', () => {
  assert.throws(() => resolveUpstreamApi({ UPSTREAM_API: 'http://localhost.evil.example/api' }), /ALLOW_REMOTE_UPSTREAM/);
  assert.throws(() => resolveUpstreamApi({ UPSTREAM_API: 'http://127.0.0.1@evil.example/api' }), /ALLOW_REMOTE_UPSTREAM/);
  assert.throws(() => resolveUpstreamApi({ UPSTREAM_API: 'file:///etc/passwd' }), /http/);
  assert.throws(() => resolveUpstreamApi({ UPSTREAM_API: 'not a url' }), /UPSTREAM_API/);
});

test('R1: dev-server.js uses the guard and no longer embeds a production default', () => {
  const source = fs.readFileSync('dev-server.js', 'utf8');
  assert.match(source, /resolveUpstreamApi\(process\.env\)/);
  assert.doesNotMatch(source, /process\.env\.UPSTREAM_API\s*\|\|/);
});
