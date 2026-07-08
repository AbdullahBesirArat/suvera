(function () {
  'use strict';

  const CART_KEY = 'suveraCart';
  let checkoutShipping = 0;
  let storeSettings = null;

  function loadCart() {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    } catch (_) {
      return [];
    }
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartDots(cart);
  }

  function updateCartDots(cart) {
    const total = cart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
    document.querySelectorAll('.cart-dot, #cartCount').forEach((el) => {
      el.textContent = total || '0';
    });
  }

  function money(value) {
    return Number(value || 0).toLocaleString('tr-TR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + ' TL';
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    }[char]));
  }

  function cartSubtotal(cart) {
    return cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 1), 0);
  }

  function computeShipping(subtotal) {
    const settings = storeSettings || {};
    const fee = Number(settings.shippingFee || 0);
    const threshold = Number(settings.freeShippingThreshold || 0);
    if (threshold > 0 && subtotal >= threshold) return 0;
    return Number.isFinite(fee) && fee > 0 ? fee : 0;
  }

  async function loadStoreSettings() {
    if (!window.SuveraAPI || !window.SuveraAPI.organization) return null;
    try {
      const organization = await window.SuveraAPI.organization.current();
      storeSettings = organization && organization.store_settings ? organization.store_settings : {};
      return storeSettings;
    } catch (_) {
      storeSettings = {};
      return storeSettings;
    }
  }

  function itemVisual(item, className) {
    if (item.image) {
      const src = window.SuveraAPI ? window.SuveraAPI.assetUrl(item.image) : item.image;
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(item.name)}" style="width:100%;height:100%;object-fit:cover;"/>`;
    }
    return escapeHtml(item.emoji || 'ğŸ‘—');
  }

  function ensureCartDrawer() {
    if (document.getElementById('cartDrawerOverlay')) return;

    document.body.insertAdjacentHTML('beforeend', `
      <div class="cart-drawer-overlay" id="cartDrawerOverlay" aria-hidden="true"></div>
      <aside class="cart-drawer" id="cartDrawer" role="dialog" aria-modal="true" aria-labelledby="cartDrawerTitle" tabindex="-1">
        <div class="cart-drawer-head">
          <div>
            <p class="cart-drawer-kicker">Suvera</p>
            <h2 id="cartDrawerTitle">Sepetim (0)</h2>
          </div>
          <button class="cart-drawer-close" type="button" aria-label="Sepeti kapat">×</button>
        </div>
        <div class="cart-drawer-body" id="cartDrawerBody"></div>
        <div class="cart-drawer-foot" id="cartDrawerFoot"></div>
      </aside>
    `);

    document.getElementById('cartDrawerOverlay').addEventListener('click', closeCartDrawer);
    document.querySelector('.cart-drawer-close').addEventListener('click', closeCartDrawer);
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') closeCartDrawer();
    });
    document.addEventListener('click', function(event) {
      const link = event.target.closest('a[href]');
      if (!link) return;
      const href = String(link.getAttribute('href') || '').replace(/^\.?\//, '').split(/[?#]/)[0];
      if (href !== 'sepet' && href !== 'sepet.html') return;
      if (link.closest('.cart-drawer')) return;
      if (document.body.classList.contains('cart-page') || /\/sepet(?:\.html)?\/?$/.test(location.pathname)) return;
      event.preventDefault();
      openCartDrawer();
    });
  }

  function renderCartDrawer() {
    ensureCartDrawer();
    const cart = loadCart();
    const subtotal = cartSubtotal(cart);
    const shipping = computeShipping(subtotal);
    const totalQty = cart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
    const title = document.getElementById('cartDrawerTitle');
    const body = document.getElementById('cartDrawerBody');
    const foot = document.getElementById('cartDrawerFoot');

    if (title) title.textContent = `Sepetim (${totalQty})`;
    if (!body || !foot) return;

    if (!cart.length) {
      body.innerHTML = `
        <div class="cart-drawer-empty">
          <h3>Sepetiniz bos</h3>
          <p>Begendiginiz parcalari sepete ekleyerek odeme adimina gecebilirsiniz.</p>
          <button class="cart-drawer-secondary" type="button" data-cart-close>Alisverise devam et</button>
        </div>
      `;
      foot.innerHTML = '';
      body.querySelector('[data-cart-close]')?.addEventListener('click', closeCartDrawer);
      updateCartDots(cart);
      return;
    }

    body.innerHTML = cart.map((item, index) => {
      const qty = Number(item.qty || 1);
      const price = Number(item.price || 0);
      const variant = [item.color, item.size].filter(Boolean).join(' / ') || item.variant || 'Standart';
      return `
        <article class="cart-drawer-item" data-index="${index}">
          <div class="cart-drawer-img">${itemVisual(item)}</div>
          <div class="cart-drawer-info">
            <h3>${escapeHtml(item.name || 'Urun')}</h3>
            <p>${escapeHtml(variant)}</p>
            <strong>${money(price)}</strong>
            <div class="cart-drawer-qty" aria-label="Adet kontrolu">
              <button type="button" data-cart-delta="-1" data-index="${index}" aria-label="Adeti azalt">-</button>
              <span>${qty}</span>
              <button type="button" data-cart-delta="1" data-index="${index}" aria-label="Adeti artir">+</button>
              <button type="button" class="cart-drawer-remove" data-cart-remove data-index="${index}">Sil</button>
            </div>
          </div>
          <div class="cart-drawer-line-total">${money(price * qty)}</div>
        </article>
      `;
    }).join('');

    foot.innerHTML = `
      <div class="cart-drawer-total"><span>Alt toplam</span><strong>${money(subtotal)}</strong></div>
      <div class="cart-drawer-total muted"><span>Kargo</span><strong>${shipping ? money(shipping) : 'Ucretsiz'}</strong></div>
      <div class="cart-drawer-total grand"><span>Toplam</span><strong>${money(subtotal + shipping)}</strong></div>
      <a class="cart-drawer-checkout" href="siparis">Odeme Adimina Git</a>
      <a class="cart-drawer-link" href="sepet">Sepete Git</a>
    `;
    updateCartDots(cart);
  }

  function changeDrawerQty(index, delta) {
    const cart = loadCart();
    if (!cart[index]) return;
    const nextQty = Number(cart[index].qty || 1) + delta;
    if (nextQty < 1) cart.splice(index, 1);
    else cart[index].qty = nextQty;
    saveCart(cart);
    renderCartPage();
    renderCheckoutPage();
    renderCartDrawer();
  }

  function removeDrawerItem(index) {
    const cart = loadCart();
    if (!cart[index]) return;
    cart.splice(index, 1);
    saveCart(cart);
    renderCartPage();
    renderCheckoutPage();
    renderCartDrawer();
  }

  function openCartDrawer() {
    renderCartDrawer();
    document.getElementById('cartDrawerOverlay')?.classList.add('open');
    document.getElementById('cartDrawer')?.classList.add('open');
    document.body.classList.add('cart-drawer-open');
    document.body.style.overflow = 'hidden';
    document.getElementById('cartDrawer')?.focus();
  }

  function closeCartDrawer() {
    document.getElementById('cartDrawerOverlay')?.classList.remove('open');
    document.getElementById('cartDrawer')?.classList.remove('open');
    document.body.classList.remove('cart-drawer-open');
    document.body.style.overflow = '';
  }

  function renderCartPage() {
    const container = document.getElementById('cartItems');
    if (!container) return;

    const cart = loadCart();
    const subtotal = cartSubtotal(cart);
    const shipping = computeShipping(subtotal);
    const pageCount = document.querySelector('.page-count');

    if (pageCount) {
      const qty = cart.reduce((sum, item) => sum + Number(item.qty || 1), 0);
      pageCount.textContent = `(${qty} Ürün)`;
    }

    if (!cart.length) {
      container.innerHTML = '<p style="padding:40px 0;text-align:center;color:#aaa;font-size:20px">Sepetiniz boş.</p>';
    } else {
      container.innerHTML = cart.map((item, index) => {
        const qty = Number(item.qty || 1);
        const price = Number(item.price || 0);
        return `
          <div class="cart-item" data-index="${index}">
            <div class="cart-item-img">${itemVisual(item)}</div>
            <div class="cart-item-body">
              <p class="cart-item-brand">Suvera</p>
              <h3 class="cart-item-name">${escapeHtml(item.name || 'Ürün')}</h3>
              <p class="cart-item-variant">${escapeHtml(item.variant || item.size || 'Standart')}</p>
              <p class="cart-item-unit">Birim Fiyatı: ${money(price)}</p>
              <div class="qty-row">
                <button class="qty-btn" onclick="changeQty(${index},-1)">âˆ’</button>
                <span class="qty-num">${qty}</span>
                <button class="qty-btn" onclick="changeQty(${index},1)">+</button>
                <button class="del-btn" onclick="removeCartItem(${index})">ğŸ—‘</button>
              </div>
            </div>
            <div class="cart-item-price">
              <strong>${money(price * qty)}</strong>
              <small>Toplam</small>
            </div>
          </div>`;
      }).join('');
    }

    const subtotalEl = document.getElementById('subtotal');
    const totalEl = document.getElementById('total');
    if (subtotalEl) subtotalEl.textContent = money(subtotal);
    if (totalEl) totalEl.textContent = money(subtotal + shipping);
    updateCartDots(cart);
  }

  function renderCheckoutPage() {
    const summary = document.querySelector('.checkout-summary');
    if (!summary) return;

    const cart = loadCart();
    const subtotal = cartSubtotal(cart);
    const items = cart.length ? cart.map((item) => {
      const qty = Number(item.qty || 1);
      const price = Number(item.price || 0);
      return `
        <div class="order-item">
          <div class="order-item-img">
            ${itemVisual(item)}
            <span class="order-qty-badge">${qty}</span>
          </div>
          <div class="order-item-info">
            <h5>${escapeHtml(item.name || 'Ürün')}</h5>
            <p>${escapeHtml(item.variant || item.size || 'Standart')}</p>
          </div>
          <span class="order-item-price">${money(price * qty)}</span>
        </div>`;
    }).join('') : '<p style="padding:20px 0;color:#888">Sepetiniz boş.</p>';

    summary.querySelectorAll('.order-item').forEach((el) => el.remove());
    const coupon = summary.querySelector('.coupon-row');
    if (coupon) coupon.insertAdjacentHTML('beforebegin', items);

    updateCheckoutTotals(subtotal);
    updateCartDots(cart);
  }

  function updateCheckoutTotals(subtotal = cartSubtotal(loadCart())) {
    checkoutShipping = computeShipping(subtotal);
    const total = subtotal + checkoutShipping;
    const summaryRows = document.querySelectorAll('.checkout-summary .summary-row');
    const productTotal = summaryRows[0]?.querySelector('strong');
    const shippingCost = document.getElementById('shippingCost');
    const grandTotal = document.getElementById('grandTotal');
    const payAmountBtn = document.getElementById('payAmountBtn');

    if (productTotal) productTotal.textContent = money(subtotal);
    if (shippingCost) {
      shippingCost.textContent = checkoutShipping ? money(checkoutShipping) : 'Ücretsiz';
      shippingCost.style.color = checkoutShipping ? 'var(--black)' : '#4a7c59';
    }
    if (grandTotal) grandTotal.textContent = money(total);
    if (payAmountBtn) payAmountBtn.textContent = money(total) + ' ÖDE';
  }

  window.changeQty = function (indexOrBtn, delta) {
    const cart = loadCart();
    let index = Number(indexOrBtn);
    if (!Number.isInteger(index)) {
      const row = indexOrBtn.closest('.cart-item');
      index = Number(row?.dataset.index || 0);
    }
    if (!cart[index]) return;
    cart[index].qty = Math.max(1, Number(cart[index].qty || 1) + delta);
    saveCart(cart);
    renderCartPage();
  };

  window.removeCartItem = function (index) {
    const cart = loadCart();
    cart.splice(index, 1);
    saveCart(cart);
    renderCartPage();
  };

  window.clearCart = function () {
    if (!confirm('Sepeti temizlemek istediğinize emin misiniz?')) return;
    saveCart([]);
    renderCartPage();
  };

  window.selectCargo = function (el) {
    document.querySelectorAll('.cargo-opt').forEach((opt) => {
      opt.classList.remove('act');
      opt.querySelector('input').checked = false;
    });
    el.classList.add('act');
    el.querySelector('input').checked = true;
    checkoutShipping = computeShipping(cartSubtotal(loadCart()));
    updateCheckoutTotals();
  };

  document.addEventListener('DOMContentLoaded', () => {
    ensureCartDrawer();
    document.addEventListener('click', function(event) {
      const deltaButton = event.target.closest('[data-cart-delta]');
      if (deltaButton) {
        changeDrawerQty(Number(deltaButton.dataset.index), Number(deltaButton.dataset.cartDelta));
        return;
      }
      const removeButton = event.target.closest('[data-cart-remove]');
      if (removeButton) {
        removeDrawerItem(Number(removeButton.dataset.index));
      }
    });
    loadStoreSettings().finally(() => {
      renderCartPage();
      renderCheckoutPage();
      renderCartDrawer();
    });
  });

  window.SuveraCartUI = {
    loadCart,
    saveCart,
    renderCartPage,
    renderCheckoutPage,
    cartSubtotal,
    computeShipping,
    loadStoreSettings,
    renderCartDrawer,
    openCartDrawer,
    closeCartDrawer,
    storeSettings: () => storeSettings || {},
  };
})();
