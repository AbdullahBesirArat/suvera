(function () {
  'use strict';

  const API_BASE = window.PANELYA_API_BASE || window.SUVERA_API_BASE ||
    (['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://localhost:3000/api' : '/api');
  const ORGANIZATION_SLUG = String(window.SUVERA_ORGANIZATION_SLUG || 'suvera').trim();
  const PUBLIC_ACCESS_TOKEN = String(window.SUVERA_PUBLIC_ACCESS_TOKEN || '').trim();
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
        throw new Error(body.error || `API hatası: ${response.status}`);
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

  function customerToken() {
    return 'httpOnly-cookie';
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
    if (result && result.account && window.Suvera && window.Suvera.saveProfile) {
      window.Suvera.saveProfile(result.account);
    }
    return result;
  }

  function logoutCustomer() {
    return request('/customer-auth/logout', {
      method: 'POST',
    }).catch(() => null);
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

    if (value.startsWith('/uploads/')) return assetBase + value;
    if (value.startsWith('uploads/')) return assetBase + '/' + value;
    if (value.startsWith('/')) return assetBase + value;
    return assetBase + '/uploads/' + value;
  }

  function withOrganizationSlug(path) {
    if (!ORGANIZATION_SLUG) return path;
    const divider = path.includes('?') ? '&' : '?';
    return `${path}${divider}organizationSlug=${encodeURIComponent(ORGANIZATION_SLUG)}`;
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
    login,
    logout,
    customerToken,
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
    categories: {
      list: () => request(withOrganizationSlug('/categories')),
      create: (category) => request('/categories', { method: 'POST', body: JSON.stringify(category) }),
      remove: (id) => request(`/categories/${id}`, { method: 'DELETE' }),
    },
    orders: {
      list: (params = '') => request(`/orders${params}`),
      create: (payload) => request('/orders', { method: 'POST', body: JSON.stringify(withOrganizationPayload(payload)) }),
      lookup: (orderCode, email) => request('/orders/lookup?' + new URLSearchParams(withOrganizationPayload({ orderCode, email })).toString()),
      updateStatus: (id, status) => request(`/orders/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
      updateShipping: (id, payload) => request(`/orders/${id}/shipping`, { method: 'PUT', body: JSON.stringify(payload) }),
    },
    payment: {
      initialize: (payload) => request('/payment/initialize', { method: 'POST', body: JSON.stringify(withOrganizationPayload(payload)) }),
      callback: (payload) => request('/payment/callback', { method: 'POST', body: JSON.stringify(withOrganizationPayload(payload)) }),
    },
    customers: {
      list: (params = '') => request(`/customers${params}`),
      account: (email, orderCode) => {
        const params = new URLSearchParams(withOrganizationPayload({ email, orderCode })).toString();
        return customerRequest('/customers/account?' + params);
      },
    },
    customerAuth: {
      register: (payload) => request('/customer-auth/register', { method: 'POST', body: JSON.stringify(withOrganizationPayload(payload)) }).then(saveCustomerSession),
      login: (payload) => request('/customer-auth/login', { method: 'POST', body: JSON.stringify(withOrganizationPayload(payload)) }).then(saveCustomerSession),
      me: () => customerRequest('/customer-auth/me?' + new URLSearchParams(withOrganizationPayload({})).toString()),
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
