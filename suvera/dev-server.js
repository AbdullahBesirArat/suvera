const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const rootDir = __dirname;
const upstreamApi = (process.env.UPSTREAM_API || 'https://panelya-api-production.up.railway.app/api').replace(/\/$/, '');
const publicAccessToken = process.env.SUVERA_PUBLIC_ACCESS_TOKEN || '';
const host = process.env.HOST || '127.0.0.1';
const preferredPort = Number(process.env.PORT || 4173);

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function requestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function storefrontOrigin(req) {
  return `http://${req.headers.host || `${host}:${preferredPort}`}`;
}

async function proxyApi(req, res, pathname, search) {
  const upstreamPath = pathname.replace(/^\/api\/?/, '');
  const target = new URL(`${upstreamApi}/${upstreamPath}`);
  target.search = search;

  const headers = {
    Origin: storefrontOrigin(req),
  };
  const token = String(req.headers['x-public-access-token'] || publicAccessToken || '').trim();
  if (token) headers['x-public-access-token'] = token;
  if (req.headers.authorization) headers.Authorization = req.headers.authorization;
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];

  try {
    const body = !['GET', 'HEAD'].includes(req.method || 'GET')
      ? await requestBody(req)
      : null;
    const response = await upstreamRequest(target, {
      method: req.method || 'GET',
      headers,
      body,
    });

    send(res, response.status, response.body, response.headers);
  } catch (err) {
    send(res, 502, JSON.stringify({
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

function serveFile(req, res, pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(rootDir, decodeURIComponent(requestedPath)));
  const normalizedRoot = path.normalize(rootDir);

  if (!filePath.startsWith(normalizedRoot)) {
    send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  fs.readFile(filePath, (err, body) => {
    if (err) {
      send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }

    const type = contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    send(res, 200, body, { 'Content-Type': type });
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
