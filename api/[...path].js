const UPSTREAM_API = process.env.UPSTREAM_API || 'https://panelya-api-production.up.railway.app/api';
const PUBLIC_ACCESS_TOKEN = process.env.SUVERA_PUBLIC_ACCESS_TOKEN || '';
// FIX: Keep proxy memory bounded even when env input is missing or invalid.
const MAX_PROXY_BODY_BYTES = positiveNumber(process.env.MAX_PROXY_BODY_BYTES, 1024 * 1024);
const CUSTOMER_COOKIE = 'suveraCustomerToken';
const ACCESS_COOKIE = 'suveraAccessToken';
const REFRESH_COOKIE = 'suveraRefreshToken';

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
  return /^customer-auth(?:\/|$)/.test(path) || /^customers\/account(?:\/|\?|$)/.test(path);
}

function stripSessionTokens(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const next = { ...payload };
  delete next.accessToken;
  delete next.refreshToken;
  return next;
}

function shouldAttachRefreshCookie(path) {
  return /^auth\/session\/(refresh|logout)$/.test(path);
}

function sameSiteRequest(req) {
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || 'GET').toUpperCase());
  if (!unsafe) return true;

  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true;

  const expected = storefrontOrigin(req);
  try {
    const actualUrl = new URL(origin);
    const expectedUrl = new URL(expected);
    if (/^(localhost|127\.0\.0\.1)$/i.test(actualUrl.hostname)) return true;
    return actualUrl.protocol === expectedUrl.protocol && actualUrl.host === expectedUrl.host;
  } catch (_) {
    return false;
  }
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
  if (req.headers.authorization) {
    headers.Authorization = req.headers.authorization;
  } else if (isCustomerAuthPath(path) && cookies[CUSTOMER_COOKIE]) {
    headers.Authorization = `Bearer ${cookies[CUSTOMER_COOKIE]}`;
  } else if (cookies[ACCESS_COOKIE]) {
    headers.Authorization = `Bearer ${cookies[ACCESS_COOKIE]}`;
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

  let response;
  // FIX: Return a controlled proxy error instead of leaking runtime failures.
  try {
    response = await fetch(upstream, {
      method: req.method,
      headers,
      body,
    });
  } catch (err) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Proxy upstream request failed' }));
    return;
  }

  const responseBuffer = Buffer.from(await response.arrayBuffer());
  const responseCookies = [];
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
    if (/^auth\/session\/login$/.test(path) && payload.accessToken) {
      responseCookies.push(serializeCookie(req, ACCESS_COOKIE, payload.accessToken, { maxAge: 60 * 15 }));
      if (payload.refreshToken) {
        responseCookies.push(serializeCookie(req, REFRESH_COOKIE, payload.refreshToken, { maxAge: 60 * 60 * 24 * 30 }));
      }
      outgoingBuffer = Buffer.from(JSON.stringify(stripSessionTokens(payload)));
    }
    if (/^auth\/session\/refresh$/.test(path) && payload.accessToken) {
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
  }

  if (/^customer-auth\/logout$/.test(path)) {
    responseCookies.push(serializeCookie(req, CUSTOMER_COOKIE, '', { maxAge: 0 }));
  }
  if (/^auth\/session\/logout$/.test(path)) {
    responseCookies.push(serializeCookie(req, ACCESS_COOKIE, '', { maxAge: 0 }));
    responseCookies.push(serializeCookie(req, REFRESH_COOKIE, '', { maxAge: 0 }));
  }

  response.headers.forEach((value, key) => {
    if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  });
  setCookies(res, responseCookies);

  res.statusCode = response.status;
  res.end(outgoingBuffer);
};
