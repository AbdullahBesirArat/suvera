const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const rootDir = __dirname;
const upstreamApi = (process.env.UPSTREAM_API || 'https://panelya-api-production.up.railway.app/api').replace(/\/$/, '');
const publicAccessToken = process.env.SUVERA_PUBLIC_ACCESS_TOKEN || '';
const siteOrigin = (process.env.SUVERA_SITE_ORIGIN || 'https://suvera.com.tr').replace(/\/$/, '');
const organizationSlug = process.env.SUVERA_ORGANIZATION_SLUG || 'suvera';
const host = process.env.HOST || '127.0.0.1';
const preferredPort = Number(process.env.PORT || 4173);
// FIX: Keep proxy memory bounded even when env input is missing or invalid.
const maxProxyBodyBytes = positiveNumber(process.env.MAX_PROXY_BODY_BYTES, 1024 * 1024);
const customerCookie = 'suveraCustomerToken';
const accessCookie = 'suveraAccessToken';
const refreshCookie = 'suveraRefreshToken';
// FIX: Mirror production hardening headers during API-connected local testing.
const securityHeaders = {
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://panelya-api-production.up.railway.app; img-src 'self' https: data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'",
};

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

const cleanPageFiles = new Map([
  ['anasayfa', 'index.html'],
  ['urunler', 'urunler.html'],
  ['urun', 'urun.html'],
  ['sepet', 'sepet.html'],
  ['giris', 'giris.html'],
  ['siparis', 'siparis.html'],
  ['sifre-sifirla', 'sifre-sifirla.html'],
  ['siparis-takip', 'siparis-takip.html'],
  ['tesekkur', 'tesekkur.html'],
  ['hakkimizda', 'hakkimizda.html'],
  ['iade', 'iade.html'],
  ['iletisim', 'iletisim.html'],
  ['kargo', 'kargo.html'],
  ['kvkk', 'kvkk.html'],
  ['sozlesme', 'sozlesme.html'],
  ['uyelik-sozlesmesi', 'uyelik-sozlesmesi.html'],
  ['favoriler', 'favoriler.html'],
  ['hesabim', 'hesabim.html'],
  ['blog-detay', 'blog-detay.html'],
  ['blog', 'blog.html'],
  ['arama', 'arama.html'],
  ['suvera', 'suvera.html'],
]);

const sitemapStaticPaths = [
  'anasayfa',
  'urunler',
  'sepet',
  'siparis',
  'giris',
  'tesekkur',
  'hesabim',
  'favoriler',
  'sifre-sifirla',
  'siparis-takip',
  'kvkk',
  'sozlesme',
  'uyelik-sozlesmesi',
  'kargo',
  'iade',
  'hakkimizda',
  'iletisim',
  'arama',
  'blog',
];

function positiveNumber(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : fallback;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    ...securityHeaders,
    ...headers,
  });
  res.end(body);
}

function requestBody(req, maxBytes = maxProxyBodyBytes) {
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
  const forwardedHost = String(req.headers.host || '').split(',')[0].trim();
  // FIX: Mirror production proxy origin so Railway CORS accepts local API-connected smoke tests.
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(forwardedHost)) {
    return 'https://suvera.com.tr';
  }
  if (/\.vercel\.app$/i.test(forwardedHost)) {
    return 'https://suvera.com.tr';
  }
  return `http://${forwardedHost || `${host}:${preferredPort}`}`;
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

function serializeCookie(name, value, options = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value || '')}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (options.maxAge != null) parts.push(`Max-Age=${Math.max(0, Number(options.maxAge) || 0)}`);
  return parts.join('; ');
}

function isCustomerAuthPath(pathname) {
  return /^\/api\/customer-auth(?:\/|$)/.test(pathname) || /^\/api\/customers\/account(?:\/|\?|$)/.test(pathname);
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

function bodyWithRefreshCookie(path, body, cookies, headers) {
  if (!shouldAttachRefreshCookie(path) || !cookies[refreshCookie]) return body;

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
    refreshToken: cookies[refreshCookie],
  }));
}

