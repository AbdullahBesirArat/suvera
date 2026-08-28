const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const UPSTREAM_API = process.env.UPSTREAM_API || 'https://panelya-api-production.up.railway.app/api';
const PUBLIC_ACCESS_TOKEN = process.env.SUVERA_PUBLIC_ACCESS_TOKEN || '';
// FIX: Keep proxy memory bounded even when env input is missing or invalid.
const MAX_PROXY_BODY_BYTES = positiveNumber(process.env.MAX_PROXY_BODY_BYTES, 1024 * 1024);
// Bound how long we wait for the upstream API so the proxy never hangs forever.
const PROXY_TIMEOUT_MS = positiveNumber(process.env.PROXY_TIMEOUT_MS, 15000);
const CUSTOMER_COOKIE = 'suveraCustomerToken';
const ACCESS_COOKIE = 'suveraAccessToken';
const REFRESH_COOKIE = 'suveraRefreshToken';
const GUEST_CART_COOKIE = 'suveraGuestCart';
// Cart responses are buffered so the opaque guest-cart token can be relocated
// into an HttpOnly cookie and stripped from the body (never exposed to JS).
const CART_BUFFER_PATH = /^cart(?:\/|$)/;
// The opaque guest token is forwarded upstream only to cart/checkout endpoints so
// the API can verify guest-cart ownership during order conversion.
const GUEST_TOKEN_UPSTREAM_PATH = /^(cart(?:\/|$)|orders(?:\/|\?|$)|payment(?:\/|$)|reviews(?:\/|$))/;
// A28 theme preview. The draft stylesheet must be loadable by <link rel="stylesheet">
// (style-src 'self' leaves no other CSP-safe way to apply it), so it has to be a GET —
// and a GET must not carry the token in its URL. The exchange response is buffered here,
// the raw token relocated into an HttpOnly session cookie and stripped from the body, and
// replayed upstream as a header only for preview-scoped read endpoints.
const THEME_PREVIEW_COOKIE = 'suveraThemePreview';
const THEME_PREVIEW_BUFFER_PATH = /^storefront-theme\/preview$/;
const THEME_PREVIEW_UPSTREAM_PATH = /^(?:storefront-theme\/preview\.css|collections\/preview)(?:\?|$)/;

function positiveNumber(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : fallback;
}

function collectBody(req, maxBytes = MAX_PROXY_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!settled) resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => {
      if (!settled) reject(err);
    });
  });
}

function storefrontOrigin(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const proto = forwardedProto || 'https';
  const host = forwardedHost || 'suvera-web.vercel.app';

  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) {
    return 'https://suvera-web.vercel.app';
  }

  return `${proto}://${host}`;
}

