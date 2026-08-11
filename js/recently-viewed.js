// A24.1 recently viewed. Guests keep an id+timestamp list in localStorage (no auth
// token, no profile — only product ids); signed-in customers get a server-canonical
// history, and the guest list is merged on login. CSP-safe: cards are built with
// createElement/textContent and each card is a real <a> for accessibility.
(function () {
  'use strict';

  const STORAGE_KEY = 'suvera:recently-viewed:v1';
  const MAX = 24;
  const TTL_MS = 90 * 24 * 60 * 60 * 1000;

  function readLocal() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      const cutoff = Date.now() - TTL_MS;
      return list
        .map((entry) => ({ id: Number(entry && entry.id), ts: Number(entry && entry.ts) }))
        .filter((entry) => Number.isInteger(entry.id) && entry.id > 0 && entry.ts > cutoff)
        .slice(0, MAX);
    } catch (_) {
      return [];
    }
  }

  function writeLocal(list) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX)));
    } catch (_) { /* storage may be unavailable/full */ }
  }

  // Pure: move id to the front (dedupe), cap to MAX.
  function upsert(list, id, ts) {
    const numeric = Number(id);
    if (!Number.isInteger(numeric) || numeric < 1) return list.slice(0, MAX);
    const rest = list.filter((entry) => Number(entry.id) !== numeric);
    return [{ id: numeric, ts: ts || Date.now() }, ...rest].slice(0, MAX);
  }

  function recordLocal(id) {
    const next = upsert(readLocal(), id);
    writeLocal(next);
    return next;
  }

  function signedIn() {
    return Boolean(window.SuveraAPI && window.SuveraAPI.hasCustomerSession && window.SuveraAPI.hasCustomerSession());
  }

  async function record(id) {
    recordLocal(id);
    if (signedIn() && window.SuveraAPI && window.SuveraAPI.recentlyViewed) {
      try { await window.SuveraAPI.recentlyViewed.record(id); } catch (_) { /* best effort */ }
    }
  }

  // Merge the guest local history into the account on login; server is then canonical.
  async function mergeAfterLogin() {
    if (!window.SuveraAPI || !window.SuveraAPI.recentlyViewed) return;
    const local = readLocal();
    if (!local.length) return;
    try {
      await window.SuveraAPI.recentlyViewed.merge(local.map((entry) => ({
        product_id: entry.id, viewed_at: new Date(entry.ts).toISOString(),
      })));
    } catch (_) { /* best effort */ }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function card(product, formatter) {
    const link = el('a', 'related-card');
    link.href = `urun?id=${encodeURIComponent(product.id)}`;
    const images = Array.isArray(product.images) ? product.images : [];
    const entry = images[0];
    const url = typeof entry === 'string' ? entry : (entry && entry.url) || '';
    const src = url && window.SuveraAPI.assetUrl ? window.SuveraAPI.assetUrl(url) : url;
    if (src) {
      const img = el('img', 'related-card-img');
      img.loading = 'lazy';
      img.alt = product.name || 'Ürün';
      const responsive = window.SuveraAPI.responsiveImage ? window.SuveraAPI.responsiveImage(src, 'card') : null;
      img.src = responsive && responsive.src ? responsive.src : src;
      if (responsive && responsive.srcset) { img.srcset = responsive.srcset; img.sizes = responsive.sizes; }
      link.appendChild(img);
    }
    link.appendChild(el('span', 'related-card-name', product.name || ''));
    link.appendChild(el('span', 'related-card-price', formatter.format(Number(product.sale_price || product.price || 0))));
    return link;
  }

  async function fetchItems(excludeId) {
    const api = window.SuveraAPI;
    if (!api) return [];
    if (signedIn() && api.recentlyViewed) {
      try {
        const data = await api.recentlyViewed.list(excludeId || undefined, 12);
        return (data && data.items) || [];
      } catch (_) { /* fall back to local */ }
    }
    const ids = readLocal().map((entry) => entry.id).filter((id) => id !== Number(excludeId)).slice(0, 12);
    if (!ids.length || !api.catalog || !api.catalog.byIds) return [];
    try {
      const data = await api.catalog.byIds(ids);
      return (data && data.items) || [];
    } catch (_) {
      return [];
    }
  }

  async function render() {
    const grid = document.getElementById('recentlyViewedGrid');
    if (!grid) return;
    const section = grid.closest('.related-section');
    const currentParam = new URLSearchParams(window.location.search).get('id');
    const currentId = currentParam != null ? Number(currentParam) : null;
    const items = await fetchItems(currentId);
    grid.textContent = '';
    const formatter = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 });
    for (const product of items) {
      if (currentId != null && Number(product.id) === currentId) continue;
      grid.appendChild(card(product, formatter));
    }
    if (section) section.hidden = grid.childElementCount === 0;
  }

  async function init() {
    // On a product page, record the current product first; it is excluded from its own list.
    const currentParam = new URLSearchParams(window.location.search).get('id');
    if (document.getElementById('detailProductTitle') && currentParam) {
      await record(currentParam);
    }
    await render();
  }

  window.SuveraRecentlyViewed = {
    STORAGE_KEY, MAX, readLocal, writeLocal, upsert, recordLocal, record, mergeAfterLogin, render,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else void init();
})();
