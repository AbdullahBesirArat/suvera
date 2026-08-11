const test = require('node:test');
const assert = require('node:assert/strict');

const proxy = require('../api/[...path].js');
const { sameSiteRequest, validProxyPath, isCustomerAuthPath, stripSessionTokens } = proxy;

function makeReq(method, headers = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return { method, headers: lower };
}

const PROD_HOST = { host: 'suvera-web.vercel.app', 'x-forwarded-proto': 'https' };

test('safe methods are always allowed', () => {
  assert.equal(sameSiteRequest(makeReq('GET', PROD_HOST)), true);
  assert.equal(sameSiteRequest(makeReq('HEAD', PROD_HOST)), true);
  assert.equal(sameSiteRequest(makeReq('OPTIONS', PROD_HOST)), true);
});

test('same-origin POST is allowed via Origin', () => {
  assert.equal(
    sameSiteRequest(makeReq('POST', { ...PROD_HOST, origin: 'https://suvera-web.vercel.app' })),
    true,
  );
});

test('cross-origin POST is rejected', () => {
  assert.equal(
    sameSiteRequest(makeReq('POST', { ...PROD_HOST, origin: 'https://evil.example.com' })),
    false,
  );
});

test('Sec-Fetch-Site cross-site is rejected even with no Origin', () => {
  assert.equal(
    sameSiteRequest(makeReq('POST', { ...PROD_HOST, 'sec-fetch-site': 'cross-site' })),
    false,
  );
});

test('Referer is used as a fallback when Origin is absent', () => {
  assert.equal(
    sameSiteRequest(makeReq('POST', { ...PROD_HOST, referer: 'https://suvera-web.vercel.app/sepet' })),
    true,
  );
  assert.equal(
    sameSiteRequest(makeReq('POST', { ...PROD_HOST, referer: 'https://evil.example.com/x' })),
    false,
  );
});

test('unsafe request with no Origin/Referer/Sec-Fetch is rejected in production', () => {
  assert.equal(sameSiteRequest(makeReq('POST', PROD_HOST)), false);
});

test('same-origin Sec-Fetch-Site alone is accepted', () => {
  assert.equal(
    sameSiteRequest(makeReq('POST', { ...PROD_HOST, 'sec-fetch-site': 'same-origin' })),
    true,
  );
});

test('validProxyPath blocks traversal and absolute/scheme URLs', () => {
  assert.equal(validProxyPath('products'), true);
  assert.equal(validProxyPath('customer-auth/login'), true);
  assert.equal(validProxyPath('../secret'), false);
  assert.equal(validProxyPath('http://evil.com'), false);
  assert.equal(validProxyPath('file:/etc/passwd'), false);
});

test('customer return paths use the customer HttpOnly session', () => {
  assert.equal(isCustomerAuthPath('returns/customer'), true);
  assert.equal(isCustomerAuthPath('returns/customer/42?organizationSlug=suvera'), true);
  assert.equal(isCustomerAuthPath('returns'), false);
});

test('stripSessionTokens removes tokens from the body echoed to the browser', () => {
  const cleaned = stripSessionTokens({ user: { id: 1 }, accessToken: 'a', refreshToken: 'b' });
  assert.deepEqual(cleaned, { user: { id: 1 } });
});

// --- Full-handler behaviour: streaming, auth buffering, abort, upstream error ---

const { Writable } = require('node:stream');
const { EventEmitter } = require('node:events');

class MockRes extends Writable {
  constructor() {
    super();
    this.chunks = [];
    this.headers = {};
    this.statusCode = 200;
    this._destroyed = false;
  }
  _write(chunk, _enc, cb) { this.chunks.push(Buffer.from(chunk)); cb(); }
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; }
  getHeader(k) { return this.headers[String(k).toLowerCase()]; }
  destroy(err) { this._destroyed = true; return super.destroy(err); }
  get headersSent() { return this.chunks.length > 0; }
  get bodyText() { return Buffer.concat(this.chunks).toString('utf8'); }
}

function mockReq(method, path, headers = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = `/api/${path}`;
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  req.headers = lower;
  return req;
}

const SAME_ORIGIN = { host: 'suvera-web.vercel.app', 'x-forwarded-proto': 'https', origin: 'https://suvera-web.vercel.app' };

async function withFetch(fake, run) {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await run(); } finally { globalThis.fetch = original; }
}

