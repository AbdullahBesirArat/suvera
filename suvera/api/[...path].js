const UPSTREAM_API = process.env.UPSTREAM_API || 'https://panelya-api-production.up.railway.app/api';
const PUBLIC_ACCESS_TOKEN = process.env.SUVERA_PUBLIC_ACCESS_TOKEN || '';
// FIX: Keep proxy memory bounded even when env input is missing or invalid.
const MAX_PROXY_BODY_BYTES = positiveNumber(process.env.MAX_PROXY_BODY_BYTES, 1024 * 1024);

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
  const host = forwardedHost || 'suvera.com.tr';

  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) {
    return 'https://suvera.com.tr';
  }

  if (/\.vercel\.app$/i.test(host)) {
    return 'https://suvera.com.tr';
  }

  return `${proto}://${host}`;
}

module.exports = async function handler(req, res) {
  const incoming = new URL(req.url, 'https://suvera.local');
  const path = incoming.pathname.replace(/^\/api\/?/, '');
  const upstream = new URL(`${UPSTREAM_API}/${path}`);
  upstream.search = incoming.search;

  const headers = {
    Origin: storefrontOrigin(req),
  };
  const publicAccessToken = String(req.headers['x-public-access-token'] || PUBLIC_ACCESS_TOKEN || '').trim();
  if (publicAccessToken) headers['x-public-access-token'] = publicAccessToken;

  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
  if (req.headers.authorization) headers.Authorization = req.headers.authorization;

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

  response.headers.forEach((value, key) => {
    if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  });

  res.statusCode = response.status;
  res.end(Buffer.from(await response.arrayBuffer()));
};