function escapeXml(value) {
  return String(value || '').replace(/[<>&'"]/g, (char) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  })[char]);
}

function sitemapUrlEntry(loc, priority = '0.7') {
  return `  <url><loc>${escapeXml(loc)}</loc><priority>${priority}</priority></url>`;
}

async function proxyApi(req, res, pathname, search) {
  const upstreamPath = pathname.replace(/^\/api\/?/, '');
  const target = new URL(`${upstreamApi}/${upstreamPath}`);
  target.search = search;
  const cookies = parseCookies(req.headers.cookie);

  const headers = {
    Origin: storefrontOrigin(req),
  };
  const token = String(req.headers['x-public-access-token'] || publicAccessToken || '').trim();
  if (token) headers['x-public-access-token'] = token;
  if (req.headers.authorization) {
    headers.Authorization = req.headers.authorization;
  } else if (isCustomerAuthPath(pathname) && cookies[customerCookie]) {
    headers.Authorization = `Bearer ${cookies[customerCookie]}`;
  } else if (cookies[accessCookie]) {
    headers.Authorization = `Bearer ${cookies[accessCookie]}`;
  }
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];

  try {
    let body = !['GET', 'HEAD'].includes(req.method || 'GET')
      ? await requestBody(req)
      : null;
    body = bodyWithRefreshCookie(upstreamPath, body, cookies, headers);
    const response = await upstreamRequest(target, {
      method: req.method || 'GET',
      headers,
      body,
    });

    const responseHeaders = { ...response.headers };
    const responseCookies = [];
    let responseBody = response.body;
    const contentType = String(response.headers['content-type'] || '');

    if (response.status >= 200 && response.status < 300 && contentType.includes('application/json')) {
      let payload = {};
      try {
        payload = JSON.parse(Buffer.from(response.body).toString('utf8') || '{}');
      } catch (_) {
        payload = {};
      }

      if (/^customer-auth\/(login|register)$/.test(upstreamPath) && payload.accessToken) {
        responseCookies.push(serializeCookie(customerCookie, payload.accessToken, { maxAge: 60 * 60 * 24 * 30 }));
        responseBody = Buffer.from(JSON.stringify(stripSessionTokens(payload)));
      }
      if (/^auth\/session\/login$/.test(upstreamPath) && payload.accessToken) {
        responseCookies.push(serializeCookie(accessCookie, payload.accessToken, { maxAge: 60 * 15 }));
        if (payload.refreshToken) responseCookies.push(serializeCookie(refreshCookie, payload.refreshToken, { maxAge: 60 * 60 * 24 * 30 }));
        responseBody = Buffer.from(JSON.stringify(stripSessionTokens(payload)));
      }
      if (/^auth\/session\/refresh$/.test(upstreamPath) && payload.accessToken) {
        responseCookies.push(serializeCookie(accessCookie, payload.accessToken, { maxAge: 60 * 15 }));
        if (payload.refreshToken) responseCookies.push(serializeCookie(refreshCookie, payload.refreshToken, { maxAge: 60 * 60 * 24 * 30 }));
        responseBody = Buffer.from(JSON.stringify(stripSessionTokens(payload)));
      }
      if (/^auth\/session\/switch-organization$/.test(upstreamPath) && payload.accessToken) {
        responseCookies.push(serializeCookie(accessCookie, payload.accessToken, { maxAge: 60 * 15 }));
        responseBody = Buffer.from(JSON.stringify(stripSessionTokens(payload)));
      }
    }

    if (/^customer-auth\/logout$/.test(upstreamPath)) {
      responseCookies.push(serializeCookie(customerCookie, '', { maxAge: 0 }));
    }
    if (/^auth\/session\/logout$/.test(upstreamPath)) {
      responseCookies.push(serializeCookie(accessCookie, '', { maxAge: 0 }));
      responseCookies.push(serializeCookie(refreshCookie, '', { maxAge: 0 }));
    }
    if (responseCookies.length) responseHeaders['Set-Cookie'] = responseCookies;

    send(res, response.status, responseBody, responseHeaders);
  } catch (err) {
    send(res, err.statusCode || 502, JSON.stringify({
      error: 'Panelya API proxy istegi basarisiz',
      detail: err.message,
    }), { 'Content-Type': 'application/json; charset=utf-8' });
  }
}

function upstreamRequest(target, options) {
  return new Promise((resolve, reject) => {
    const transport = target.protocol === 'https:' ? https : http;
    const request = transport.request(target, {
      method: options.method,
      headers: options.headers,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const headers = {};
        Object.entries(response.headers).forEach(([key, value]) => {
          if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) {
            headers[key] = Array.isArray(value) ? value.join(', ') : value;
          }
        });

        resolve({
          status: response.statusCode || 502,
          headers,
          body: Buffer.concat(chunks),
        });
      });
    });

    request.setTimeout(15000, () => {
      request.destroy(new Error('Upstream API zaman asimina ugradi'));
    });
    request.on('error', reject);
    if (options.body && options.body.length) request.write(options.body);
    request.end();
  });
}