test('non-auth GET response is streamed through with status and headers preserved', async () => {
  const bodyText = JSON.stringify({ items: Array.from({ length: 5000 }, (_, i) => ({ i })) });
  const res = new MockRes();
  await withFetch(
    async () => new Response(bodyText, { status: 200, headers: { 'content-type': 'application/json', 'content-length': String(bodyText.length) } }),
    () => proxy(mockReq('GET', 'products', { host: 'suvera-web.vercel.app', 'x-forwarded-proto': 'https' }), res),
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.bodyText, bodyText);
  // content-length is dropped (body may be re-chunked) and no auth cookie is set.
  assert.equal(res.getHeader('content-length'), undefined);
  assert.equal(res.getHeader('set-cookie'), undefined);
});

test('auth login response is buffered: tokens move to HttpOnly cookies and leave the body', async () => {
  const res = new MockRes();
  const req = mockReq('POST', 'auth/session/login', { ...SAME_ORIGIN, 'content-type': 'application/json' });
  const p = withFetch(
    async () => new Response(JSON.stringify({ user: { id: 7 }, accessToken: 'ACCESS', refreshToken: 'REFRESH' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    () => proxy(req, res),
  );
  // Complete the (empty) request body so collectBody resolves.
  setImmediate(() => req.emit('end'));
  await p;
  const parsed = JSON.parse(res.bodyText);
  assert.equal(parsed.accessToken, undefined);
  assert.equal(parsed.refreshToken, undefined);
  assert.deepEqual(parsed.user, { id: 7 });
  const cookies = [].concat(res.getHeader('set-cookie') || []);
  assert.ok(cookies.some((c) => c.startsWith('suveraAccessToken=') && /HttpOnly/.test(c)), 'access cookie HttpOnly');
  assert.ok(cookies.some((c) => c.startsWith('suveraRefreshToken=')), 'refresh cookie set');
});

test('customer return request forwards the customer cookie as Bearer auth', async () => {
  const res = new MockRes();
  let authorization = '';
  await withFetch(
    async (_url, options) => {
      authorization = options.headers.Authorization;
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    () => proxy(mockReq('GET', 'returns/customer?organizationSlug=suvera', {
      host: 'suvera-web.vercel.app',
      'x-forwarded-proto': 'https',
      cookie: 'suveraCustomerToken=CUSTOMER_TOKEN; suveraAccessToken=ADMIN_TOKEN',
    }), res),
  );
  assert.equal(authorization, 'Bearer CUSTOMER_TOKEN');
  assert.deepEqual(JSON.parse(res.bodyText), []);
});

test('client disconnect aborts the upstream request and returns a controlled error', async () => {
  const res = new MockRes();
  const req = mockReq('GET', 'products', { host: 'suvera-web.vercel.app', 'x-forwarded-proto': 'https' });
  const p = withFetch(
    (_url, opts) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
    () => proxy(req, res),
  );
  setImmediate(() => req.emit('close'));
  await p;
  assert.equal(res.statusCode, 502);
});

test('upstream failure returns 502 without leaking the error', async () => {
  const res = new MockRes();
  await withFetch(
    async () => { throw new Error('econnrefused secret-host:5432'); },
    () => proxy(mockReq('GET', 'products', { host: 'suvera-web.vercel.app', 'x-forwarded-proto': 'https' }), res),
  );
  assert.equal(res.statusCode, 502);
  assert.doesNotMatch(res.bodyText, /secret-host/);
});

// --- A21 guest cart token relocation ---

test('guest cart cookie is forwarded (as X-Guest-Cart-Token) only to cart/order/payment paths', async () => {
  async function forwarded(path) {
    let header;
    await withFetch(
      async (_url, options) => {
        header = options.headers['X-Guest-Cart-Token'];
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      },
      () => proxy(mockReq('GET', path, {
        host: 'suvera-web.vercel.app', 'x-forwarded-proto': 'https', cookie: 'suveraGuestCart=GUESTTOKEN',
      }), new MockRes()),
    );
    return header;
  }
  assert.equal(await forwarded('cart'), 'GUESTTOKEN');
  assert.equal(await forwarded('cart/items'), 'GUESTTOKEN');
  assert.equal(await forwarded('orders'), 'GUESTTOKEN');
  assert.equal(await forwarded('payment/initialize'), 'GUESTTOKEN');
  assert.equal(await forwarded('products'), undefined);
  assert.equal(await forwarded('wishlist?organizationSlug=suvera'), undefined);
});

test('guest_cart_token in a cart response moves to an HttpOnly cookie and leaves the body', async () => {
  const res = new MockRes();
  await withFetch(
    async () => new Response(JSON.stringify({ cart: { id: 'c1', version: 1 }, guest_cart_token: 'RAWGUEST' }), {
      status: 201, headers: { 'content-type': 'application/json' },
    }),
    () => proxy(mockReq('GET', 'cart', { host: 'suvera-web.vercel.app', 'x-forwarded-proto': 'https' }), res),
  );
  const parsed = JSON.parse(res.bodyText);
  assert.equal(parsed.guest_cart_token, undefined, 'raw token stripped from body');
  assert.ok(parsed.cart, 'cart payload preserved');
  const cookies = [].concat(res.getHeader('set-cookie') || []);
  assert.ok(cookies.some((c) => c.startsWith('suveraGuestCart=RAWGUEST') && /HttpOnly/.test(c) && /SameSite=Lax/i.test(c) && /Secure/.test(c)), 'guest cookie is HttpOnly, SameSite=Lax, Secure');
});

test('empty guest_cart_token (merge) clears the guest cookie', async () => {
  const res = new MockRes();
  await withFetch(
    async () => new Response(JSON.stringify({ cart: { id: 'c1' }, guest_cart_token: '' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }),
    () => proxy(mockReq('GET', 'cart/merge', { host: 'suvera-web.vercel.app', 'x-forwarded-proto': 'https' }), res),
  );
  const cookies = [].concat(res.getHeader('set-cookie') || []);
  assert.ok(cookies.some((c) => c.startsWith('suveraGuestCart=') && /Max-Age=0/.test(c)), 'guest cookie cleared');
});

test('a cart recover response relocates the rotated guest_cart_token into the HttpOnly cookie', async () => {
  const res = new MockRes();
  const req = mockReq('POST', 'cart/recover', { ...SAME_ORIGIN, 'content-type': 'application/json' });
  const p = withFetch(
    async () => new Response(JSON.stringify({ cart: { id: 'c1', version: 1 }, guest_cart_token: 'ROTATED' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }),
    () => proxy(req, res),
  );
  setImmediate(() => req.emit('end'));
  await p;
  const parsed = JSON.parse(res.bodyText);
  assert.equal(parsed.guest_cart_token, undefined, 'rotated token stripped from body');
  assert.ok(parsed.cart, 'cart payload preserved');
  const cookies = [].concat(res.getHeader('set-cookie') || []);
  assert.ok(
    cookies.some((c) => c.startsWith('suveraGuestCart=ROTATED') && /HttpOnly/.test(c) && /SameSite=Lax/i.test(c) && /Secure/.test(c)),
    'rotated guest cookie is HttpOnly, SameSite=Lax, Secure',
  );
});

test('cart merge forwards both the customer bearer and the guest token so a guest cart merges into the account', async () => {
  const res = new MockRes();
  const captured = {};
  const req = mockReq('POST', 'cart/merge', {
    ...SAME_ORIGIN,
    'content-type': 'application/json',
    cookie: 'suveraCustomerToken=CUSTOMER_TOKEN; suveraGuestCart=GUESTTOKEN',
  });
  const p = withFetch(
    async (_url, options) => {
      captured.authorization = options.headers.Authorization;
      captured.guest = options.headers['X-Guest-Cart-Token'];
      return new Response(JSON.stringify({ cart: { id: 'c1', version: 2 }, guest_cart_token: '' }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    () => proxy(req, res),
  );
  setImmediate(() => req.emit('end'));
  await p;
  assert.equal(captured.authorization, 'Bearer CUSTOMER_TOKEN', 'customer bearer forwarded to cart route');
  assert.equal(captured.guest, 'GUESTTOKEN', 'guest token still forwarded so the merge can find the guest cart');
});

test('a signed-in customer cart read forwards the customer cookie as Bearer', async () => {
  const res = new MockRes();
  let authorization = 'UNSET';
  await withFetch(
    async (_url, options) => {
      authorization = options.headers.Authorization;
      return new Response(JSON.stringify({ cart: { id: 'c1', version: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    () => proxy(mockReq('GET', 'cart', {
      host: 'suvera-web.vercel.app', 'x-forwarded-proto': 'https', cookie: 'suveraCustomerToken=CUSTOMER_TOKEN',
    }), res),
  );
  assert.equal(authorization, 'Bearer CUSTOMER_TOKEN');
});

test('the optimistic-concurrency If-Match precondition is forwarded so cart mutations enforce the version', async () => {
  let forwarded = 'UNSET';
  const req = mockReq('PATCH', 'cart/items/9', { ...SAME_ORIGIN, 'content-type': 'application/json', 'if-match': '2' });
  const p = withFetch(
    async (_url, options) => {
      forwarded = options.headers['If-Match'];
      return new Response(JSON.stringify({ cart: { id: 'c1', version: 3 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    () => proxy(req, new MockRes()),
  );
  setImmediate(() => req.emit('end'));
  await p;
  assert.equal(forwarded, '2');
});

test('the conditional-cache If-None-Match precondition is forwarded for public catalog revalidation', async () => {
  let forwarded = 'UNSET';
  const res = new MockRes();
  await withFetch(
    async (_url, options) => {
      forwarded = options.headers['If-None-Match'];
      return new Response(null, { status: 304, headers: { etag: '"tenant-catalog"' } });
    },
    () => proxy(mockReq('GET', 'catalog/products?organizationSlug=suvera', {
      host: 'suvera-web.vercel.app',
      'x-forwarded-proto': 'https',
      'if-none-match': '"tenant-catalog"',
    }), res),
  );
  assert.equal(forwarded, '"tenant-catalog"');
  assert.equal(res.statusCode, 304);
  assert.equal(res.getHeader('etag'), '"tenant-catalog"');
});

test('a signed-in customer review request forwards the customer cookie as Bearer', async () => {
  const res = new MockRes();
  const captured = {};
  const req = mockReq('POST', 'reviews/product/5', { ...SAME_ORIGIN, 'content-type': 'application/json', cookie: 'suveraCustomerToken=CUSTOMER_TOKEN; suveraGuestCart=GUESTTOKEN' });
  const p = withFetch(
    async (_url, options) => {
      captured.authorization = options.headers.Authorization;
      captured.guest = options.headers['X-Guest-Cart-Token'];
      return new Response(JSON.stringify({ review: { id: 1 } }), { status: 201, headers: { 'content-type': 'application/json' } });
    },
    () => proxy(req, res),
  );
  setImmediate(() => req.emit('end'));
  await p;
  assert.equal(captured.authorization, 'Bearer CUSTOMER_TOKEN');
  assert.equal(captured.guest, 'GUESTTOKEN'); // guest identity also reaches review votes
});

test('the customer cookie is scoped to customer/cart routes and never leaks to public catalog routes', async () => {
  const res = new MockRes();
  let authorization = 'UNSET';
  await withFetch(
    async (_url, options) => {
      authorization = options.headers.Authorization;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
    () => proxy(mockReq('GET', 'products', {
      host: 'suvera-web.vercel.app', 'x-forwarded-proto': 'https', cookie: 'suveraCustomerToken=CUSTOMER_TOKEN',
    }), res),
  );
  assert.equal(authorization, undefined);
});

// --- A28 theme preview token relocation ---

test('the preview token is moved into an HttpOnly session cookie and stripped from the body', async () => {
  const res = new MockRes();
  await withFetch(
    async () => new Response(JSON.stringify({ theme: { version_id: 4 }, preview: true, preview_session_token: 'RAWPREVIEW' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }),
    () => {
      const req = mockReq('POST', 'storefront-theme/preview', {
        host: 'suvera-web.vercel.app', 'x-forwarded-proto': 'https', origin: 'https://suvera-web.vercel.app',
        'content-type': 'application/json',
      });
      const pending = proxy(req, res);
      setImmediate(() => { req.emit('data', Buffer.from('{"token":"RAWPREVIEW"}')); req.emit('end'); });
      return pending;
    },
  );
  const parsed = JSON.parse(res.bodyText);
  assert.equal(parsed.preview_session_token, undefined, 'raw preview token never reaches JS');
  assert.ok(parsed.theme, 'theme payload preserved');
  const cookies = [].concat(res.getHeader('set-cookie') || []);
  const cookie = cookies.find((c) => c.startsWith('suveraThemePreview='));
  assert.ok(cookie, 'preview cookie set');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Secure/);
  assert.doesNotMatch(cookie, /Max-Age/, 'a session cookie, so the token never lands in the persistent jar');
});

test('the preview cookie is replayed only to the preview stylesheet, never to other routes', async () => {
  async function forwarded(path) {
    let header;
    await withFetch(
      async (_url, options) => {
        header = options.headers['X-Theme-Preview-Token'];
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      },
      () => proxy(mockReq('GET', path, {
        host: 'suvera-web.vercel.app', 'x-forwarded-proto': 'https', cookie: 'suveraThemePreview=PREVIEWTOKEN',
      }), new MockRes()),
    );
    return header;
  }
  assert.equal(await forwarded('storefront-theme/preview.css'), 'PREVIEWTOKEN');
  assert.equal(await forwarded('storefront-theme/preview.css?organizationSlug=suvera'), 'PREVIEWTOKEN');
  assert.equal(await forwarded('storefront-theme/theme.css'), undefined, 'the published sheet is never a preview');
  assert.equal(await forwarded('storefront-theme'), undefined);
  assert.equal(await forwarded('products'), undefined);
  assert.equal(await forwarded('orders'), undefined);
});
