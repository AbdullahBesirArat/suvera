'use strict';

// Fail-closed upstream selection for the LOCAL dev proxy (dev-server.js).
//
// The dev proxy forwards real checkout/auth/cart writes. It used to fall back to the
// production Panelya API when UPSTREAM_API was unset, so a plain `npm run dev` could write
// to live data. Now an upstream must be named, and anything that is not loopback needs an
// explicit ALLOW_REMOTE_UPSTREAM=1 so reaching a remote API is always a deliberate act.
// (api/[...path].js is the Vercel production proxy and is intentionally not governed here.)

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function resolveUpstreamApi(env = process.env) {
  const raw = String(env.UPSTREAM_API || '').trim();
  if (!raw) {
    throw new Error(
      'UPSTREAM_API is required for the dev proxy and has no default. '
      + 'Point it at a local API, e.g. UPSTREAM_API=http://127.0.0.1:3001/api'
    );
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('UPSTREAM_API is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('UPSTREAM_API must be an http(s) URL');
  }

  // url.hostname is parsed by the URL parser, so userinfo tricks such as
  // http://127.0.0.1@evil.example resolve to the real host (evil.example) here.
  if (!LOOPBACK_HOSTS.has(url.hostname) && String(env.ALLOW_REMOTE_UPSTREAM || '') !== '1') {
    throw new Error(
      `UPSTREAM_API points to a non-loopback host (${url.hostname}). The dev proxy forwards real writes; `
      + 'set ALLOW_REMOTE_UPSTREAM=1 only if you intend to use that remote API.'
    );
  }

  return raw.replace(/\/$/, '');
}

module.exports = { resolveUpstreamApi };