async function apiList(apiPath) {
  const target = new URL(`${upstreamApi}${apiPath}`);
  target.searchParams.set('organizationSlug', organizationSlug);
  const headers = { Origin: 'https://suvera.com.tr' };
  if (publicAccessToken) headers['x-public-access-token'] = publicAccessToken;
  const response = await upstreamRequest(target, { method: 'GET', headers });
  if (response.status < 200 || response.status >= 300) return [];
  try {
    return JSON.parse(Buffer.from(response.body).toString('utf8') || '[]');
  } catch (_) {
    return [];
  }
}

async function serveSitemap(res) {
  const urls = new Set(sitemapStaticPaths.map((page) => `${siteOrigin}/${page}`));
  const [products, categories, posts] = await Promise.all([
    apiList('/products?status=active&limit=200'),
    apiList('/categories'),
    apiList('/blog'),
  ]);

  (Array.isArray(products) ? products : []).forEach((product) => {
    if (product && product.id) urls.add(`${siteOrigin}/urun?id=${encodeURIComponent(product.id)}`);
  });
  (Array.isArray(categories) ? categories : []).forEach((category) => {
    if (category && category.id) urls.add(`${siteOrigin}/urunler?category_id=${encodeURIComponent(category.id)}`);
  });
  (Array.isArray(posts) ? posts : []).forEach((post) => {
    const idOrSlug = post && (post.slug || post.id);
    if (idOrSlug) urls.add(`${siteOrigin}/blog-detay?id=${encodeURIComponent(idOrSlug)}`);
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...Array.from(urls).map((loc) => sitemapUrlEntry(loc, loc === `${siteOrigin}/anasayfa` ? '1.0' : '0.7')),
    '</urlset>',
    '',
  ].join('\n');

  send(res, 200, xml, {
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': 'no-store',
  });
}

function serveFile(req, res, pathname) {
  const requestedPath = pathname === '/' ? '/anasayfa' : pathname;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestedPath);
  } catch (_) {
    send(res, 400, 'Bad request', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  const cleanKey = decodedPath.replace(/^\/+/, '').replace(/\/+$/, '');
  if (cleanKey === 'index.html') {
    send(res, 308, '', { Location: '/anasayfa' });
    return;
  }
  if (cleanKey.endsWith('.html')) {
    send(res, 308, '', { Location: '/' + cleanKey.slice(0, -5) });
    return;
  }
  if (cleanPageFiles.has(cleanKey)) {
    decodedPath = '/' + cleanPageFiles.get(cleanKey);
  }

  const filePath = path.resolve(rootDir, '.' + decodedPath);
  const relativePath = path.relative(rootDir, filePath);
  // FIX: Use path.relative so sibling directories with the same prefix cannot be served.
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  fs.readFile(filePath, (err, body) => {
    if (err) {
      send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }

    const type = contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const cacheableAsset = /[\\\/](assets|uploads)[\\\/]/.test(filePath);
    send(res, 200, body, {
      'Content-Type': type,
      ...(cacheableAsset ? { 'Cache-Control': 'public, max-age=31536000, immutable' } : {}),
    });
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      let url;
      url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        await proxyApi(req, res, url.pathname, url.search);
        return;
      }

      if (url.pathname === '/sitemap.xml') {
        await serveSitemap(res);
        return;
      }

      serveFile(req, res, url.pathname);
    } catch (err) {
      if (!res.headersSent) {
        send(res, 500, 'Internal server error', { 'Content-Type': 'text/plain; charset=utf-8' });
      } else {
        res.end();
      }
      console.error(`Suvera dev server request error: ${err.message}`);
    }
  });
}

process.on('uncaughtException', (err) => {
  console.error(`Suvera dev server uncaught error: ${err.message}`);
});

process.on('unhandledRejection', (err) => {
  console.error(`Suvera dev server unhandled rejection: ${err && err.message ? err.message : err}`);
});

function listen(port) {
  const server = createServer();
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && port < preferredPort + 20) {
      listen(port + 1);
      return;
    }

    console.error(`Suvera dev server baslatilamadi: ${err.message}`);
    process.exitCode = 1;
  });

  server.listen(port, host, () => {
    console.log(`Suvera dev server: http://${host}:${port}`);
    console.log(`Panelya API proxy: ${upstreamApi}`);
    if (!publicAccessToken) {
      console.log('Not: Katalog, siparis ve odeme API istekleri icin SUVERA_PUBLIC_ACCESS_TOKEN ayarlayin.');
    }
  });
}

listen(preferredPort);
