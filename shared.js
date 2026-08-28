import { escapeHtml } from './js/core/storefront-utils.js';
/* ═══════════════════════════════════════════════════
   Suvera – Shared JavaScript v2
   Çalıştırma: <script src="shared.js"></script> </body> öncesinde
═══════════════════════════════════════════════════ */

(function() {
  'use strict';

  // ── CART STATE ──────────────────────────────────
  window.Suvera = window.Suvera || {};

  // ── CSP-safe inline style hydration ──────────────
  // Renderers emit data-css="..." instead of style="..." so served markup and
  // innerHTML carry no inline styles under a strict style-src. Declarations are
  // applied here via the CSSOM (not governed by style-src), which preserves the
  // original inline precedence without any 'unsafe-inline' allowance.
  function applyDataCss(el) {
    const css = el.getAttribute('data-css');
    if (css == null) return;
    el.removeAttribute('data-css');
    try { el.style.cssText = css; } catch (_) { /* ignore invalid declaration */ }
  }
  function hydrateDataCss(root) {
    const scope = root && root.nodeType === 1 ? root : document;
    if (scope.nodeType === 1 && scope.hasAttribute && scope.hasAttribute('data-css')) applyDataCss(scope);
    if (scope.querySelectorAll) scope.querySelectorAll('[data-css]').forEach(applyDataCss);
  }
  window.Suvera.hydrateDataCss = hydrateDataCss;
  hydrateDataCss(document);
  if (typeof MutationObserver === 'function') {
    const cssObserver = new MutationObserver(function (mutations) {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) hydrateDataCss(node);
        }
      }
    });
    const startCssObserver = function () {
      cssObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
    };
    if (document.body) startCssObserver();
    else document.addEventListener('DOMContentLoaded', startCssObserver);
  }

  const cart = JSON.parse(localStorage.getItem('suveraCart') || '[]');
  const FAVORITES_KEY = 'suveraFavorites';
  const ORDER_HISTORY_KEY = 'suveraRecentOrders';
  const LAST_ORDER_KEY = 'suveraLastOrder';
  const PROFILE_KEY = 'suveraCustomerProfile';
  const defaultSettings = {
    siteName: 'SUVERA – Modern Tesettür Giyim',
    freeShippingLimit: 600,
    features: {
      newBadge: true,
      favorites: true,
      whatsapp: true,
      maintenance: false,
    },
  };
  const siteSettings = window.SuveraStore && window.SuveraStore.loadSettings
    ? window.SuveraStore.loadSettings(defaultSettings)
    : defaultSettings;

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function productKey(product) {
    return String(
      (product && (product.id || product.product_id || product.productId || product.name)) || ''
    ).trim();
  }

  function normalizeFavorite(product) {
    const id = productKey(product);
    return {
      id,
      name: product.name || 'Suvera Urunu',
      price: Number(product.price || 0),
      image: product.image || '',
      emoji: product.emoji || '',
      category: product.category || product.category_name || '',
      url: product.url || (id ? ('urun?id=' + encodeURIComponent(id)) : 'urun'),
      addedAt: new Date().toISOString(),
    };
  }

  function loadFavorites() {
    return loadJson(FAVORITES_KEY, []);
  }

  function saveFavorites(items) {
    saveJson(FAVORITES_KEY, Array.isArray(items) ? items.slice(0, 50) : []);
  }

  function favoriteIndex(product, items) {
    const key = productKey(product);
    return (items || []).findIndex(function(item) {
      const itemKey = productKey(item);
      return key ? itemKey === key : item.name === product.name;
    });
  }

  function isFavorite(product, items) {
    return favoriteIndex(product, items || loadFavorites()) >= 0;
  }

  function loadProfile() {
    return loadJson(PROFILE_KEY, {});
  }

  function saveProfile(profile) {
    if (!profile || typeof profile !== 'object') return;
    saveJson(PROFILE_KEY, { ...loadProfile(), ...profile });
    updateAccountLinks(true);
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('tr-TR');
  }

  function updateAccountLinks(signedIn) {
    const active = Boolean(signedIn);
    document.querySelectorAll('a[href]').forEach(function(link) {
      const href = String(link.getAttribute('href') || '').replace(/^\.?\//, '').split(/[?#]/)[0];
      if (href !== 'giris' && href !== 'hesabim') return;

      const text = normalizeText(link.textContent);
      const isAccountLink = link.classList.contains('nav-icon-btn') ||
        link.closest('.mobile-nav-footer') ||
        text.includes('hesab');
      if (!isAccountLink) return;

      link.setAttribute('href', active ? 'hesabim' : 'giris');
    });
  }

  async function refreshCustomerSession() {
    const api = window.SuveraAPI;
    const hasSession = Boolean(api && api.hasCustomerSession && api.hasCustomerSession());
    updateAccountLinks(hasSession);
    if (!hasSession || !api || !api.customerAuth || !api.customerAuth.me) return null;

    try {
      const session = await api.customerAuth.me();
      if (session && session.account) {
        saveProfile(session.account);
      }
      updateAccountLinks(true);
      window.dispatchEvent(new CustomEvent('suvera:customer-session', { detail: session || null }));
      return session;
    } catch (_) {
      updateAccountLinks(false);
      return null;
    }
  }

  function favoriteEmail() {
    const profile = loadProfile();
    const lastOrder = getLastOrder();
    return String(
      profile.email ||
      (lastOrder && lastOrder.customer && lastOrder.customer.email) ||
      ''
    ).trim().toLowerCase();
  }

  function mapRemoteFavorite(item) {
    const id = productKey(item);
    return normalizeFavorite({
      id,
      name: item.name,
      price: item.price,
      image: item.image || item.image_url,
      category: item.category,
      url: id ? ('urun?id=' + encodeURIComponent(id)) : 'urun',
    });
  }

  async function syncFavoritesFromServer() {
    const email = favoriteEmail();
    if (!email || !window.SuveraAPI || !window.SuveraAPI.wishlist) {
      return loadFavorites();
    }

    try {
      const remote = await window.SuveraAPI.wishlist.list(email);
      const merged = loadFavorites();
      (Array.isArray(remote) ? remote : []).forEach(function(item) {
        const favorite = mapRemoteFavorite(item);
        if (favoriteIndex(favorite, merged) < 0) merged.push(favorite);
      });
      saveFavorites(merged);
      refreshWishlistButtons();
      return merged;
    } catch (_) {
      return loadFavorites();
    }
  }

  function persistFavoriteChange(active, item) {
    const email = favoriteEmail();
    const productId = productKey(item);
    if (!email || !productId || !window.SuveraAPI || !window.SuveraAPI.wishlist) return;

    const action = active
      ? window.SuveraAPI.wishlist.add(email, productId)
      : window.SuveraAPI.wishlist.remove(email, productId);
    action.catch(function() {});
  }

  function loadOrderHistory() {
    return loadJson(ORDER_HISTORY_KEY, []);
  }

  function recordOrder(order) {
    if (!order || typeof order !== 'object') return null;
    const entry = {
      ...order,
      recordedAt: new Date().toISOString(),
    };
    const current = loadOrderHistory().filter(function(item) {
      return String(item.orderCode || item.id || '') !== String(entry.orderCode || entry.id || '');
    });
    current.unshift(entry);
    saveJson(ORDER_HISTORY_KEY, current.slice(0, 20));
    saveJson(LAST_ORDER_KEY, entry);
    if (entry.customer) saveProfile(entry.customer);
    return entry;
  }

  function getLastOrder() {
    return loadJson(LAST_ORDER_KEY, null);
  }

  function updateCartCount() {
    const total = cart.reduce((s, i) => s + i.qty, 0);
    document.querySelectorAll('.cart-dot, #cartCount').forEach(el => {
      el.textContent = total || '0';
    });
  }

  // ── TOAST ───────────────────────────────────────
  let toastTimer;
  window.Suvera.toast =
  window.showToast = function(msg, type = 'dark') {
    let el = document.getElementById('suveraToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'suveraToast';
      el.className = 'suvera-toast';
      document.body.appendChild(el);
    }
    const icons = { green: '✓', red: '✕', dark: 'ℹ' };
    el.textContent = '';
    const icon = document.createElement('span');
    icon.className = 'suvera-toast-icon';
    icon.textContent = icons[type] || 'ℹ';
    el.appendChild(icon);
    el.appendChild(document.createTextNode(String(msg)));
    el.className = 'suvera-toast toast-' + type;
    el.removeAttribute('style');
    el.offsetWidth;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
  };

  function productFromButton(button) {
    if (!button) return null;

    if (button.dataset.productId || button.dataset.productName) {
      return {
        id: button.dataset.productId || '',
        name: button.dataset.productName || '',
        price: Number(button.dataset.productPrice || 0),
        image: button.dataset.productImage || '',
        emoji: button.dataset.productEmoji || '',
        url: button.dataset.productUrl || '',
        category: button.dataset.productCategory || '',
      };
    }

    const card = button.closest('.prod-card');
    if (!card) return null;

    return {
      id: card.dataset.productId || '',
      name: card.dataset.productName || '',
      price: Number(card.dataset.productPrice || 0),
      image: card.dataset.productImage || '',
      emoji: card.dataset.productEmoji || '',
      url: card.dataset.productId ? ('urun?id=' + encodeURIComponent(card.dataset.productId)) : 'urun',
      category: card.dataset.productCategory || '',
    };
  }

  function syncFavoriteButton(button, product, favoriteKeys) {
    if (!button || !product) return;
    const active = favoriteKeys ? favoriteKeys.has(productKey(product)) : isFavorite(product);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    if (button.matches('.quick-fav, .prod-wish, #favToggle, [data-favorite-button]')) {
      button.textContent = active ? '♥' : '♡';
    }
  }

  function refreshWishlistButtons() {
    // FIX: Read favorites once per refresh to avoid repeated localStorage parsing.
    const favorites = loadFavorites();
    const favoriteKeys = new Set(favorites.map(productKey).filter(Boolean));
    document.querySelectorAll('.quick-fav, .prod-wish, #favToggle, [data-favorite-button]').forEach(function(button) {
      const product = productFromButton(button);
      if (product) syncFavoriteButton(button, product, favoriteKeys);
    });
  }

  function toggleFavorite(product) {
    const items = loadFavorites();
    const index = favoriteIndex(product, items);
    let active = false;
    let item = null;

    if (index >= 0) {
      item = items.splice(index, 1)[0];
    } else {
      item = normalizeFavorite(product);
      items.unshift(item);
      active = true;
    }

    saveFavorites(items);
    persistFavoriteChange(active, item);
    refreshWishlistButtons();
    return { active, item };
  }

  // ── SERVER-CANONICAL CART MIRROR ─────────────────
  // The server cart is authoritative; localStorage 'suveraCart' is only a UI cache
  // mirror in the legacy item shape. Images are not stored server-side, so a small
  // client-side cache keyed by variant preserves them across reloads.
  function readCartMirror() {
    try { return JSON.parse(localStorage.getItem('suveraCart') || '[]'); } catch (_) { return []; }
  }
  function writeCartMirror(items) {
    // Only persist on real change so a cross-tab `storage` event never ping-pongs
    // (tab A sync → mirror write → tab B storage event → tab B sync → …).
    const next = JSON.stringify(items || []);
    try {
      if (localStorage.getItem('suveraCart') !== next) localStorage.setItem('suveraCart', next);
    } catch (_) {}
    updateCartCount();
    return items;
  }
  function cartImageCache() {
    try { return JSON.parse(localStorage.getItem('suveraCartImages') || '{}'); } catch (_) { return {}; }
  }
  function cacheCartImage(variantId, image) {
    if (!variantId || !image) return;
    const store = cartImageCache();
    store[variantId] = image;
    try { localStorage.setItem('suveraCartImages', JSON.stringify(store)); } catch (_) {}
  }
  // Map a server cart view into the legacy mirror shape used across the storefront.
  window.Suvera.mirrorServerCart = function(view) {
    const images = cartImageCache();
    const items = (view && Array.isArray(view.items) ? view.items : []).map(function(it) {
      return {
        id: it.product_id, product_id: it.product_id, variant_id: it.variant_id,
        name: it.product_name, price: Number(it.unit_price), qty: Number(it.quantity),
        color: it.color, size: it.size,
        variant: [it.color, it.size].filter(Boolean).join(' / ') || 'Standart',
        image: images[it.variant_id] || '', emoji: '',
      };
    });
    const written = writeCartMirror(items);
    // Expose the latest server cart (id/version) for pages that do not load
    // cart-ui.js (e.g. checkout needs cart_id/cart_version for conversion).
    window.Suvera.currentServerCart = view || null;
    // Notify cart consumers (e.g. the checkout summary) that the mirror changed,
    // so views hydrated after the async server sync can re-render.
    try { window.dispatchEvent(new CustomEvent('suvera:cart-updated', { detail: { cart: view } })); } catch (_) {}
    return written;
  };
  window.Suvera.cartMirror = { read: readCartMirror, write: writeCartMirror };

  window.Suvera.addToCart = function(name, price, emoji, meta = {}) {
    const productId = meta.product_id || meta.id || null;
    const variantId = meta.variant_id || null;
    const api = window.SuveraAPI && window.SuveraAPI.cart;

    // Optimistic mirror update so the UI (and E2E) reflect the item immediately.
    const items = readCartMirror();
    const existing = items.find(function(i) {
      return variantId ? String(i.variant_id) === String(variantId) : i.name === name;
    });
    if (existing) existing.qty = Math.min(Number(existing.qty || 1) + 1, 99);
    else items.push({ name, price, emoji: emoji || '', qty: 1, ...meta });
    writeCartMirror(items);
    if (variantId) cacheCartImage(variantId, meta.image);

    document.querySelectorAll('.prod-card').forEach(function(card) {
      if (card.dataset.productName === name) {
        card.classList.add('added');
        setTimeout(function() { card.classList.remove('added'); }, 520);
      }
    });
    window.showToast('Sepete eklendi', 'green');

    // Reconcile with the server (canonical). Product-only adds resolve the default
    // variant server-side. On failure, re-sync from the server.
    if (api && productId) {
      return api.addItem({ product_id: productId, variant_id: variantId || null, quantity: 1 })
        .then(function(res) { window.Suvera.mirrorServerCart(res.cart); return res; })
        .catch(function(error) {
          window.showToast(error && error.message ? error.message : 'Sepete eklenemedi', 'dark');
          return api.get().then(function(res) { window.Suvera.mirrorServerCart(res.cart); }).catch(function() {});
        });
    }
    return Promise.resolve();
  };

  // ── ANNOUNCE + NAV SCROLL ────────────────────────
  function injectSkipLink() {
    if (document.querySelector('.skip-link')) return;

    const main = document.querySelector('main, .info-page-shell, .form-page, .checkout-shell, .page-shell');
    if (!main) return;

    if (!main.id) main.id = 'mainContent';
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');

    const link = document.createElement('a');
    link.className = 'skip-link';
    link.href = '#' + main.id;
    link.textContent = 'Icerige gec';
    document.body.insertAdjacentElement('afterbegin', link);
  }

  function initNavScroll() {
    const nav = document.getElementById('mainNav') || document.querySelector('nav');
    if (!nav) return;

    function update() {
      nav.classList.toggle('scrolled', window.scrollY > 0);
    }
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    update();
  }

  // ── MEGA MENU ───────────────────────────────────
  function buildNav() {
    const navWrap = document.querySelector('.nav-menu-wrap');
    if (!navWrap) return; // already built via HTML
    // Nav is built in HTML — just ensure hover works on touch
  }

  // Close mega on outside click / escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      // A31: the mobile drawer and the filter drawer are managed by the shared dialog
      // primitive, which already closes the topmost dialog on Escape and restores focus.
      // Stripping their classes here as well used to bypass that: the dialog stayed on the
      // primitive's stack, the background kept its aria-hidden and the scroll lock leaked.
      // Only surfaces the primitive does not own are handled here.
      document.querySelectorAll('.quick-view-modal.open').forEach(el => {
        el.classList.remove('open');
        document.body.style.overflow = '';
      });
    }
  });

  // ── MOBILE NAV DRAWER ───────────────────────────
  function initMobileNav() {
    // Inject drawer HTML if not present
    if (document.querySelector('.mobile-nav')) return;

    const drawerHTML = `
    <div class="mobile-nav" id="mobileNav">
      <div class="mobile-overlay" data-action="close-mobile-nav"></div>
      <div class="mobile-drawer">
        <div class="mobile-drawer-head">
          <h2 class="sr-only" id="mobileNavTitle">Menü</h2>
          <span class="mobile-drawer-logo" aria-hidden="true">SUVERA</span>
          <button class="mobile-drawer-close" type="button" aria-label="Menüyü kapat" data-action="close-mobile-nav"><span aria-hidden="true">×</span></button>
        </div>
        <nav class="mobile-nav-items" aria-label="Mobil menu">
          <a href="anasayfa" class="mobile-nav-item">Ana Sayfa</a>
          <a href="urunler?sort=newest" class="mobile-nav-item">Yeni Gelenler</a>
          <div id="mobileCategoriesItem" hidden>
          <button type="button" class="mobile-nav-item" data-action="toggle-mobile-sub" data-sub="mobileCategoryLinks" aria-expanded="false" aria-controls="mobileCategoryLinks">
            Kategoriler <span aria-hidden="true">›</span>
          </button>
          <div class="mobile-nav-sub" id="mobileCategoryLinks"></div>
          </div>
          <a href="urunler?sort=best_selling" class="mobile-nav-item" id="mobileBestSellersLink" hidden>En Çok Satanlar</a>
          <div id="mobileCollectionsItem" hidden>
          <button type="button" class="mobile-nav-item" data-action="toggle-mobile-sub" data-sub="mobileCollectionLinks" aria-expanded="false" aria-controls="mobileCollectionLinks">
            Koleksiyonlar <span aria-hidden="true">›</span>
          </button>
          <div class="mobile-nav-sub" id="mobileCollectionLinks"></div>
          </div>
          <a href="urunler" class="mobile-nav-item">Tüm Ürünler</a>
        </nav>
        <div class="mobile-nav-footer">
          <a href="giris">👤 &nbsp; Hesabım</a>
          <a href="sepet">🛍️ &nbsp; Sepetim</a>
        </div>
      </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', drawerHTML);
  }

  // A31: the drawer goes through the shared dialog primitive (js/a11y.js) so it gets the
  // same focus trap, Escape handling and focus restore as every other overlay, instead of
  // a second hand-rolled implementation.
  window.openMobileNav = function() {
    const drawer = document.getElementById('mobileNav');
    if (!drawer) return;
    drawer.classList.add('open');
    document.documentElement.classList.add('mobile-menu-open');
    document.body.classList.add('mobile-menu-open');
    const hamburger = document.querySelector('.hamburger');
    hamburger?.classList.add('open');
    hamburger?.setAttribute('aria-expanded', 'true');
    window.SuveraA11y?.openDialog(drawer, {
      opener: hamburger,
      initialFocus: '.mobile-drawer-close',
      labelledBy: 'mobileNavTitle',
      onClose: () => {
        drawer.classList.remove('open');
        document.documentElement.classList.remove('mobile-menu-open');
        document.body.classList.remove('mobile-menu-open');
        hamburger?.classList.remove('open');
        hamburger?.setAttribute('aria-expanded', 'false');
      },
    });
  };
  window.closeMobileNav = function() {
    const drawer = document.getElementById('mobileNav');
    if (!drawer) return;
    if (window.SuveraA11y?.isOpen(drawer)) {
      window.SuveraA11y.closeDialog(drawer);
      return;
    }
    drawer.classList.remove('open');
    document.documentElement.classList.remove('mobile-menu-open');
    document.body.classList.remove('mobile-menu-open');
    document.querySelector('.hamburger')?.setAttribute('aria-expanded', 'false');
  };
  window.toggleMobileSub = function(id, trigger) {
    const sub = document.getElementById(id);
    if (!sub) return;
    const open = sub.classList.toggle('open');
    const control = trigger || document.querySelector(`[data-sub="${id}"]`);
    control?.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  // ── HAMBURGER ───────────────────────────────────
  function initHamburger() {
    const btn = document.querySelector('.hamburger');
    if (!btn) return;
    // A31: the hamburger also carries data-action="open-mobile-nav", so the delegated
    // dispatcher already handles the click. Binding a second listener here made one click
    // run the open path twice. The toggle behaviour that lived here moves into the
    // dispatcher's single call path instead.
    btn.setAttribute('aria-expanded', 'false');
  }

  // ── SCROLL REVEAL ───────────────────────────────
  function initScrollReveal() {
    const targets = document.querySelectorAll('.reveal, .stagger-children');
    if (!targets.length) return;

    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('show');
          // optional: unobserve after reveal
          // obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.07, rootMargin: '0px 0px -40px 0px' });

    targets.forEach(el => obs.observe(el));
  }

  // ── PRODUCT CARD HEARTS ─────────────────────────
  function initWishlistBtns() {
    // Capture-phase delegation: inline onclick="event.stopPropagation()" on dynamic
    // product cards blocks bubble-phase handlers from firing. Capture phase runs
    // before the event reaches the button, so stopPropagation() on the element has
    // no effect on us here.
    document.addEventListener('click', function(e) {
      const btn = e.target.closest('.prod-wish, .quick-fav');
      if (!btn) return;
      e.stopPropagation();
      e.preventDefault();
      const product = productFromButton(btn);
      if (!product) return;
      const result = toggleFavorite(product);
      const isActive = result.active;
      btn.textContent = isActive ? '❤️' : '🤍';
      showToast(isActive ? 'Favorilere eklendi ❤️' : 'Favorilerden çıkarıldı', isActive ? 'green' : 'dark');
    }, true); // useCapture = true
  }

  // ── QUICK VIEW MODAL ────────────────────────────
  function initQuickView() {
    // Capture-phase so we intercept before the parent .prod-card onclick fires.
    document.addEventListener('click', function(e) {
      const btn = e.target.closest('.quick-view');
      if (!btn) return;
      e.stopPropagation();
      const card  = btn.closest('.prod-card');
      const productId = card?.dataset.productId || '';
      const name  = card?.dataset.productName || card?.querySelector('h4')?.textContent || 'Ürün';
      const price = card?.dataset.productPriceLabel || card?.querySelector('.p-new')?.textContent || '';
      const emoji = card?.dataset.productEmoji || '';
      const image = card?.dataset.productImage || '';

      let modal = document.getElementById('quickViewModal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'quickViewModal';
        modal.className = 'quick-view-modal';
        modal.innerHTML = `
          <div class="qv-box" role="dialog">
            <div class="qv-img" id="qvImg"></div>
            <div class="qv-info">
              <button class="qv-close" data-action="close-quickview">×</button>
              <p data-css="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#888;margin-bottom:12px;">HIZLI ÖNIZLEME</p>
              <h2 id="qvName" data-css="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:400;margin-bottom:10px;"></h2>
              <p id="qvPrice" data-css="font-size:20px;font-weight:600;color:#3d6b38;margin-bottom:24px;"></p>
              <div data-css="display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap;" id="qvSizes"></div>
              <a href="urun" id="qvLink" class="btn-primary" data-css="display:block;text-align:center;">Ürün Sayfasına Git →</a>
              <button id="qvAddBtn" class="qv-add-btn"
                data-css="width:100%;background:#3d6b38;color:#fff;border:none;padding:13px;font-family:'Jost',sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;cursor:pointer;margin-top:10px;transition:background .2s;">Sepete Ekle</button>
            </div>
          </div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', e => { if (e.target === modal) { modal.classList.remove('open'); document.body.style.overflow = ''; } });
      }

      const qvImg = document.getElementById('qvImg');
      qvImg.innerHTML = image
        ? '<img src="' + escapeHtml(image) + '" alt="' + escapeHtml(name) + '" data-css="width:100%;height:100%;object-fit:cover;display:block"/>'
        : escapeHtml(emoji);
      document.getElementById('qvName').textContent = name;
      document.getElementById('qvPrice').textContent = price;
      document.getElementById('qvLink').href = productId ? ('urun?id=' + productId) : 'urun';
      const sizes = ['XS','S','M','L','XL','XXL'];
      document.getElementById('qvSizes').innerHTML = sizes.map(s =>
        `<button class="qv-size-btn" data-action="qv-size-toggle"
          data-css="padding:8px 14px;border:1px solid #e8e2d9;background:#fff;font-family:'Jost',sans-serif;font-size:12px;cursor:pointer;transition:all .2s">${s}</button>`
      ).join('');
      document.getElementById('qvAddBtn').onclick = function () {
        if (productId && window.addApiProductToCart) {
          window.addApiProductToCart(productId);
        } else if (window.Suvera) {
          window.Suvera.addToCart(name, Number(card?.dataset.productPrice || 0), emoji);
        }
      };

      modal.classList.add('open');
      document.body.style.overflow = 'hidden';
    }, true); // useCapture = true
  }

  function initQuickAddButtons() {
    document.addEventListener('click', function(event) {
      const button = event.target.closest('.quick-add');
      if (!button) return;

      event.preventDefault();
      event.stopPropagation();

      const inlineAction = button.getAttribute('onclick') || '';
      if (/addApiProductToCart|Suvera\.addToCart|addToCartFromCard/.test(inlineAction)) return;

      if (/stok/i.test(button.textContent || '')) {
        window.showToast('Stok bildirimi alındı', 'green');
        return;
      }

      const card = button.closest('.prod-card');
      const productId = card && card.dataset ? card.dataset.productId : '';
      if (productId && window.addApiProductToCart) {
        window.addApiProductToCart(productId);
        return;
      }

      const nameNode = card ? card.querySelector('h4, h3, .prod-name, .product-title') : null;
      const priceNode = card ? card.querySelector('.price-current, .prod-price, .related-price, [data-price]') : null;
      const emojiNode = card ? card.querySelector('.prod-emoji, .prod-img span') : null;
      const rawPrice = (priceNode && (priceNode.dataset.price || priceNode.textContent)) || '0';
      const price = Number(String(rawPrice).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
      const name = (card && card.dataset && card.dataset.productName) ||
        (nameNode ? nameNode.textContent.trim() : 'Ürün');
      const emoji = (card && card.dataset && card.dataset.productEmoji) ||
        (emojiNode ? emojiNode.textContent.trim() : 'SU');

      window.Suvera.addToCart(name, price, emoji, {
        id: productId || name,
        product_id: productId || name,
      });
    });
  }

  function applySiteSettings() {
    document.title = siteSettings.siteName || defaultSettings.siteName;

    if (siteSettings.features && siteSettings.features.maintenance) {
      let banner = document.getElementById('maintenanceBanner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'maintenanceBanner';
        banner.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:9999;background:#1a1a1a;color:#fff;padding:10px 14px;font-size:12px;border-radius:6px;';
        document.body.appendChild(banner);
      }
      banner.textContent = 'Bakım modu açık. Sitede güncelleme yapılıyor.';
    }
  }

  // ── FILTER DRAWER (mobile) ──────────────────────
  // A31: same shared dialog lifecycle as the mobile menu and the lightbox.
  window.openFilterDrawer = function() {
    const drawer = document.getElementById('filterDrawer');
    if (!drawer) return;
    const trigger = document.querySelector('.filter-mobile-btn');
    drawer.classList.add('open');
    document.getElementById('filterDrawerOverlay')?.classList.add('open');
    trigger?.setAttribute('aria-expanded', 'true');
    window.SuveraA11y?.openDialog(drawer, {
      opener: trigger,
      initialFocus: '.filter-drawer-close',
      labelledBy: 'filterDrawerTitle',
      onClose: () => {
        drawer.classList.remove('open');
        document.getElementById('filterDrawerOverlay')?.classList.remove('open');
        trigger?.setAttribute('aria-expanded', 'false');
      },
    });
  };
  window.closeFilterDrawer = function() {
    const drawer = document.getElementById('filterDrawer');
    if (!drawer) return;
    if (window.SuveraA11y?.isOpen(drawer)) {
      window.SuveraA11y.closeDialog(drawer);
      return;
    }
    drawer.classList.remove('open');
    document.getElementById('filterDrawerOverlay')?.classList.remove('open');
    document.querySelector('.filter-mobile-btn')?.setAttribute('aria-expanded', 'false');
  };

  // ── STICKY BUY BAR (ürün detay, mobile) ─────────
  function initStickyBuy() {
    const bar = document.querySelector('.sticky-buy-bar');
    const addBtn = document.querySelector('.btn-cart');
    if (!bar || !addBtn) return;

    const obs = new IntersectionObserver(entries => {
      bar.classList.toggle('show', !entries[0].isIntersecting);
    }, { threshold: 0 });
    obs.observe(addBtn);
  }

  // ── NAV SEARCH ──────────────────────────────────
  function initNavSearch() {
    const icon = document.querySelector('.nav-search-icon');
    const box  = document.querySelector('.nav-search-box');
    const input = box ? box.querySelector('input') : null;

    if (icon && box) {
      // A31: the icon is a disclosure control, so its expanded state must be truthful and
      // it must name the region it controls.
      if (box.id) icon.setAttribute('aria-controls', box.id);
      icon.setAttribute('aria-expanded', box.classList.contains('open') ? 'true' : 'false');
      icon.addEventListener('click', () => {
        if (window.matchMedia('(max-width: 768px)').matches && openMobileSearch()) {
          return;
        }
        box.classList.toggle('open');
        const open = box.classList.contains('open');
        icon.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) {
          input?.focus();
        }
      });
      // Escape closes the search and hands focus back to the control that opened it.
      box.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !box.classList.contains('open')) return;
        box.classList.remove('open');
        icon.setAttribute('aria-expanded', 'false');
        icon.focus();
      });
    }

    if (!input) return;

    input.onkeydown = e => {
      if (e.key === 'Escape') {
        box.classList.remove('open');
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        const query = input.value.trim();
        window.location.href = 'arama' + (query ? ('?q=' + encodeURIComponent(query)) : '');
      }
    };
  }

  // ── PAGE TRANSITION ─────────────────────────────
  function currentPageKey() {
    const path = (location.pathname.split('/').pop() || 'anasayfa').replace(/\.html$/, '') || 'anasayfa';
    return path === 'index' ? 'anasayfa' : path;
  }

  function initMobileBottomNav() {
    if (document.querySelector('.mobile-bottom-nav')) return;

    const nav = document.createElement('div');
    nav.className = 'mobile-bottom-nav';
    nav.setAttribute('aria-label', 'Mobil alt gezinme');
    const page = currentPageKey();
    nav.innerHTML = [
      '<a href="anasayfa" data-page="anasayfa"><span class="mbn-icon">⌂</span><span>Ana</span></a>',
      '<a href="urunler" data-page="urunler"><span class="mbn-icon">≡</span><span>Kategori</span></a>',
      '<button type="button" data-mobile-search><span class="mbn-icon">⌕</span><span>Arama</span></button>',
      '<a href="favoriler" data-page="favoriler"><span class="mbn-icon">♡</span><span>Favori</span></a>',
      '<a href="sepet" data-page="sepet"><span class="mbn-icon">◱</span><span>Sepet</span><span class="mbn-badge cart-dot">0</span></a>',
    ].join('');

    nav.querySelectorAll('[data-page]').forEach(function(item) {
      item.classList.toggle('active', item.dataset.page === page || (page === 'urun' && item.dataset.page === 'urunler'));
    });
    nav.querySelector('[data-mobile-search]')?.addEventListener('click', openMobileSearch);
    document.body.appendChild(nav);
    updateCartCount();
  }

  function ensureMobileSearchPanel() {
    let panel = document.getElementById('mobileSearchPanel');
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'mobileSearchPanel';
    panel.className = 'mobile-search-panel';
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML = [
      '<div class="mobile-search-sheet" role="dialog" aria-modal="true" aria-label="Urun arama">',
      '  <div class="mobile-search-head">',
      '    <input class="mobile-search-input" type="search" placeholder="Urun, kategori veya koleksiyon ara" autocomplete="off"/>',
      '    <button class="mobile-search-close" type="button" aria-label="Aramayi kapat">x</button>',
      '  </div>',
      '  <div class="mobile-search-suggestions">',
      '    <a href="urunler">Yeni gelenler</a>',
      '    <a href="urunler?sort=price_asc">Fiyat artan</a>',
      '    <a href="urunler?sort=price_desc">Fiyat azalan</a>',
      '    <a href="favoriler">Favoriler</a>',
      '  </div>',
      '</div>',
    ].join('');

    const close = function() {
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    };
    panel.querySelector('.mobile-search-close')?.addEventListener('click', close);
    panel.addEventListener('click', function(event) {
      if (event.target === panel) close();
    });
    panel.querySelector('.mobile-search-input')?.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') {
        close();
        return;
      }
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const query = event.currentTarget.value.trim();
      location.href = 'arama' + (query ? ('?q=' + encodeURIComponent(query)) : '');
    });
    document.body.appendChild(panel);
    return panel;
  }

  function openMobileSearch() {
    const panel = ensureMobileSearchPanel();
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function() {
      panel.querySelector('.mobile-search-input')?.focus();
    });
    return true;
  }

  function initImageLazyState() {
    document.querySelectorAll('img[loading="lazy"]').forEach(function(img) {
      img.classList.add('is-lazy');
      if (img.complete) img.classList.add('is-loaded');
      img.addEventListener('load', function() {
        img.classList.add('is-loaded');
      }, { once: true });
    });
  }

  function initMobileFilterButton() {
    if (!document.getElementById('filterDrawer') || document.querySelector('.filter-mobile-btn')) return;

    const host = document.querySelector('.content-meta') || document.querySelector('.content-header') || document.querySelector('.page-wrap');
    if (!host) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'filter-mobile-btn';
    button.textContent = 'Filtrele';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'filterDrawer');
    button.addEventListener('click', function() {
      if (window.openFilterDrawer) window.openFilterDrawer();
    });
    host.insertAdjacentElement('afterbegin', button);
  }

  function repairPlaceholderLinks() {
    const map = [
      [/^kvkk/i, 'kvkk'],
      [/^kvkk sozlesmesi/i, 'kvkk'],
      [/^kvkk\s+[–-]/i, 'kvkk'],
      [/^kargo/i, 'kargo'],
      [/^iade/i, 'iade'],
      [/^satis sozlesmesi$/i, 'sozlesme'],
      [/^hakkimizda$/i, 'hakkimizda'],
      [/^iletisim$/i, 'iletisim'],
      [/^blog$/i, 'blog'],
      [/^magazalar$/i, 'iletisim'],
      [/^kariyer$/i, 'iletisim'],
      [/^is birligi$/i, 'iletisim'],
      [/^bize ulasin/i, 'iletisim#iletisim-kanallari'],
      [/^e-posta:/i, 'iletisim#iletisim-kanallari'],
      [/^whatsapp$/i, 'iletisim#iletisim-kanallari'],
      [/^0850/i, 'iletisim#iletisim-kanallari'],
      [/^instagram$/i, 'iletisim#iletisim-kanallari'],
      [/^tiktok$/i, 'iletisim#iletisim-kanallari'],
      [/^pinterest$/i, 'iletisim#iletisim-kanallari'],
      [/^youtube$/i, 'iletisim#iletisim-kanallari'],
      [/^elbise$/i, 'urunler'],
      [/^abaya$/i, 'urunler'],
      [/^takim$/i, 'urunler'],
      [/^esarp$/i, 'urunler'],
      [/^trenckot$/i, 'urunler'],
      [/^ceket & blazer$/i, 'urunler'],
      [/^kaban & mont$/i, 'urunler'],
      [/^canta$/i, 'urunler'],
      [/^etek$/i, 'urunler'],
      [/^ust giyim$/i, 'urunler'],
      [/^giyim$/i, 'urunler'],
      [/^uyelik sozlesmesi$/i, 'uyelik-sozlesmesi'],
      [/^sifremi unuttum$/i, 'sifre-sifirla'],
      [/^hizlica uye olun/i, 'hesabim'],
      [/^favoriler/i, 'favoriler'],
      [/^hesabim$/i, 'hesabim'],
    ];

    document.querySelectorAll('a[href="#"], a[href=""], a[href="javascript:void(0)"]').forEach(function(link) {
      const text = (link.textContent || '').replace(/\s+/g, ' ').trim();
      const normalized = text
        .toLocaleLowerCase('tr-TR')
        .replace(/ı/g, 'i')
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ş/g, 's')
        .replace(/ö/g, 'o')
        .replace(/ç/g, 'c');
      const found = map.find(function(entry) {
        return entry[0].test(normalized);
      });
      if (found) link.href = found[1];
    });
  }

  function initSeoDefaults() {
    if (!window.SuveraSEO) return;

    const path = (location.pathname.split('/').pop() || 'anasayfa').toLowerCase();
    const currentDescription = ((document.querySelector('meta[name="description"]') || {}).content || '').trim();
    const titleMap = {
      'anasayfa': 'Suvera | Modern Tesettur Giyim',
      'urunler': 'Urunler | Suvera',
      'urun': 'Urun Detayi | Suvera',
      'sepet': 'Sepetim | Suvera',
      'giris': 'Uye Girisi | Suvera',
      'siparis': 'Odeme ve Teslimat | Suvera',
      'suvera': 'Suvera',
    };
    const descriptionMap = {
      'anasayfa': 'Suvera modern tesettur giyim seckileri, guvenli alisveris akisi ve rafine koleksiyon deneyimi sunar.',
      'urunler': 'Suvera koleksiyonundaki urunleri kesfedin, filtreleyin ve favorilerinize ekleyin.',
      'urun': 'Suvera urun detaylarinda olcu, stok, teslimat ve benzer urun bilgilerini inceleyin.',
      'sepet': 'Suvera sepetinizdeki urunleri kontrol edin ve odeme adimina hazirlanin.',
      'giris': 'Suvera hesabiniza girin, siparislerinizi ve favorilerinizi tek ekrandan yonetin.',
      'siparis': 'Suvera checkout akisinda teslimat, iletisim ve odeme adimlarini guvenli sekilde tamamlayin.',
      'suvera': 'Suvera modern tesettur giyim vitrini.',
    };

    window.SuveraSEO.applyPageMeta({
      title: titleMap[path] || document.title || 'Suvera',
      description: descriptionMap[path] || currentDescription || 'Suvera modern tesettur giyim vitrini.',
      path: location.pathname + location.search,
    });
    window.SuveraSEO.applyBaseSchemas({
      path: location.pathname + location.search,
      name: titleMap[path] || document.title || 'Suvera',
      description: descriptionMap[path] || currentDescription || 'Suvera modern tesettur giyim vitrini.',
    });
  }

  function redirectPaymentReturn() {
    const path = (location.pathname.split('/').pop() || 'anasayfa').toLowerCase();
    if (path === 'tesekkur') return;

    const params = new URLSearchParams(location.search);
    const paymentState = String(
      params.get('payment') ||
      params.get('paymentStatus') ||
      params.get('status') ||
      ''
    ).toLowerCase();
    const looksLikePaymentReturn =
      ['success', 'successful', 'paid', 'ok', 'failed', 'failure', 'cancel', 'cancelled', 'error']
        .includes(paymentState) ||
      params.has('conversationId') ||
      params.has('conversationData') ||
      params.has('token') ||
      params.has('paymentId');

    if (!looksLikePaymentReturn) return;

    const state = window.Suvera || {};
    const lastOrder = state.getLastOrder ? state.getLastOrder() : null;
    const orderCode = params.get('order') || (lastOrder && (lastOrder.orderCode || lastOrder.id)) || '';
    const target = new URL('tesekkur', location.href);

    if (orderCode) target.searchParams.set('order', orderCode);
    if (paymentState) target.searchParams.set('payment', paymentState);
    ['status', 'conversationId', 'conversationData', 'token', 'paymentId'].forEach(function(key) {
      if (params.has(key)) target.searchParams.set(key, params.get(key));
    });

    location.replace(target.toString());
  }

  function initPageTransitions() {
    let overlay = document.getElementById('pageTransitionOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'pageTransitionOverlay';
      overlay.className = 'page-transition-overlay';
      document.body.appendChild(overlay);
    }

    document.addEventListener('click', e => {
      const link = e.target.closest('a[href]');
      if (!link) return;
      const href = link.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto') || href.startsWith('tel') || link.target === '_blank') return;
      if (href.startsWith('http')) return;

      e.preventDefault();
      overlay.classList.add('fade-out');
      setTimeout(() => { window.location.href = href; }, 220);
    });
  }

  // ── INIT ALL ────────────────────────────────────
  // Redeem an abandoned-cart recovery link (?rt=token): scrub the token from the URL
  // and history FIRST (so it never lingers in the address bar, history or referrers),
  // then swap it server-side for the HttpOnly guest cookie and refresh the mirror.
  // The raw token is never written to web storage.
  async function handleRecoveryLink() {
    let token = '';
    try {
      const params = new URLSearchParams(window.location.search);
      token = (params.get('rt') || '').trim();
      if (!token) return;
      params.delete('rt');
      const query = params.toString();
      window.history.replaceState({}, document.title, window.location.pathname + (query ? '?' + query : '') + window.location.hash);
    } catch (_) { return; }
    const api = window.SuveraAPI && window.SuveraAPI.cart;
    if (!token || !api || typeof api.recover !== 'function') return;
    try {
      const res = await api.recover(token);
      // On success the proxy has already set the fresh HttpOnly guest cookie. Land the
      // shopper on their restored cart with a clean URL; replace() keeps the consumed
      // token out of history and the fresh load re-syncs the cart from the server.
      if (res && res.cart) window.location.replace('/sepet');
    } catch (_) {
      // Invalid/expired/used links fail without leaking why; the current cart is kept.
      if (window.showToast) window.showToast('Kurtarma bağlantısı geçersiz veya süresi dolmuş.', 'dark');
    }
  }

  function init() {
    injectSkipLink();
    applySiteSettings();
    redirectPaymentReturn();
    void handleRecoveryLink();
    initSeoDefaults();
    updateCartCount();
    initNavScroll();
    buildNav();
    initMobileNav();
    updateAccountLinks(window.SuveraAPI && window.SuveraAPI.hasCustomerSession && window.SuveraAPI.hasCustomerSession());
    initHamburger();
    initScrollReveal();
    initWishlistBtns();
    initQuickView();
    initQuickAddButtons();
    initNavSearch();
    initMobileBottomNav();
    initImageLazyState();
    initMobileFilterButton();
    repairPlaceholderLinks();
    syncFavoritesFromServer().then(refreshWishlistButtons).catch(refreshWishlistButtons);
    refreshCustomerSession().catch(function() {});
    initStickyBuy();
    // page transitions — subtle, opt-in
    // initPageTransitions(); // uncomment to enable
  }

  window.Suvera.loadFavorites = loadFavorites;
  window.Suvera.saveFavorites = saveFavorites;
  window.Suvera.toggleFavorite = toggleFavorite;
  window.Suvera.isFavorite = isFavorite;
  window.Suvera.refreshWishlistButtons = refreshWishlistButtons;
  window.Suvera.syncFavoritesFromServer = syncFavoritesFromServer;
  window.Suvera.recordOrder = recordOrder;
  window.Suvera.loadOrderHistory = loadOrderHistory;
  window.Suvera.getLastOrder = getLastOrder;
  window.Suvera.saveProfile = saveProfile;
  window.Suvera.loadProfile = loadProfile;
  window.Suvera.refreshCustomerSession = refreshCustomerSession;
  window.Suvera.updateAccountLinks = updateAccountLinks;
  window.Suvera.syncFavoriteButton = syncFavoriteButton;

  // --- CSP-safe action delegation ---------------------------------------
  // Replaces inline on* handlers (removed so script-src can drop 'unsafe-inline').
  // Elements declare intent via data-action / data-nav / data-oninput and the
  // real behaviour lives in the (already global) page/shared functions.
  function callGlobal(name, arg) {
    const fn = window[name];
    if (typeof fn === 'function') return fn(arg);
    return undefined;
  }

  function handleDelegatedClick(event) {
    const actionEl = event.target.closest('[data-action]');
    if (actionEl) {
      const action = actionEl.getAttribute('data-action');
      switch (action) {
        case 'open-mobile-nav': {
          // Single toggle path: the drawer is the source of truth for open/closed.
          const drawer = document.getElementById('mobileNav');
          if (drawer && drawer.classList.contains('open')) callGlobal('closeMobileNav');
          else callGlobal('openMobileNav');
          return;
        }
        case 'toggle-fav': event.stopPropagation(); callGlobal('toggleFav', actionEl); return;
        case 'slide-prev': callGlobal('changeSlide', -1); return;
        case 'slide-next': callGlobal('changeSlide', 1); return;
        case 'go-slide': callGlobal('goSlide', Number(actionEl.getAttribute('data-index') || 0)); return;
        case 'drawer-size': {
          // A31: the selected state was carried by a CSS class alone, which says nothing
          // to a screen reader. aria-pressed makes the toggle state part of the control.
          const active = actionEl.classList.toggle('active');
          actionEl.setAttribute('aria-pressed', active ? 'true' : 'false');
          callGlobal('updateDrawerSz', actionEl);
          return;
        }
        case 'detail-accordion': callGlobal('toggleDetailAccordion', actionEl); return;
        case 'close-filter-drawer': callGlobal('closeFilterDrawer'); return;
        case 'toggle-summary': callGlobal('toggleSummary'); return;
        case 'toggle-pw': callGlobal('togglePw'); return;
        case 'toggle-order-note': callGlobal('toggleOrderNote'); return;
        case 'toggle-gift': callGlobal('toggleGift'); return;
        case 'reset-drawer': callGlobal('resetDrawer'); return;
        case 'apply-drawer': callGlobal('applyDrawer'); return;
        case 'do-register': callGlobal('doRegister'); return;
        case 'do-login': callGlobal('doLogin'); return;
        case 'clear-cart': callGlobal('clearCart'); return;
        case 'buy-now': callGlobal('buyNow'); return;
        case 'add-to-cart': callGlobal('addToCart'); return;
        case 'show-register': callGlobal('showRegister', event); return;
        case 'show-login': callGlobal('showLogin', event); return;
        case 'switch-tab': callGlobal('switchTab', actionEl.getAttribute('data-tab')); return;
        case 'demo-sms': window.alert('SMS gönderildi!'); return;
        case 'close-mobile-nav': callGlobal('closeMobileNav'); return;
        case 'toggle-mobile-sub': callGlobal('toggleMobileSub', actionEl.getAttribute('data-sub'), actionEl); return;
        case 'cart-remove': callGlobal('removeCartItem', Number(actionEl.getAttribute('data-index'))); return;
        case 'cart-qty': {
          if (typeof window.changeQty === 'function') {
            window.changeQty(Number(actionEl.getAttribute('data-index')), Number(actionEl.getAttribute('data-delta')));
          }
          return;
        }
        case 'close-quickview': {
          const modal = document.getElementById('quickViewModal');
          if (modal) { modal.classList.remove('open'); document.body.style.overflow = ''; }
          return;
        }
        case 'qv-size-toggle': actionEl.classList.toggle('qv-size-selected'); return;
        case 'select-color': event.stopPropagation(); callGlobal('selectProductCardColor', actionEl); return;
        case 'expand-clamp': {
          const p = actionEl.parentElement && actionEl.parentElement.querySelector('p');
          if (p) p.style.webkitLineClamp = 'unset';
          actionEl.style.display = 'none';
          return;
        }
        default: return;
      }
    }

    // data-stop marks inner controls that must not trigger a parent data-nav.
    const stopEl = event.target.closest('[data-stop]');
    const navEl = event.target.closest('[data-nav]');
    if (navEl && !(stopEl && navEl.contains(stopEl))) {
      const href = navEl.getAttribute('data-nav');
      if (href) window.location.href = href;
    }
  }

  function handleDelegatedInput(event) {
    const el = event.target.closest('[data-oninput="price"]');
    if (!el) return;
    const targetId = el.getAttribute('data-price-target');
    const out = targetId && document.getElementById(targetId);
    if (out) out.textContent = el.value + ' TL';
  }

  function handleDelegatedKeydown(event) {
    const el = event.target.closest('[data-action="search-enter"]');
    if (el && event.key === 'Enter') {
      window.location.href = el.getAttribute('data-search-target') || 'urunler';
    }
  }

  document.addEventListener('click', handleDelegatedClick);
  document.addEventListener('input', handleDelegatedInput);
  document.addEventListener('keydown', handleDelegatedKeydown);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
