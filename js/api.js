(function () {
  'use strict';

  const API_BASE = window.PANELYA_API_BASE || window.SUVERA_API_BASE || '/api';
  const ORGANIZATION_SLUG = String(window.SUVERA_ORGANIZATION_SLUG || 'suvera').trim();
  const PUBLIC_ACCESS_TOKEN = String(window.SUVERA_PUBLIC_ACCESS_TOKEN || '').trim();
  const CUSTOMER_SESSION_KEY = 'suveraCustomerSession';
  // FIX: Dedupe short-lived storefront GETs that are triggered by multiple renderers.
  const GET_CACHE_TTL_MS = 15000;
  const getCache = new Map();

  function withOrganizationPayload(payload) {
    const nextPayload = {
      organizationSlug: ORGANIZATION_SLUG,
      ...(payload && typeof payload === 'object' ? payload : {}),
    };

    if (PUBLIC_ACCESS_TOKEN && !nextPayload.publicAccessToken) {
      nextPayload.publicAccessToken = PUBLIC_ACCESS_TOKEN;
    }

    return nextPayload;
  }

  function cacheKey(path, headers) {
    return [
      API_BASE,
      path,
      headers.Authorization || '',
      headers['x-public-access-token'] || '',
    ].join('|');
  }

  function clearGetCache() {
    getCache.clear();
  }

  async function request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const isFormData = options.body instanceof FormData;
    const headers = {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {}),
    };

    if (PUBLIC_ACCESS_TOKEN && !headers['x-public-access-token']) {
      headers['x-public-access-token'] = PUBLIC_ACCESS_TOKEN;
    }

    if (method !== 'GET') clearGetCache();

    const key = method === 'GET' && options.cache !== 'no-store' ? cacheKey(path, headers) : '';
    if (key) {
      const cached = getCache.get(key);
      if (cached && Date.now() - cached.createdAt < GET_CACHE_TTL_MS) {
        return cached.promise;
      }
      getCache.delete(key);
    }

    const resultPromise = fetch(`${API_BASE}${path}`, {
      ...options,
      method,
      headers,
      credentials: 'same-origin',
    }).then(async function (response) {

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const error = new Error(body.error || `API hatası: ${response.status}`);
        error.status = response.status;
        error.code = body.code || null;
        error.details = body.details || null;
        throw error;
      }

      if (response.status === 204) return null;
      return response.json();
    });

    if (key) {
      getCache.set(key, { createdAt: Date.now(), promise: resultPromise });
      resultPromise.catch(function () {
        const cached = getCache.get(key);
        if (cached && cached.promise === resultPromise) getCache.delete(key);
      });
    }

    return resultPromise;
  }

  function hasCustomerSession() {
    try {
      return localStorage.getItem(CUSTOMER_SESSION_KEY) === 'active';
    } catch (_) {
      return false;
    }
  }

  function rememberCustomerSession() {
    try {
      localStorage.setItem(CUSTOMER_SESSION_KEY, 'active');
    } catch (_) {}
  }

  function forgetCustomerSession() {
    try {
      localStorage.removeItem(CUSTOMER_SESSION_KEY);
    } catch (_) {}
  }

  function customerToken() {
    return hasCustomerSession() ? 'httpOnly-cookie' : '';
  }

  function customerRequest(path, options = {}) {
    return request(path, { ...options, headers: { ...(options.headers || {}) } });
  }

  async function login(email, password) {
    const result = await request('/auth/session/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, organizationSlug: ORGANIZATION_SLUG }),
    });
    return result;
  }

  function logout() {
    return request('/auth/session/logout', { method: 'POST' }).catch(() => null);
  }

  function saveCustomerSession(result) {
    if (result && result.account) rememberCustomerSession();
    if (result && result.account && window.Suvera && window.Suvera.saveProfile) {
      window.Suvera.saveProfile(result.account);
    }
    return result;
  }

  // After a successful login/registration, merge the guest cart into the customer
  // cart server-side (guest token is revoked by the merge). Best-effort: auth still
  // succeeds if merge fails, and the customer cart is refreshed for the next view.
  async function mergeGuestCartAfterAuth(result) {
    if (result && result.account && window.SuveraAPI && window.SuveraAPI.cart) {
      try {
        const merged = await window.SuveraAPI.cart.merge();
        if (window.Suvera && window.Suvera.mirrorServerCart && merged && merged.cart) {
          window.Suvera.mirrorServerCart(merged.cart);
        }
        if (window.SuveraCartUI && window.SuveraCartUI.sync) await window.SuveraCartUI.sync({ render: true });
      } catch (_) { /* merge is best-effort */ }
    }
    // A24.1: merge the guest recently-viewed history into the account (best-effort).
    if (result && result.account && window.SuveraRecentlyViewed && window.SuveraRecentlyViewed.mergeAfterLogin) {
      try { await window.SuveraRecentlyViewed.mergeAfterLogin(); } catch (_) { /* best effort */ }
    }
    // A24.4: merge the guest comparison list into the account (best-effort).
    if (result && result.account && window.SuveraComparison && window.SuveraComparison.mergeAfterLogin) {
      try { await window.SuveraComparison.mergeAfterLogin(); } catch (_) { /* best effort */ }
    }
    return result;
  }

  function logoutCustomer() {
    forgetCustomerSession();
    return request('/customer-auth/logout', {
      method: 'POST',
    }).catch(() => null);
  }

  async function currentCustomer() {
    try {
      return saveCustomerSession(await customerRequest(
        '/customer-auth/me?' + new URLSearchParams(withOrganizationPayload({})).toString(),
        { cache: 'no-store' }
      ));
    } catch (err) {
      forgetCustomerSession();
      throw err;
    }
  }

  function assetUrl(url) {
    const value = String(url || '').trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value) || /^blob:/i.test(value)) return value;
    // FIX: Block data/javascript/file asset URLs before API content reaches DOM attributes.
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return '';

    const assetBase = String(
      window.PANELYA_ASSET_BASE ||
      (API_BASE === '/api' ? 'https://panelya-api-production.up.railway.app' : API_BASE.replace(/\/api\/?$/, ''))
    ).replace(/\/$/, '');

    if (value.startsWith('/api/media/')) {
      return API_BASE === '/api' ? value : assetBase + value;
    }
    if (value.startsWith('/uploads/')) return assetBase + value;
    if (value.startsWith('uploads/')) return assetBase + '/' + value;
    if (value.startsWith('/')) return assetBase + value;
    return assetBase + '/uploads/' + value;
  }

  function mediaVariantUrl(url, variant) {
    const resolved = assetUrl(url);
    if (!resolved || !['thumbnail', 'card', 'detail'].includes(variant)) return resolved;
    return resolved.replace(
      /(\/api\/media\/[0-9a-f-]{36}\/)(?:thumbnail|card|detail)(?=([?#]|$))/i,
      '$1' + variant
    );
  }

  function responsiveImage(url, purpose) {
    const resolved = assetUrl(url);
    const isManaged = /\/api\/media\/[0-9a-f-]{36}\/(?:thumbnail|card|detail)(?:[?#]|$)/i.test(resolved);
    if (!isManaged) return { src: resolved, srcset: '', sizes: '' };
    const mode = purpose === 'detail' ? 'detail' : (purpose === 'thumbnail' ? 'thumbnail' : 'card');
    return {
      src: mediaVariantUrl(resolved, mode),
      srcset: [
        mediaVariantUrl(resolved, 'thumbnail') + ' 320w',
        mediaVariantUrl(resolved, 'card') + ' 800w',
        mediaVariantUrl(resolved, 'detail') + ' 1600w',
      ].join(', '),
      sizes: mode === 'detail' ? '(max-width: 760px) 100vw, 50vw' : '(max-width: 760px) 50vw, 320px',
    };
  }

  function withOrganizationSlug(path) {
    if (!ORGANIZATION_SLUG) return path;
    const divider = path.includes('?') ? '&' : '?';
    return `${path}${divider}organizationSlug=${encodeURIComponent(ORGANIZATION_SLUG)}`;
  }

  function ifMatch(version) {
    return version == null || version === '' ? {} : { 'If-Match': String(version) };
  }

  function cartToOrderPayload(cart, customer) {
    const items = (cart || []).map((item) => ({
      product_id: item.product_id || item.id || null,
      variant_id: item.variant_id || item.variantId || null,
      name: item.name || 'Ürün',
      quantity: item.qty || item.quantity || 1,
      unit_price: item.price || item.unit_price || 0,
    }));

    return {
      customer,
      items,
      total: items.reduce((sum, item) => sum + Number(item.unit_price || 0) * Number(item.quantity || 1), 0),
    };
  }

  window.SuveraAPI = {
    base: API_BASE,
    assetUrl,
    mediaVariantUrl,
    responsiveImage,
    login,
    logout,
    customerToken,
    hasCustomerSession,
    logoutCustomer,
    request,
    clearGetCache,
    organization: {
      current: () => request(withOrganizationSlug('/organizations/current')),
    },
    products: {
      list: (params = '') => request(withOrganizationSlug(`/products${params}`)),
      get: (id, options = {}) => request(withOrganizationSlug(`/products/${id}`), options),
      create: (product) => request('/products', { method: 'POST', body: JSON.stringify(product) }),
      update: (id, product) => request(`/products/${id}`, { method: 'PUT', body: JSON.stringify(product) }),
      remove: (id) => request(`/products/${id}`, { method: 'DELETE' }),
    },
    catalog: {
      search: (params = {}) => {
        const query = params instanceof URLSearchParams
          ? params.toString()
          : new URLSearchParams(params).toString();
        return request(withOrganizationSlug(`/catalog/products${query ? `?${query}` : ''}`));
      },
      // A24.2: related / complementary / upsell products for a product page (curated
      // by the admin, else a deterministic same-category/collection fallback).
      related: (productId, type = 'related', limit) => {
        const params = new URLSearchParams({ product_id: String(productId), type });
        if (limit) params.set('limit', String(limit));
        return request(withOrganizationSlug(`/catalog/related?${params.toString()}`));
      },
      // A24.1/A24.4: ordered public cards for an explicit id list (recently viewed / compare).
      byIds: (ids) => request(withOrganizationSlug(`/catalog/by-ids?ids=${encodeURIComponent((ids || []).join(','))}`)),
      // A24.3: the resolved size guide for a product (override, else category default).
      sizeGuide: (productId) => request(withOrganizationSlug(`/catalog/size-guide?product_id=${encodeURIComponent(productId)}`)),
    },
    recentlyViewed: {
      // Server-canonical history for signed-in customers; guests use local storage only.
      list: (exclude, limit) => {
        const params = new URLSearchParams();
        if (exclude) params.set('exclude', String(exclude));
        if (limit) params.set('limit', String(limit));
        const query = params.toString();
        return request(withOrganizationSlug(`/recently-viewed${query ? `?${query}` : ''}`));
      },
      record: (productId) => request(withOrganizationSlug('/recently-viewed'), { method: 'POST', body: JSON.stringify({ product_id: Number(productId) }) }),
      clear: () => request(withOrganizationSlug('/recently-viewed'), { method: 'DELETE' }),
      merge: (items) => request(withOrganizationSlug('/recently-viewed/merge'), { method: 'POST', body: JSON.stringify({ items: items || [] }) }),
    },
    comparison: {
      // Server-canonical for signed-in customers; guests keep the list in localStorage.
      list: () => request(withOrganizationSlug('/comparison')),
      add: (productId) => request(withOrganizationSlug('/comparison'), { method: 'POST', body: JSON.stringify({ product_id: Number(productId) }) }),
      remove: (productId) => request(withOrganizationSlug(`/comparison/${encodeURIComponent(productId)}`), { method: 'DELETE' }),
      clear: () => request(withOrganizationSlug('/comparison'), { method: 'DELETE' }),
      merge: (items) => request(withOrganizationSlug('/comparison/merge'), { method: 'POST', body: JSON.stringify({ items: items || [] }) }),
    },
    categories: {
      list: () => request(withOrganizationSlug('/categories')),
      create: (category) => request('/categories', { method: 'POST', body: JSON.stringify(category) }),
      remove: (id) => request(`/categories/${id}`, { method: 'DELETE' }),
    },
    orders: {
      list: (params = '') => request(`/orders${params}`),
      create: (payload, idempotencyKey = '') => request('/orders', {
        method: 'POST',
        headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
        body: JSON.stringify(withOrganizationPayload(payload)),
      }),
      lookup: (orderCode, email) => request('/orders/lookup?' + new URLSearchParams(withOrganizationPayload({ orderCode, email })).toString()),
      updateStatus: (id, status) => request(`/orders/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
      updateShipping: (id, payload) => request(`/orders/${id}/shipping`, { method: 'PUT', body: JSON.stringify(payload) }),
    },
    cart: {
      // Server-canonical cart. The opaque guest token rides in an HttpOnly cookie
      // set by the same-origin proxy, so no token handling is needed here.
      get: () => request(withOrganizationSlug('/cart')),
      addItem: (payload) => request(withOrganizationSlug('/cart/items'), { method: 'POST', body: JSON.stringify(payload || {}) }),
      setQuantity: (variantId, quantity, version) => request(withOrganizationSlug(`/cart/items/${variantId}`), { method: 'PATCH', headers: ifMatch(version), body: JSON.stringify({ quantity }) }),
      removeItem: (variantId, version) => request(withOrganizationSlug(`/cart/items/${variantId}`), { method: 'DELETE', headers: ifMatch(version) }),
      clear: (version) => request(withOrganizationSlug('/cart/clear'), { method: 'POST', headers: ifMatch(version), body: JSON.stringify({}) }),
      applyCoupon: (code, version) => request(withOrganizationSlug('/cart/coupon'), { method: 'POST', headers: ifMatch(version), body: JSON.stringify({ coupon_code: code }) }),
      removeCoupon: (version) => request(withOrganizationSlug('/cart/coupon'), { method: 'DELETE', headers: ifMatch(version) }),
      // A24.5 gift wrap: options and their fees are read from the server, and the
      // selection is stored on the server cart (the client never sends a fee).
      giftOptions: () => request(withOrganizationSlug('/cart/gift-options')),
      setGiftWrap: (payload, version) => request(withOrganizationSlug('/cart/gift-wrap'), { method: 'PUT', headers: ifMatch(version), body: JSON.stringify(payload || {}) }),
      clearGiftWrap: (version) => request(withOrganizationSlug('/cart/gift-wrap'), { method: 'DELETE', headers: ifMatch(version) }),
      merge: () => request(withOrganizationSlug('/cart/merge'), { method: 'POST', body: JSON.stringify({}) }),
      recover: (token) => request(withOrganizationSlug('/cart/recover'), { method: 'POST', body: JSON.stringify({ token }) }),
    },
    reviews: {
      list: (productId, params = '') => request(withOrganizationSlug(`/reviews/product/${productId}${params}`)),
      create: (productId, payload) => request(withOrganizationSlug(`/reviews/product/${productId}`), { method: 'POST', body: JSON.stringify(payload || {}) }),
      vote: (reviewId, voteType) => request(withOrganizationSlug(`/reviews/${reviewId}/vote`), { method: 'POST', body: JSON.stringify({ vote_type: voteType }) }),
    },
    questions: {
      list: (productId, params = '') => request(withOrganizationSlug(`/questions/product/${productId}${params}`)),
      ask: (productId, payload) => request(withOrganizationSlug(`/questions/product/${productId}`), { method: 'POST', body: JSON.stringify(payload || {}) }),
    },
    notifications: {
      // Guests subscribe with an email + explicit consent (double opt-in); signed-in
      // customers activate immediately. The confirm/unsubscribe tokens are only ever
      // emailed — they are never returned to or stored by the browser.
      subscribe: (payload) => request(withOrganizationSlug('/notifications/subscriptions'), { method: 'POST', body: JSON.stringify(payload || {}) }),
      listSubscriptions: () => request(withOrganizationSlug('/notifications/subscriptions')),
      cancelSubscription: (id) => request(withOrganizationSlug(`/notifications/subscriptions/${id}/cancel`), { method: 'POST', body: JSON.stringify({}) }),
      confirm: (token) => request(withOrganizationSlug('/notifications/confirm'), { method: 'POST', body: JSON.stringify({ token }) }),
      unsubscribe: (token) => request(withOrganizationSlug('/notifications/unsubscribe'), { method: 'POST', body: JSON.stringify({ token }) }),
      preferences: () => request(withOrganizationSlug('/notifications/preferences')),
      updatePreferences: (changes) => request(withOrganizationSlug('/notifications/preferences'), { method: 'PUT', body: JSON.stringify({ changes: changes || [] }) }),
      consents: () => request(withOrganizationSlug('/notifications/consents')),
      grantConsent: (channel, purpose) => request(withOrganizationSlug('/notifications/consents/grant'), { method: 'POST', body: JSON.stringify({ channel, purpose }) }),
      revokeConsent: (channel, purpose) => request(withOrganizationSlug('/notifications/consents/revoke'), { method: 'POST', body: JSON.stringify({ channel, purpose }) }),
      optOutMarketing: () => request(withOrganizationSlug('/notifications/marketing/opt-out'), { method: 'POST', body: JSON.stringify({}) }),
    },
    payment: {
      initialize: (payload, idempotencyKey = '') => request('/payment/initialize', {
        method: 'POST',
        headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
        body: JSON.stringify(withOrganizationPayload(payload)),
      }),
      callback: (payload) => request('/payment/callback', { method: 'POST', body: JSON.stringify(withOrganizationPayload(payload)) }),
    },
    customers: {
      list: (params = '') => request(`/customers${params}`),
      account: (email, orderCode) => {
        const params = new URLSearchParams(withOrganizationPayload({ email, orderCode })).toString();
        return customerRequest('/customers/account?' + params);
      },
    },
    // A25: signed-in customer address book. Auth rides in the HttpOnly customer cookie
    // (same-origin proxy injects the bearer); no token handling here.
    addresses: {
      list: () => customerRequest(withOrganizationSlug('/customer-addresses'), { cache: 'no-store' }),
      create: (payload) => customerRequest(withOrganizationSlug('/customer-addresses'), { method: 'POST', body: JSON.stringify(payload || {}) }),
      update: (id, payload) => customerRequest(withOrganizationSlug('/customer-addresses/' + encodeURIComponent(id)), { method: 'PUT', body: JSON.stringify(payload || {}) }),
      remove: (id) => customerRequest(withOrganizationSlug('/customer-addresses/' + encodeURIComponent(id)), { method: 'DELETE' }),
      setDefault: (id, kind) => customerRequest(withOrganizationSlug('/customer-addresses/' + encodeURIComponent(id) + '/default'), { method: 'POST', body: JSON.stringify({ kind }) }),
    },
    // A25: guest order -> account linking. The request is generic (no order enumeration);
    // the single-use token is only ever emailed to the order's on-file address.
    orderClaim: {
      request: (orderCode) => customerRequest(withOrganizationSlug('/customer-orders/claim/request'), { method: 'POST', body: JSON.stringify({ order_code: orderCode }) }),
      confirm: (token) => customerRequest(withOrganizationSlug('/customer-orders/claim/confirm'), { method: 'POST', body: JSON.stringify({ token }) }),
    },
    customerAuth: {
      register: (payload) => request('/customer-auth/register', { method: 'POST', body: JSON.stringify(withOrganizationPayload(payload)) }).then(saveCustomerSession).then(mergeGuestCartAfterAuth),
      login: (payload) => request('/customer-auth/login', { method: 'POST', body: JSON.stringify(withOrganizationPayload(payload)) }).then(saveCustomerSession).then(mergeGuestCartAfterAuth),
      me: currentCustomer,
      requestReset: (email) => request('/customer-auth/password-reset/request', { method: 'POST', body: JSON.stringify(withOrganizationPayload({ email })) }),
      confirmReset: (token, password) => request('/customer-auth/password-reset/confirm', { method: 'POST', body: JSON.stringify(withOrganizationPayload({ token, password })) }),
      verifyEmail: (token) => request('/customer-auth/verify-email', { method: 'POST', body: JSON.stringify(withOrganizationPayload({ token })) }),
      resendVerification: (email) => request('/customer-auth/resend-verification', { method: 'POST', body: JSON.stringify(withOrganizationPayload({ email })) }),
      requestEmailChange: (newEmail, password) => request('/customer-auth/email-change/request', { method: 'POST', body: JSON.stringify(withOrganizationPayload({ new_email: newEmail, password })) }),
      confirmEmailChange: (token) => request('/customer-auth/email-change/confirm', { method: 'POST', body: JSON.stringify(withOrganizationPayload({ token })) }),
    },
    newsletter: {
      subscribe: (email) => request('/customer-auth/newsletter/subscribe', { method: 'POST', body: JSON.stringify(withOrganizationPayload({ email })) }),
    },
    slider: {
      list: () => request(withOrganizationSlug('/slider')),
      adminList: () => request('/slider/admin/all'),
      create: (slide) => request('/slider', { method: 'POST', body: JSON.stringify(slide) }),
      update: (id, slide) => request(`/slider/${id}`, { method: 'PUT', body: JSON.stringify(slide) }),
      remove: (id) => request(`/slider/${id}`, { method: 'DELETE' }),
    },
    campaigns: {
      list: () => request(withOrganizationSlug('/campaigns')),
      adminList: () => request('/campaigns/admin/all'),
      create: (campaign) => request('/campaigns', { method: 'POST', body: JSON.stringify(campaign) }),
      update: (id, campaign) => request(`/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(campaign) }),
      remove: (id) => request(`/campaigns/${id}`, { method: 'DELETE' }),
    },
    returns: {
      list: () => customerRequest('/returns/customer?' + new URLSearchParams(withOrganizationPayload({})).toString(), { cache: 'no-store' }),
      detail: (id) => customerRequest('/returns/customer/' + encodeURIComponent(id) + '?' + new URLSearchParams(withOrganizationPayload({})).toString(), { cache: 'no-store' }),
      create: (payload) => customerRequest('/returns/customer', {
        method: 'POST',
        body: JSON.stringify(withOrganizationPayload(payload)),
      }),
    },
    coupons: {
      evaluate: (payload) => request('/coupons/evaluate', {
        method: 'POST',
        body: JSON.stringify(withOrganizationPayload(payload)),
      }),
    },
    collections: {
      list: () => request(withOrganizationSlug('/collections')),
      adminList: () => request('/collections/admin/all'),
      create: (collection) => request('/collections', { method: 'POST', body: JSON.stringify(collection) }),
      update: (id, collection) => request(`/collections/${id}`, { method: 'PUT', body: JSON.stringify(collection) }),
      remove: (id) => request(`/collections/${id}`, { method: 'DELETE' }),
    },
    blog: {
      list: () => request(withOrganizationSlug('/blog')),
      get: (idOrSlug) => request(withOrganizationSlug('/blog/' + encodeURIComponent(idOrSlug))),
      adminList: () => request('/blog/admin/all'),
      create: (post) => request('/blog', { method: 'POST', body: JSON.stringify(post) }),
      update: (id, post) => request(`/blog/${id}`, { method: 'PUT', body: JSON.stringify(post) }),
      remove: (id) => request(`/blog/${id}`, { method: 'DELETE' }),
    },
    wishlist: {
      list: (email) => request('/wishlist?' + new URLSearchParams(withOrganizationPayload({ email })).toString()),
      add: (email, productId) => request('/wishlist', { method: 'POST', body: JSON.stringify(withOrganizationPayload({ email, productId })) }),
      remove: (email, productId) => request('/wishlist/' + encodeURIComponent(productId) + '?' + new URLSearchParams(withOrganizationPayload({ email })).toString(), { method: 'DELETE' }),
    },
    upload: {
      images: (files) => {
        const form = new FormData();
        Array.from(files || []).forEach((file) => form.append('images', file));
        return request('/upload', { method: 'POST', body: form });
      },
    },
    cartToOrderPayload,
  };
})();