function parseCookies(header) {
  return String(header || '').split(';').reduce((cookies, part) => {
    const index = part.indexOf('=');
    if (index < 0) return cookies;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function serializeCookie(req, name, value, options = {}) {
  const host = String(req.headers.host || '');
  const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
  const parts = [
    `${name}=${encodeURIComponent(value || '')}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];

  if (!isLocal) parts.push('Secure');
  if (options.maxAge != null) parts.push(`Max-Age=${Math.max(0, Number(options.maxAge) || 0)}`);
  return parts.join('; ');
}

function setCookies(res, cookies) {
  if (!cookies.length) return;
  res.setHeader('Set-Cookie', cookies);
}

function isCustomerAuthPath(path) {
  return /^customer-auth(?:\/|$)/.test(path)
    || /^customers\/account(?:\/|\?|$)/.test(path)
    || /^returns\/customer(?:\/|\?|$)/.test(path);
}

// Routes where a signed-in customer's bearer must reach the API so it resolves the
// customer (not a guest): their account endpoints plus the persistent cart, which
// includes the guest->customer merge triggered right after login/registration.
function isCustomerBearerPath(path) {
  return isCustomerAuthPath(path)
    || /^cart(?:\/|$)/.test(path)
    || /^(reviews|questions|notifications|recently-viewed|comparison|customer-addresses|customer-orders)(?:\/|$)/.test(path);
}

function stripSessionTokens(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const next = { ...payload };
  delete next.accessToken;
  delete next.refreshToken;
  return next;
}

// Only these auth responses are buffered so upstream tokens can be moved into
// HttpOnly cookies and stripped from the body. Everything else is streamed.
const AUTH_BUFFER_PATHS = /^(customer-auth\/(login|register)|auth\/session\/(login|refresh|switch-organization))$/;

// Never forward hop-by-hop headers or upstream Set-Cookie (we mint our own
// cookies); content-encoding/length are dropped because undici already decoded
// the body, so the byte length and encoding no longer match.
const BLOCKED_RESPONSE_HEADERS = new Set([
  'content-encoding', 'content-length', 'transfer-encoding', 'connection',
  'keep-alive', 'set-cookie', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'upgrade',
]);

function forwardResponseHeaders(res, response) {
  response.headers.forEach((value, key) => {
    if (!BLOCKED_RESPONSE_HEADERS.has(key.toLowerCase())) res.setHeader(key, value);
  });
}

function shouldAttachRefreshCookie(path) {
  return /^auth\/session\/(refresh|logout)$/.test(path);
}

function isLocalHostname(hostname) {
  return /^(localhost|127\.0\.0\.1)$/i.test(String(hostname || ''));
}

// CSRF defence for state-changing requests: verify the browser-supplied
// same-origin signals. Returns true only when the request is provably same-site.
function sameSiteRequest(req) {
  const method = String(req.method || 'GET').toUpperCase();
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (!unsafe) return true;

  let expectedUrl;
  try {
    expectedUrl = new URL(storefrontOrigin(req));
  } catch (_) {
    return false;
  }

  // null when the header is absent, true/false when present and (mis)matching.
  const matchesExpected = (value) => {
    if (!value) return null;
    try {
      const url = new URL(value);
      if (isLocalHostname(url.hostname)) return true;
      return url.protocol === expectedUrl.protocol && url.host === expectedUrl.host;
    } catch (_) {
      return false;
    }
  };

  const secFetchSite = String(req.headers['sec-fetch-site'] || '').trim().toLowerCase();
  if (secFetchSite && !['same-origin', 'same-site', 'none'].includes(secFetchSite)) {
    return false; // explicit cross-site request
  }

  const originCheck = matchesExpected(String(req.headers.origin || '').trim());
  if (originCheck === true) return true;
  if (originCheck === false) return false;

  const refererCheck = matchesExpected(String(req.headers.referer || req.headers.referrer || '').trim());
  if (refererCheck === true) return true;
  if (refererCheck === false) return false;

  // Neither Origin nor Referer usable: accept only an explicit same-origin
  // Sec-Fetch-Site signal, or local development; otherwise reject.
  if (secFetchSite === 'same-origin' || secFetchSite === 'same-site') return true;
  return isLocalHostname(expectedUrl.hostname);
}

function validProxyPath(path) {
  try {
    const decoded = decodeURIComponent(String(path || ''));
    return decoded && !decoded.includes('..') && !/^[a-z][a-z0-9+.-]*:/i.test(decoded);
  } catch (_) {
    return false;
  }
}

function bodyWithRefreshCookie(path, body, cookies, headers) {
  if (!shouldAttachRefreshCookie(path) || !cookies[REFRESH_COOKIE]) return body;

  let payload = {};
  if (body && body.length) {
    const contentType = String(headers['Content-Type'] || '').toLowerCase();
    if (contentType && !contentType.includes('application/json')) return body;

    try {
      payload = JSON.parse(Buffer.from(body).toString('utf8') || '{}');
    } catch (_) {
      return body;
    }
  }

  if (payload.refreshToken) return body;
  headers['Content-Type'] = 'application/json; charset=utf-8';
  return Buffer.from(JSON.stringify({
    ...payload,
    refreshToken: cookies[REFRESH_COOKIE],
  }));
}

module.exports = async function handler(req, res) {
  const incoming = new URL(req.url, 'https://suvera.local');
  const path = incoming.pathname.replace(/^\/api\/?/, '');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Allow', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS');
    res.end();
    return;
  }
  if (!validProxyPath(path) || !sameSiteRequest(req)) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Forbidden request' }));
    return;
  }
  const upstream = new URL(`${UPSTREAM_API}/${path}`);
  upstream.search = incoming.search;
  const cookies = parseCookies(req.headers.cookie);

  const headers = {
    Origin: storefrontOrigin(req),
  };
  const publicAccessToken = String(req.headers['x-public-access-token'] || PUBLIC_ACCESS_TOKEN || '').trim();
  if (publicAccessToken) headers['x-public-access-token'] = publicAccessToken;

  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
  // Forward the optimistic-concurrency precondition so cart mutations enforce the
  // client's expected version server-side (prevents lost updates across tabs).
  if (req.headers['if-match']) headers['If-Match'] = req.headers['if-match'];
  // Conditional public reads must reach the API so its tenant-bound ETag can answer 304.
  if (req.headers['if-none-match']) headers['If-None-Match'] = req.headers['if-none-match'];
  if (req.headers.authorization) {
    headers.Authorization = req.headers.authorization;
  } else if (isCustomerBearerPath(path) && cookies[CUSTOMER_COOKIE]) {
    headers.Authorization = `Bearer ${cookies[CUSTOMER_COOKIE]}`;
  } else if (cookies[ACCESS_COOKIE]) {
    headers.Authorization = `Bearer ${cookies[ACCESS_COOKIE]}`;
  }
  // The preview token travels as a header only to allowlisted preview reads, so it stays
  // out of URLs, logs and referrers and can never authorize the normal public endpoints.
  if (THEME_PREVIEW_UPSTREAM_PATH.test(path) && cookies[THEME_PREVIEW_COOKIE]) {
    headers['X-Theme-Preview-Token'] = cookies[THEME_PREVIEW_COOKIE];
  }

  // Guest cart identity travels as an opaque header only to cart/checkout endpoints.
  if (GUEST_TOKEN_UPSTREAM_PATH.test(path) && cookies[GUEST_CART_COOKIE]) {
    headers['X-Guest-Cart-Token'] = cookies[GUEST_CART_COOKIE];
  }

  const hasBody = !['GET', 'HEAD'].includes(req.method || 'GET');
  let body;
  try {
    body = hasBody ? await collectBody(req) : undefined;
  } catch (err) {
    res.statusCode = err.statusCode || 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: err.message || 'Proxy request failed' }));
    return;
  }
  body = bodyWithRefreshCookie(path, body, cookies, headers);

  // Bound the upstream call with a timeout and abort it if the client hangs up.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, PROXY_TIMEOUT_MS);
  const onClientClose = () => controller.abort();
  req.on('close', onClientClose);
  const cleanup = () => {
    clearTimeout(timer);
    req.off('close', onClientClose);
  };

  let response;
  // FIX: Return a controlled proxy error instead of leaking runtime failures.
  try {
    response = await fetch(upstream, {
      method: req.method,
      headers,
      body,
      signal: controller.signal,
    });
  } catch (err) {
    cleanup();
    res.statusCode = timedOut ? 504 : 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: timedOut ? 'Proxy upstream timeout' : 'Proxy upstream request failed' }));
    return;
  }

  const responseCookies = [];
  if (/^customer-auth\/logout$/.test(path)) {
    responseCookies.push(serializeCookie(req, CUSTOMER_COOKIE, '', { maxAge: 0 }));
  }
  if (/^auth\/session\/logout$/.test(path)) {
    responseCookies.push(serializeCookie(req, ACCESS_COOKIE, '', { maxAge: 0 }));
    responseCookies.push(serializeCookie(req, REFRESH_COOKIE, '', { maxAge: 0 }));
  }

  forwardResponseHeaders(res, response);
  res.statusCode = response.status;

  // Non-auth responses stream straight through so large JSON/media never gets
  // fully buffered in memory. Client disconnect/timeout aborts the upstream body.
  if (!AUTH_BUFFER_PATHS.test(path) && !CART_BUFFER_PATH.test(path) && !THEME_PREVIEW_BUFFER_PATH.test(path)) {
    setCookies(res, responseCookies);
    if (!response.body) {
      cleanup();
      res.end();
      return;
    }
    try {
      await pipeline(Readable.fromWeb(response.body), res);
    } catch (_) {
      if (!res.headersSent) res.statusCode = timedOut ? 504 : 502;
      res.destroy();
    } finally {
      cleanup();
    }
    return;
  }

  // Auth flows: buffer the (small) JSON body, relocate tokens into HttpOnly
  // cookies and strip them from the response echoed to the browser.
  let responseBuffer;
  try {
    responseBuffer = Buffer.from(await response.arrayBuffer());
  } catch (err) {
    cleanup();
    if (!res.headersSent) {
      res.statusCode = timedOut ? 504 : 502;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify({ error: timedOut ? 'Proxy upstream timeout' : 'Proxy upstream read failed' }));
    return;
  }
  cleanup();
  const contentType = response.headers.get('content-type') || '';
  let outgoingBuffer = responseBuffer;

  if (response.ok && contentType.includes('application/json')) {
    let payload = {};
    try {
      payload = JSON.parse(responseBuffer.toString('utf8') || '{}');
    } catch (_) {
      payload = {};
    }
    if (/^customer-auth\/(login|register)$/.test(path) && payload.accessToken) {
      responseCookies.push(serializeCookie(req, CUSTOMER_COOKIE, payload.accessToken, { maxAge: 60 * 60 * 24 * 30 }));
      outgoingBuffer = Buffer.from(JSON.stringify(stripSessionTokens(payload)));
    }
    if (/^auth\/session\/(login|refresh)$/.test(path) && payload.accessToken) {
      responseCookies.push(serializeCookie(req, ACCESS_COOKIE, payload.accessToken, { maxAge: 60 * 15 }));
      if (payload.refreshToken) {
        responseCookies.push(serializeCookie(req, REFRESH_COOKIE, payload.refreshToken, { maxAge: 60 * 60 * 24 * 30 }));
      }
      outgoingBuffer = Buffer.from(JSON.stringify(stripSessionTokens(payload)));
    }
    if (/^auth\/session\/switch-organization$/.test(path) && payload.accessToken) {
      responseCookies.push(serializeCookie(req, ACCESS_COOKIE, payload.accessToken, { maxAge: 60 * 15 }));
      outgoingBuffer = Buffer.from(JSON.stringify(stripSessionTokens(payload)));
    }
    if (CART_BUFFER_PATH.test(path) && Object.prototype.hasOwnProperty.call(payload, 'guest_cart_token')) {
      const token = payload.guest_cart_token;
      if (typeof token === 'string' && token) {
        responseCookies.push(serializeCookie(req, GUEST_CART_COOKIE, token, { maxAge: 60 * 60 * 24 * 30 }));
      } else {
        responseCookies.push(serializeCookie(req, GUEST_CART_COOKIE, '', { maxAge: 0 }));
      }
      const { guest_cart_token: _guestToken, ...rest } = payload;
      outgoingBuffer = Buffer.from(JSON.stringify(rest));
    }
    if (THEME_PREVIEW_BUFFER_PATH.test(path)) {
      const token = payload.preview_session_token;
      // A session cookie on purpose: no Max-Age, so it dies with the browser session and is
      // never written to the persistent cookie jar. The token is short-lived server-side too.
      responseCookies.push(serializeCookie(req, THEME_PREVIEW_COOKIE, typeof token === 'string' ? token : ''));
      const { preview_session_token: _previewToken, ...rest } = payload;
      outgoingBuffer = Buffer.from(JSON.stringify(rest));
    }
  }

  setCookies(res, responseCookies);
  res.end(outgoingBuffer);
};

// Exposed for unit tests; the default export remains the Vercel request handler.
module.exports.sameSiteRequest = sameSiteRequest;
module.exports.validProxyPath = validProxyPath;
module.exports.isCustomerAuthPath = isCustomerAuthPath;
module.exports.storefrontOrigin = storefrontOrigin;
module.exports.parseCookies = parseCookies;
module.exports.stripSessionTokens = stripSessionTokens;
