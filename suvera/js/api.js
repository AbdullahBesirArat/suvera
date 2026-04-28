(function () {
  'use strict';

  const API_BASE = window.PANELYA_API_BASE || window.SUVERA_API_BASE ||
    (['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://localhost:3000/api' : '/api');
  const TOKEN_KEY = 'suveraAccessToken';
  const REFRESH_TOKEN_KEY = 'suveraRefreshToken';
  const CUSTOMER_TOKEN_KEY = 'suveraCustomerToken';
  const ORGANIZATION_SLUG = String(window.SUVERA_ORGANIZATION_SLUG || 'suvera').trim();
  const PUBLIC_ACCESS_TOKEN = String(window.SUVERA_PUBLIC_ACCESS_TOKEN || '').trim();

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

  function token() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  async function request(path, options = {}) {
    const isFormData = options.body instanceof FormData;
    const headers = {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {}),
    };

    const jwt = token();
    if (jwt && !headers.Authorization) headers.Authorization = `Bearer ${jwt}`;
    if (PUBLIC_ACCESS_TOKEN && !headers['x-public-access-token']) {
      headers['x-public-access-token'] = PUBLIC_ACCESS_TOKEN;
    }

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `API hatası: ${response.status}`);
    }

    if (response.status === 204) return null;
    return response.json();
  }

  function customerToken() {
    return localStorage.getItem(CUSTOMER_TOKEN_KEY) || '';
  }

  function customerRequest(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const token = customerToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return request(path, { ...options, headers });
  }

  async function login(email, password) {
    const result = await request('/auth/session/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, organizationSlug: ORGANIZATION_SLUG }),
    });
    localStorage.setItem(TOKEN_KEY, result.accessToken || '');
    if (result.refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, result.refreshToken);
    return result;
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }

  function saveCustomerSession(result) {
    if (result && result.accessToken) {
      localStorage.setItem(CUSTOMER_TOKEN_KEY, result.accessToken);
    }
    if (result && result.account && window.Suvera && window.Suvera.saveProfile) {
      window.Suvera.saveProfile(result.account);
    }
    return result;
  }

  function logoutCustomer() {
    const token = customerToken();
    localStorage.removeItem(CUSTOMER_TOKEN_KEY);
    if (!token) return Promise.resolve(null);
    return request('/customer-auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);
  }

  function assetUrl(url) {
    const value = String(url || '').trim();
    if (!value || /^(https?:|data:|blob:)/i.test(value)) return value;

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
    organization: {
      current: () => request(withOrganizationSlug('/organizations/current')),
    },
    products: {
      list: (params = '') => request(withOrganizationSlug(`/products${params}`)),
      get: (id) => request(withOrganizationSlug(`/products/${id}`)),
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
