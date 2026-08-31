// A24.4 product comparison. Guests keep the list (product ids only) in localStorage and
// a shareable ?ids= URL; signed-in customers also sync to a server-canonical list, and
// the guest list merges on login. CSP-safe: everything is built with
// createElement/textContent and each product link is a real <a>.
(function () {
  'use strict';

  const STORAGE_KEY = 'suvera:comparison:v1';
  const MAX = 4;

  const preferencesAllowed = () => !window.SuveraConsent || window.SuveraConsent.allows('preferences');

  function parseIds(raw) {
    return [...new Set(String(raw || '').split(',').map((v) => Number(v.trim())).filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX);
  }

  function readLocal() {
    if (!preferencesAllowed()) return [];
    try {
      const list = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(list) ? parseIds(list.join(',')) : [];
    } catch (_) {
      return [];
    }
  }

  function writeLocal(ids) {
    if (!preferencesAllowed()) return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parseIds(ids.join(',')))); } catch (_) { /* ignore */ }
  }

  function signedIn() {
    return Boolean(window.SuveraAPI && window.SuveraAPI.hasCustomerSession && window.SuveraAPI.hasCustomerSession());
  }
  const server = () => (window.SuveraAPI && window.SuveraAPI.comparison ? window.SuveraAPI.comparison : null);

  async function add(id) {
    const list = readLocal();
    if (list.includes(id) || list.length >= MAX) return list;
    const next = [...list, id].slice(0, MAX);
    writeLocal(next);
    if (signedIn() && server()) { try { await server().add(id); } catch (_) { /* best effort */ } }
    reflect();
    return next;
  }
  async function remove(id) {
    const next = readLocal().filter((value) => value !== id);
    writeLocal(next);
    if (signedIn() && server()) { try { await server().remove(id); } catch (_) { /* best effort */ } }
    reflect();
    return next;
  }
  async function mergeAfterLogin() {
    const local = readLocal();
    if (!local.length || !server()) return;
    try { await server().merge(local.map((id) => ({ product_id: id }))); } catch (_) { /* best effort */ }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  // --- product page: toggle + floating bar -------------------------------

  function currentProductId() {
    const raw = new URLSearchParams(window.location.search).get('id');
    return raw ? Number(raw) : null;
  }

  function reflect() {
    const toggle = document.getElementById('compareToggle');
    const ids = readLocal();
    if (toggle) {
      const id = currentProductId();
      const inList = id != null && ids.includes(id);
      toggle.textContent = inList ? 'Karşılaştırmadan çıkar' : 'Karşılaştır';
      toggle.setAttribute('aria-pressed', inList ? 'true' : 'false');
    }
    const bar = document.getElementById('compareBar');
    if (bar) {
      const count = document.getElementById('compareBarCount');
      const link = document.getElementById('compareBarLink');
      if (count) count.textContent = String(ids.length);
      if (link) link.href = `karsilastir?ids=${ids.join(',')}`;
      bar.hidden = ids.length === 0;
    }
  }

  function bindProductPage() {
    const toggle = document.getElementById('compareToggle');
    if (!toggle) return;
    toggle.addEventListener('click', async function () {
      const id = currentProductId();
      if (!id) return;
      if (readLocal().includes(id)) await remove(id);
      else await add(id);
    });
    reflect();
  }

  // --- comparison page ----------------------------------------------------

  // Seed local storage from a shared ?ids= URL once on load; after that local storage is
  // the source of truth so removals stick (the URL is kept in sync as the list changes).
  function seedFromUrl() {
    if (!document.getElementById('compareGrid')) return;
    const urlIds = parseIds(new URLSearchParams(window.location.search).get('ids'));
    if (urlIds.length) writeLocal(urlIds);
  }

  async function currentCompareIds() {
    if (signedIn() && server()) {
      try {
        const data = await server().list();
        const ids = parseIds((data.items || []).map((item) => item.id).join(','));
        if (ids.length) return ids;
      } catch (_) { /* fall back to local */ }
    }
    return readLocal();
  }

  function imageCell(product) {
    // Same colour-aware entry shapes as the product cards; assetUrl normalizes each one.
    const images = Array.isArray(product.images) ? product.images : [];
    let src = '';
    for (const entry of images) {
      const url = typeof entry === 'string' ? entry : (entry && entry.url) || '';
      const resolved = url && window.SuveraAPI.assetUrl ? window.SuveraAPI.assetUrl(url) : url;
      if (resolved) { src = resolved; break; }
    }
    if (!src) return el('span', 'compare-noimg', '—');
    const img = el('img', 'compare-img');
    img.loading = 'lazy';
    img.alt = product.name || 'Ürün';
    const responsive = window.SuveraAPI.responsiveImage ? window.SuveraAPI.responsiveImage(src, 'card') : null;
    img.src = responsive && responsive.src ? responsive.src : src;
    img.decoding = 'async';
    if (responsive && responsive.srcset) {
      img.srcset = responsive.srcset;
      img.sizes = responsive.sizes;
    }
    return img;
  }

  function buildTable(items) {
    const formatter = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 });
    const table = el('table', 'compare-table');
    const thead = el('thead');
    const headRow = el('tr');
    headRow.appendChild(el('th', 'compare-attr', ''));
    for (const product of items) {
      const th = el('th', 'compare-col');
      th.setAttribute('scope', 'col');
      const link = el('a', 'compare-prod-link', product.name || 'Ürün');
      link.href = `urun?id=${encodeURIComponent(product.id)}`;
      th.appendChild(link);
      const removeBtn = el('button', 'compare-remove', '×');
      removeBtn.type = 'button';
      removeBtn.dataset.remove = String(product.id);
      removeBtn.setAttribute('aria-label', `${product.name || 'Ürün'} karşılaştırmadan çıkar`);
      th.appendChild(removeBtn);
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const rows = [
      ['Görsel', (product) => imageCell(product)],
      ['Fiyat', (product) => formatter.format(Number(product.sale_price || product.price || 0))],
      ['Stok', (product) => (Number(product.stock) > 0 ? 'Stokta' : 'Tükendi')],
      ['Kategori', (product) => product.category_name || '—'],
      ['Renkler', (product) => ((product.colors || []).join(', ') || '—')],
      ['Bedenler', (product) => ((product.sizes || []).join(', ') || '—')],
    ];
    const tbody = el('tbody');
    for (const [label, valueFor] of rows) {
      const tr = el('tr');
      const th = el('th', 'compare-attr', label);
      th.setAttribute('scope', 'row');
      tr.appendChild(th);
      for (const product of items) {
        const td = el('td');
        const value = valueFor(product);
        if (value instanceof Node) td.appendChild(value);
        else td.textContent = String(value);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  }

  async function renderComparePage() {
    const grid = document.getElementById('compareGrid');
    if (!grid) return;
    const empty = document.getElementById('compareEmpty');
    const ids = await currentCompareIds();
    grid.textContent = '';
    let items = [];
    if (ids.length && window.SuveraAPI && window.SuveraAPI.catalog && window.SuveraAPI.catalog.byIds) {
      try { const data = await window.SuveraAPI.catalog.byIds(ids); items = data.items || []; } catch (_) { items = []; }
    }
    if (!items.length) { if (empty) empty.hidden = false; return; }
    if (empty) empty.hidden = true;
    const validIds = items.map((item) => Number(item.id));
    writeLocal(validIds);
    try { window.history.replaceState({}, document.title, `karsilastir?ids=${validIds.join(',')}`); } catch (_) { /* ignore */ }
    grid.appendChild(buildTable(items));
  }

  // Persistent delegated remove handler (bound once, survives re-renders).
  function bindComparePage() {
    const grid = document.getElementById('compareGrid');
    if (!grid) return;
    grid.addEventListener('click', async function (event) {
      const btn = event.target.closest('[data-remove]');
      if (!btn) return;
      await remove(Number(btn.dataset.remove));
      await renderComparePage();
    });
  }

  function init() {
    bindProductPage();
    seedFromUrl();
    bindComparePage();
    void renderComparePage();
  }


  window.SuveraComparison = { STORAGE_KEY, MAX, parseIds, readLocal, writeLocal, add, remove, mergeAfterLogin, reflect };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
