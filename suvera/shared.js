/* ═══════════════════════════════════════════════════
   Suvera – Shared JavaScript v2
   Çalıştırma: <script src="shared.js"></script> </body> öncesinde
═══════════════════════════════════════════════════ */

(function() {
  'use strict';

  // ── CART STATE ──────────────────────────────────
  window.Suvera = window.Suvera || {};
  const cart = JSON.parse(localStorage.getItem('suveraCart') || '[]');
  const FAVORITES_KEY = 'suveraFavorites';
  const ORDER_HISTORY_KEY = 'suveraRecentOrders';
  const LAST_ORDER_KEY = 'suveraLastOrder';
  const PROFILE_KEY = 'suveraCustomerProfile';
  const defaultSettings = {
    siteName: 'SUVERA – Modern Tesettür Giyim',
    announcementText: '✦ Yeni sezon geldi — tüm siparişlerde ücretsiz kargo 600 TL ve üzeri ✦',
    freeShippingLimit: 600,
    features: {
      announcement: true,
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

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function(char) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
      }[char];
    });
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

  window.Suvera.addToCart = function(name, price, emoji, meta = {}) {
    const existing = cart.find(i => i.name === name);
    if (existing) existing.qty++;
    else cart.push({ name, price, emoji: emoji || '🧕', qty: 1, ...meta });
    localStorage.setItem('suveraCart', JSON.stringify(cart));
    updateCartCount();
    document.querySelectorAll('.prod-card').forEach(function(card) {
      if (card.dataset.productName === name) {
        card.classList.add('added');
        setTimeout(function() { card.classList.remove('added'); }, 520);
      }
    });
    window.showToast('Sepete eklendi', 'green');
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
    const ann = document.querySelector('.announce');
    const nav = document.getElementById('mainNav') || document.querySelector('nav');
    if (!nav) return;
    const ANN_H = ann ? ann.offsetHeight : 0;

    function update() {
      const isMobile = window.matchMedia('(max-width: 768px)').matches;
      if (isMobile) {
        nav.classList.add('scrolled');
        if (ann) ann.classList.toggle('hidden', window.scrollY < 96);
        document.documentElement.classList.toggle('mobile-announcement-visible', !!ann && window.scrollY >= 96);
        return;
      }
      if (window.scrollY >= ANN_H) {
        nav.classList.add('scrolled');
        if (ann) ann.classList.add('hidden');
      } else {
        nav.classList.remove('scrolled');
        if (ann) ann.classList.remove('hidden');
      }
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
      // close modals, drawers, etc.
      document.querySelectorAll('.quick-view-modal.open, .mobile-nav.open').forEach(el => {
        el.classList.remove('open');
        document.body.style.overflow = '';
      });
      closeFilterDrawer();
    }
  });

  // ── MOBILE NAV DRAWER ───────────────────────────
  function initMobileNav() {
    // Inject drawer HTML if not present
    if (document.querySelector('.mobile-nav')) return;

    const drawerHTML = `
    <div class="mobile-nav" id="mobileNav">
      <div class="mobile-overlay" onclick="closeMobileNav()"></div>
      <div class="mobile-drawer">
        <div class="mobile-drawer-head">
          <span class="mobile-drawer-logo">SUVERA</span>
          <button class="mobile-drawer-close" onclick="closeMobileNav()">×</button>
        </div>
        <div class="mobile-nav-items" role="navigation" aria-label="Mobil menu">
          <a href="anasayfa" class="mobile-nav-item">Ana Sayfa</a>
          <div class="mobile-nav-item" onclick="toggleMobileSub('mobGiyim')">
            Giyim <span>›</span>
          </div>
          <div class="mobile-nav-sub" id="mobGiyim">
            <a href="urunler">Tümü</a>
            <a href="urunler">Elbise</a>
            <a href="urunler">Bluz & Gömlek</a>
            <a href="urunler">Pantolon & Etek</a>
            <a href="urunler">Takım & Kombin</a>
          </div>
          <div class="mobile-nav-item" onclick="toggleMobileSub('mobDis')">
            Dış Giyim <span>›</span>
          </div>
          <div class="mobile-nav-sub" id="mobDis">
            <a href="urunler">Kaban & Mont</a>
            <a href="urunler">Trençkot</a>
            <a href="urunler">Ceket & Blazer</a>
          </div>
          <div class="mobile-nav-item" onclick="toggleMobileSub('mobAbaya')">
            Abaya & Ferace <span>›</span>
          </div>
          <div class="mobile-nav-sub" id="mobAbaya">
            <a href="urunler">Abaya</a>
            <a href="urunler">Ferace</a>
            <a href="urunler">Kuşaklı Modeller</a>
          </div>
          <a href="urunler" class="mobile-nav-item">Eşarp & Aksesuar</a>
          <a href="urunler" class="mobile-nav-item">Koleksiyonlar</a>
          <a href="urunler" class="mobile-nav-item outlet" style="color:#c44">Outlet</a>
        </div>
        <div class="mobile-nav-footer">
          <a href="giris">👤 &nbsp; Hesabım</a>
          <a href="sepet">🛍️ &nbsp; Sepetim</a>
        </div>
      </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', drawerHTML);
  }

  window.openMobileNav = function() {
    document.getElementById('mobileNav')?.classList.add('open');
    document.documentElement.classList.add('mobile-menu-open');
    document.body.classList.add('mobile-menu-open');
    document.body.style.overflow = 'hidden';
  };
  window.closeMobileNav = function() {
    document.getElementById('mobileNav')?.classList.remove('open');
    document.documentElement.classList.remove('mobile-menu-open');
    document.body.classList.remove('mobile-menu-open');
    document.body.style.overflow = '';
  };
  window.toggleMobileSub = function(id) {
    const sub = document.getElementById(id);
    if (!sub) return;
    sub.classList.toggle('open');
  };

  // ── HAMBURGER ───────────────────────────────────
  function initHamburger() {
    const btn = document.querySelector('.hamburger');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const isOpen = btn.classList.toggle('open');
      if (isOpen) openMobileNav();
      else closeMobileNav();
    });
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
    document.addEventListener('click', e => {
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
    });
  }

  // ── QUICK VIEW MODAL ────────────────────────────
  function initQuickView() {
    document.addEventListener('click', e => {
      const btn = e.target.closest('.quick-view');
      if (!btn) return;
      e.stopPropagation();
      const card  = btn.closest('.prod-card');
      const productId = card?.dataset.productId || '';
      const name  = card?.dataset.productName || card?.querySelector('h4')?.textContent || 'Ürün';
      const price = card?.dataset.productPriceLabel || card?.querySelector('.p-new')?.textContent || '';
      const emoji = card?.dataset.productEmoji || card?.querySelector('.prod-emoji, [style*="z-index:1"]')?.textContent || '🧕';
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
              <button class="qv-close" onclick="document.getElementById('quickViewModal').classList.remove('open');document.body.style.overflow=''">×</button>
              <p style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#888;margin-bottom:12px;">HIZLI ÖNIZLEME</p>
              <h2 id="qvName" style="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:400;margin-bottom:10px;"></h2>
              <p id="qvPrice" style="font-size:20px;font-weight:600;color:#3d6b38;margin-bottom:24px;"></p>
              <div style="display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap;" id="qvSizes"></div>
              <a href="urun" id="qvLink" class="btn-primary" style="display:block;text-align:center;">Ürün Sayfasına Git →</a>
              <button id="qvAddBtn"
                style="width:100%;background:#3d6b38;color:#fff;border:none;padding:13px;font-family:'Jost',sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;cursor:pointer;margin-top:10px;transition:background .2s;"
                onmouseover="this.style.background='#2a4827'" onmouseout="this.style.background='#3d6b38'">Sepete Ekle</button>
            </div>
          </div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', e => { if (e.target === modal) { modal.classList.remove('open'); document.body.style.overflow = ''; } });
      }

      const qvImg = document.getElementById('qvImg');
      qvImg.innerHTML = image
        ? '<img src="' + escapeHtml(image) + '" alt="' + escapeHtml(name) + '" style="width:100%;height:100%;object-fit:cover;display:block"/>'
        : escapeHtml(emoji);
      document.getElementById('qvName').textContent = name;
      document.getElementById('qvPrice').textContent = price;
      document.getElementById('qvLink').href = productId ? ('urun?id=' + productId) : 'urun';
      const sizes = ['XS','S','M','L','XL','XXL'];
      document.getElementById('qvSizes').innerHTML = sizes.map(s =>
        `<button onclick="this.style.background=this.style.background?'':'#1a1a1a';this.style.color=this.style.color?'':'#fff'"
          style="padding:8px 14px;border:1px solid #e8e2d9;background:#fff;font-family:'Jost',sans-serif;font-size:12px;cursor:pointer;transition:all .2s">${s}</button>`
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
    });
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

    const announce = document.querySelector('.announce');
    const announcementEnabled = !(siteSettings.features && siteSettings.features.announcement === false);
    if (announce && !announcementEnabled) {
      announce.style.display = 'none';
      document.documentElement.style.setProperty('--announcement-offset', '0px');
    }

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
  window.openFilterDrawer = function() {
    document.getElementById('filterDrawer')?.classList.add('open');
    document.getElementById('filterDrawerOverlay')?.classList.add('open');
    document.body.style.overflow = 'hidden';
  };
  window.closeFilterDrawer = function() {
    document.getElementById('filterDrawer')?.classList.remove('open');
    document.getElementById('filterDrawerOverlay')?.classList.remove('open');
    document.body.style.overflow = '';
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
      icon.addEventListener('click', () => {
        if (window.matchMedia('(max-width: 768px)').matches && openMobileSearch()) {
          return;
        }
        box.classList.toggle('open');
        if (box.classList.contains('open')) {
          input?.focus();
        }
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

  // ── CAMPAIGN BANNER SLIDER ──────────────────────
  async function initCampaignBanner() {
    const announce = document.querySelector('.announce');
    if (!announce) return;

    const announcementEnabled = !(siteSettings.features && siteSettings.features.announcement === false);
    if (!announcementEnabled) return;

    const fallbackText = siteSettings.announcementText || defaultSettings.announcementText;

    function showFallback() {
      announce.innerHTML = '<span class="announce-link">' + escapeHtml(fallbackText) + '</span>';
      announce.style.display = '';
      document.documentElement.style.setProperty('--announcement-offset', '38px');
    }

    const api = window.SuveraAPI;
    if (!api || typeof api.request !== 'function') {
      showFallback();
      return;
    }

    try {
      const campaigns = await api.request('/campaigns');

      if (!Array.isArray(campaigns) || !campaigns.length) {
        announce.style.display = 'none';
        document.documentElement.style.setProperty('--announcement-offset', '0px');
        return;
      }

      let currentIndex = 0;
      let autoTimer = null;

      function renderCurrent() {
        const link = announce.querySelector('.announce-link');
        if (link) link.textContent = campaigns[currentIndex].name;
      }

      function goTo(index) {
        currentIndex = ((index % campaigns.length) + campaigns.length) % campaigns.length;
        renderCurrent();
      }

      function startAuto() {
        if (autoTimer) clearInterval(autoTimer);
        if (campaigns.length > 1) {
          autoTimer = setInterval(function () { goTo(currentIndex + 1); }, 4000);
        }
      }

      if (campaigns.length > 1) {
        announce.innerHTML =
          '<button class="announce-arrow" type="button" aria-label="Önceki kampanya">&#8249;</button>' +
          '<span class="announce-link">' + escapeHtml(campaigns[0].name) + '</span>' +
          '<button class="announce-arrow" type="button" aria-label="Sonraki kampanya">&#8250;</button>';

        const arrows = announce.querySelectorAll('.announce-arrow');
        arrows[0].addEventListener('click', function () { goTo(currentIndex - 1); startAuto(); });
        arrows[1].addEventListener('click', function () { goTo(currentIndex + 1); startAuto(); });
      } else {
        announce.innerHTML = '<span class="announce-link">' + escapeHtml(campaigns[0].name) + '</span>';
      }

      announce.style.display = '';
      document.documentElement.style.setProperty('--announcement-offset', '38px');
      startAuto();
    } catch (_) {
      showFallback();
    }
  }

  // ── INIT ALL ────────────────────────────────────
  function init() {
    injectSkipLink();
    applySiteSettings();
    initCampaignBanner().catch(function () {});
    redirectPaymentReturn();
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
