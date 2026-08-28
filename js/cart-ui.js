import { formatMoney as money, escapeHtml } from './core/storefront-utils.js';
(function () {
  'use strict';

  // Server cart is canonical; localStorage 'suveraCart' is only a UI mirror.
  const IMPORT_FLAG = 'suveraCartImported';
  let serverCart = null;
  let loadState = 'idle'; // idle | loading | ready | error
  let storeSettings = null;
  let syncing = false;
  let mutating = false;
  let pendingFocus = null;

  function cartApi() {
    return window.SuveraAPI && window.SuveraAPI.cart ? window.SuveraAPI.cart : null;
  }

  function mirror() {
    return window.Suvera && window.Suvera.mirrorServerCart
      ? window.Suvera.mirrorServerCart(serverCart)
      : [];
  }

  function items() {
    return (serverCart && Array.isArray(serverCart.items) ? serverCart.items : []).map((it) => ({
      product_id: it.product_id, variant_id: it.variant_id, name: it.product_name,
      price: Number(it.unit_price), qty: Number(it.quantity), color: it.color, size: it.size,
      image: it.image, emoji: it.emoji,
      variant: [it.color, it.size].filter(Boolean).join(' / ') || 'Standart', line_total: Number(it.line_total),
    }));
  }

  function cartSubtotal() { return serverCart ? Number(serverCart.subtotal) : 0; }
  function cartDiscount() { return serverCart ? Number(serverCart.discount_total) : 0; }
  function cartVersion() { return serverCart ? serverCart.version : null; }

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
    } catch (_) { storeSettings = {}; }
    return storeSettings;
  }

  // Reuse the storefront-wide live region. A second cart-only region would announce the
  // same transition twice when shared cart state and this full-page view update together.
  function announce(message, assertive = false) {
    if (!message) return;
    if (window.SuveraA11y && window.SuveraA11y.announce) {
      window.SuveraA11y.announce(message, assertive);
    }
    const visibleStatus = document.getElementById('cartStatus');
    if (visibleStatus) visibleStatus.textContent = message;
  }

  function productHref(item) {
    return `urun?id=${encodeURIComponent(item.product_id)}`;
  }

  function setInteractionBusy(busy) {
    mutating = busy;
    const container = document.getElementById('cartItems');
    if (container) container.setAttribute('aria-busy', busy ? 'true' : 'false');
    document.querySelectorAll('[data-cart-mutation], #cartCouponCode').forEach((control) => {
      if ('disabled' in control) control.disabled = busy;
    });
    const checkout = document.getElementById('cartCheckoutLink');
    if (checkout && busy) checkout.setAttribute('aria-disabled', 'true');
  }

  function restoreMutationFocus() {
    if (!pendingFocus) return;
    const target = pendingFocus.selector ? document.querySelector(pendingFocus.selector) : null;
    const fallback = document.querySelector('[data-action="cart-remove"], [data-action="cart-qty"], #cartEmptyHeading, #cartCheckoutLink');
    const focusTarget = target || fallback;
    pendingFocus = null;
    if (focusTarget instanceof HTMLElement) focusTarget.focus();
  }

  const ADJUSTMENT_TEXT = {
    ITEM_REMOVED: 'Bazı ürünler artık satışta olmadığı için sepetten çıkarıldı.',
    ITEM_OUT_OF_STOCK: 'Bazı ürünler stokta kalmadığı için sepetten çıkarıldı.',
    QUANTITY_REDUCED: 'Stok nedeniyle bazı ürünlerin adedi güncellendi.',
    PRICE_CHANGED: 'Bazı ürünlerin fiyatı güncellendi.',
    COUPON_INVALID: 'Kupon artık geçerli olmadığı için kaldırıldı.',
  };
  function adjustmentMessage(adjustments) {
    if (!Array.isArray(adjustments) || !adjustments.length) return '';
    const codes = [...new Set(adjustments.map((adjustment) => adjustment.code))];
    return codes.map((code) => ADJUSTMENT_TEXT[code]).filter(Boolean).join(' ');
  }

  function itemVisual(item) {
    if (item.image) {
      const src = window.SuveraAPI ? window.SuveraAPI.assetUrl(item.image) : item.image;
      const responsive = window.SuveraAPI && window.SuveraAPI.responsiveImage ? window.SuveraAPI.responsiveImage(src, 'thumbnail') : { src, srcset: '' };
      const responsiveAttrs = responsive.srcset ? ` srcset="${escapeHtml(responsive.srcset)}" sizes="80px"` : '';
      return `<img src="${escapeHtml(responsive.src)}"${responsiveAttrs} alt="${escapeHtml(item.name)}" loading="lazy" decoding="async" data-css="width:100%;height:100%;object-fit:cover;"/>`;
    }
    return '<span class="product-media-placeholder" aria-hidden="true"></span>';
  }

  function renderCartPage() {
    const container = document.getElementById('cartItems');
    if (!container) return;
    const list = items();
    const subtotal = cartSubtotal();
    const shipping = computeShipping(subtotal);
    const pageCount = document.querySelector('.page-count');
    if (pageCount) {
      const qty = list.reduce((sum, item) => sum + Number(item.qty || 1), 0);
      pageCount.textContent = `(${qty} Ürün)`;
    }

    if (loadState === 'loading' && !list.length) {
      container.innerHTML = '<p data-css="padding:40px 0;text-align:center;color:#555;font-size:18px">Sepetiniz yükleniyor…</p>';
    } else if (loadState === 'error') {
      container.innerHTML = '<div data-css="padding:32px 0;text-align:center"><p data-css="color:#8b1d1d;font-size:16px" role="alert">Sepet yüklenemedi.</p><button type="button" class="btn" data-action="cart-retry">Tekrar dene</button></div>';
    } else if (!list.length) {
      container.innerHTML = '<div class="cart-empty"><h3 id="cartEmptyHeading" tabindex="-1">Sepetiniz boş</h3><p>Yeni sezon seçkisinden birkaç parça ekleyerek alışverişe devam edebilirsiniz.</p><a class="empty-cta" href="urunler">Alışverişe Dön</a></div>';
    } else {
      container.innerHTML = list.map((item, index) => {
        const qty = Number(item.qty || 1);
        const price = Number(item.price || 0);
        const href = productHref(item);
        return `
          <div class="cart-item" data-index="${index}" data-variant-id="${escapeHtml(String(item.variant_id))}">
            <a class="cart-item-img" href="${escapeHtml(href)}" aria-label="${escapeHtml(item.name || 'Ürün')} ürününü görüntüle">${itemVisual(item)}</a>
            <div class="cart-item-body">
              <p class="cart-item-brand">Suvera</p>
              <h3 class="cart-item-name"><a href="${escapeHtml(href)}">${escapeHtml(item.name || 'Ürün')}</a></h3>
              <p class="cart-item-variant">${escapeHtml(item.variant || 'Standart')}</p>
              <p class="cart-item-unit">Birim Fiyatı: ${money(price)}</p>
              <div class="qty-row" role="group" aria-label="${escapeHtml(item.name || 'Ürün')} adet işlemleri">
                <button class="qty-btn" type="button" data-cart-mutation data-action="cart-qty" data-index="${index}" data-delta="-1" aria-label="${escapeHtml(item.name || 'Ürün')} adedini azalt (şu an ${qty})">−</button>
                <span class="qty-num" aria-label="Güncel adet ${qty}">${qty}</span>
                <button class="qty-btn" type="button" data-cart-mutation data-action="cart-qty" data-index="${index}" data-delta="1" aria-label="${escapeHtml(item.name || 'Ürün')} adedini artır (şu an ${qty})">+</button>
                <button class="del-btn" type="button" data-cart-mutation data-action="cart-remove" data-index="${index}" aria-label="${escapeHtml(item.name || 'Ürün')} ürününü sepetten kaldır">🗑</button>
              </div>
            </div>
            <div class="cart-item-price"><strong>${money(price * qty)}</strong><small>Toplam</small></div>
          </div>`;
      }).join('');
    }

    const subtotalEl = document.getElementById('subtotal');
    const shippingEl = document.getElementById('cartShipping');
    const discountRow = document.getElementById('cartDiscountRow');
    const discountEl = document.getElementById('cartDiscount');
    const totalEl = document.getElementById('total');
    const discount = cartDiscount();
    if (subtotalEl) subtotalEl.textContent = money(subtotal);
    if (shippingEl) shippingEl.textContent = shipping ? money(shipping) : 'Ücretsiz';
    if (discountRow) discountRow.hidden = discount <= 0;
    if (discountEl) discountEl.textContent = `-${money(discount)}`;
    if (totalEl) totalEl.textContent = money(Math.max(0, subtotal - discount) + shipping);
    const clearButton = document.querySelector('[data-action="clear-cart"]');
    if (clearButton) clearButton.hidden = !list.length;
    const checkout = document.getElementById('cartCheckoutLink');
    const checkoutNote = document.getElementById('checkoutAvailability');
    if (checkout) {
      if (list.length) {
        checkout.setAttribute('href', 'siparis');
        checkout.removeAttribute('aria-disabled');
        checkout.removeAttribute('aria-describedby');
        checkout.removeAttribute('tabindex');
      } else {
        checkout.removeAttribute('href');
        checkout.setAttribute('aria-disabled', 'true');
        checkout.setAttribute('aria-describedby', 'checkoutAvailability');
        checkout.setAttribute('tabindex', '-1');
      }
    }
    if (checkoutNote) checkoutNote.hidden = list.length > 0;
    paintCoupon();
    container.setAttribute('aria-busy', mutating || loadState === 'loading' ? 'true' : 'false');
    restoreMutationFocus();
  }

  function paintCoupon(message, { error = false } = {}) {
    const resultEl = document.getElementById('cartCouponResult');
    const removeButton = document.getElementById('cartCouponRemove');
    const input = document.getElementById('cartCouponCode');
    const applied = serverCart && serverCart.coupon_applied;
    if (input && applied && !input.value) input.value = serverCart.coupon_code;
    if (resultEl) {
      resultEl.textContent = message || (applied
        ? `Kupon uygulandı: -${money(cartDiscount())} · Yeni toplam ${money(Number(serverCart.grand_total))}`
        : '');
      resultEl.setAttribute('role', error ? 'alert' : 'status');
    }
    if (input) input.setAttribute('aria-invalid', error ? 'true' : 'false');
    if (removeButton) removeButton.style.display = applied ? 'inline-block' : 'none';
  }

  function renderCheckoutPage() {
    const summary = document.querySelector('.checkout-summary');
    if (!summary) return;
    const list = items();
    const subtotal = cartSubtotal();
    const markup = list.length ? list.map((item) => {
      const qty = Number(item.qty || 1);
      const price = Number(item.price || 0);
      return `
        <div class="order-item">
          <div class="order-item-img">${itemVisual(item)}<span class="order-qty-badge">${qty}</span></div>
          <div class="order-item-info"><h5>${escapeHtml(item.name || 'Ürün')}</h5><p>${escapeHtml(item.variant || 'Standart')}</p></div>
          <span class="order-item-price">${money(price * qty)}</span>
        </div>`;
    }).join('') : '<p data-css="padding:20px 0;color:#888">Sepetiniz boş.</p>';
    summary.querySelectorAll('.order-item').forEach((el) => el.remove());
    const coupon = summary.querySelector('.coupon-row');
    if (coupon) coupon.insertAdjacentHTML('beforebegin', markup);
    updateCheckoutTotals(subtotal);
  }

  function updateCheckoutTotals(subtotal = cartSubtotal()) {
    const shipping = computeShipping(subtotal);
    const discount = cartDiscount();
    const total = Math.max(0, subtotal - discount) + shipping;
    const summaryRows = document.querySelectorAll('.checkout-summary .summary-row');
    const productTotal = summaryRows[0]?.querySelector('strong');
    const shippingCost = document.getElementById('shippingCost');
    const grandTotal = document.getElementById('grandTotal');
    const payAmountBtn = document.getElementById('payAmountBtn');
    if (productTotal) productTotal.textContent = money(subtotal);
    if (shippingCost) {
      shippingCost.textContent = shipping ? money(shipping) : 'Ücretsiz';
      shippingCost.style.color = shipping ? 'var(--black)' : '#4a7c59';
    }
    if (grandTotal) grandTotal.textContent = money(total);
    if (payAmountBtn) payAmountBtn.textContent = money(total) + ' ÖDE';
  }

  function renderAll() {
    renderCartPage();
    renderCheckoutPage();
  }

  // ── SERVER SYNC ──────────────────────────────────
  async function importLegacyOnce() {
    if (localStorage.getItem(IMPORT_FLAG) === '1') return false;
    let legacy = [];
    try { legacy = JSON.parse(localStorage.getItem('suveraCart') || '[]'); } catch (_) { legacy = []; }
    const importable = legacy.filter((it) => it && it.variant_id && Number(it.qty) > 0);
    if (!importable.length) { localStorage.setItem(IMPORT_FLAG, '1'); return false; }
    // Idempotent per variant: skip lines already on the server cart so a re-run
    // (e.g. after a mid-import reload) never double-adds. The flag is written only
    // after every line succeeds, so a partial failure is retried on the next load.
    const present = new Set((serverCart && serverCart.items ? serverCart.items : []).map((it) => String(it.variant_id)));
    let imported = false;
    let failed = 0;
    for (const it of importable) {
      if (present.has(String(it.variant_id))) continue;
      try {
        const res = await cartApi().addItem({ product_id: it.product_id || it.id, variant_id: it.variant_id, quantity: Number(it.qty) || 1 });
        serverCart = res.cart;
        present.add(String(it.variant_id));
        imported = true;
      } catch (_) { failed += 1; }
    }
    localStorage.setItem(IMPORT_FLAG, '1'); // one migration pass; deleted/invalid lines are not retried
    if (failed) announce('Bazı eski sepet ürünleri artık uygun olmadığı için aktarılamadı.');
    return imported;
  }

  async function sync({ render = true } = {}) {
    const api = cartApi();
    if (!api || syncing) return;
    syncing = true;
    loadState = 'loading';
    if (render) renderAll();
    try {
      const res = await api.get();
      serverCart = res && res.cart ? res.cart : null;
      // Migrate a pre-existing legacy cart exactly once (idempotent per variant).
      if (localStorage.getItem(IMPORT_FLAG) !== '1') {
        if (await importLegacyOnce()) { const again = await api.get(); serverCart = again.cart; }
      }
      mirror();
      loadState = 'ready';
      announce(adjustmentMessage(serverCart && serverCart.adjustments));
    } catch (_) {
      loadState = 'error';
    } finally {
      syncing = false;
    }
    if (render) renderAll();
  }

  async function mutate(operation, { successMessage = '', focus = null } = {}) {
    const api = cartApi();
    if (!api || mutating) return null;
    pendingFocus = focus;
    setInteractionBusy(true);
    try {
      const res = await operation(api);
      serverCart = res.cart;
      mirror();
      loadState = 'ready';
      const adjustment = adjustmentMessage(serverCart.adjustments);
      announce([successMessage, adjustment].filter(Boolean).join(' '));
      renderAll();
      return res;
    } catch (error) {
      if (error && error.status === 409) {
        announce('Sepet başka bir yerde güncellendi, yeniden yüklendi.');
        await sync();
      } else {
        announce(error && error.message ? error.message : 'Sepet işlemi başarısız oldu.', true);
      }
      renderAll();
      throw error;
    } finally {
      setInteractionBusy(false);
    }
  }

  function variantAt(index) {
    const list = items();
    return list[index] ? list[index] : null;
  }

  window.changeQty = function (indexOrBtn, delta) {
    let index = Number(indexOrBtn);
    if (!Number.isInteger(index)) {
      const row = indexOrBtn && indexOrBtn.closest ? indexOrBtn.closest('.cart-item') : null;
      index = Number(row?.dataset.index || 0);
    }
    const item = variantAt(index);
    if (!item || mutating) return;
    const nextQty = Math.max(1, Number(item.qty || 1) + Number(delta || 0));
    const selector = `[data-variant-id="${CSS.escape(String(item.variant_id))}"] [data-action="cart-qty"][data-delta="${Number(delta)}"]`;
    void mutate((api) => api.setQuantity(item.variant_id, nextQty, cartVersion()), {
      successMessage: `${item.name || 'Ürün'} adedi ${nextQty} olarak güncellendi.`,
      focus: { selector },
    }).catch(() => {});
  };

  window.removeCartItem = function (index) {
    const item = variantAt(Number(index));
    if (!item || mutating) return;
    const list = items();
    const neighbour = list[Number(index) + 1] || list[Number(index) - 1];
    const selector = neighbour
      ? `[data-variant-id="${CSS.escape(String(neighbour.variant_id))}"] [data-action="cart-remove"]`
      : '#cartEmptyHeading';
    void mutate((api) => api.removeItem(item.variant_id, cartVersion()), {
      successMessage: `${item.name || 'Ürün'} sepetten kaldırıldı.`,
      focus: { selector },
    }).catch(() => {});
  };

  window.clearCart = function () {
    if (mutating || !items().length) return;
    if (!confirm('Sepeti temizlemek istediğinize emin misiniz?')) return;
    void mutate((api) => api.clear(cartVersion()), {
      successMessage: 'Sepet temizlendi.',
      focus: { selector: '#cartEmptyHeading' },
    }).catch(() => {});
  };

  window.selectCargo = function (el) {
    document.querySelectorAll('.cargo-opt').forEach((opt) => {
      opt.classList.remove('act');
      const input = opt.querySelector('input');
      if (input) input.checked = false;
    });
    el.classList.add('act');
    const input = el.querySelector('input');
    if (input) input.checked = true;
    updateCheckoutTotals();
  };

  async function applyCoupon(code) {
    const target = String(code || '').trim();
    const input = document.getElementById('cartCouponCode');
    if (!target) {
      paintCoupon('Kupon kodunu yazın.', { error: true });
      announce('Kupon kodunu yazın.', true);
      if (input) input.focus();
      return;
    }
    try {
      await mutate((api) => api.applyCoupon(target, cartVersion()), {
        successMessage: `${target} kuponu uygulandı.`,
        focus: { selector: '#cartCouponCode' },
      });
      if (window.SuveraCoupons && window.SuveraCoupons.save) window.SuveraCoupons.save(target);
      paintCoupon();
    } catch (error) {
      paintCoupon(error && error.message ? error.message : 'Kupon uygulanamadı', { error: true });
      if (input) input.focus();
    }
  }

  async function removeCoupon() {
    try {
      await mutate((api) => api.removeCoupon(cartVersion()), {
        successMessage: 'Kupon kaldırıldı.',
        focus: { selector: '#cartCouponCode' },
      });
      if (window.SuveraCoupons && window.SuveraCoupons.clear) window.SuveraCoupons.clear();
      paintCoupon('Kupon kaldırıldı');
    } catch (_) { /* handled by mutate */ }
  }

  function bindCoupon() {
    const input = document.getElementById('cartCouponCode');
    const applyButton = document.getElementById('cartCouponApply');
    const removeButton = document.getElementById('cartCouponRemove');
    if (!input || !applyButton) return;
    applyButton.addEventListener('click', function () { if (!mutating) void applyCoupon(input.value); });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !mutating) { event.preventDefault(); void applyCoupon(input.value); }
    });
    removeButton?.addEventListener('click', function () { input.value = ''; void removeCoupon(); });
  }

  // Retry + multi-tab invalidation (canonical data always re-fetched from server).
  document.addEventListener('click', function (event) {
    const retry = event.target.closest ? event.target.closest('[data-action="cart-retry"]') : null;
    if (retry) { event.preventDefault(); void sync(); }
  });
  window.addEventListener('storage', function (event) {
    if (event.key === 'suveraCart' || event.key === 'suveraCartPing') void sync();
  });

  document.addEventListener('DOMContentLoaded', () => {
    loadStoreSettings().finally(() => { bindCoupon(); void sync(); });
  });

  window.SuveraCartUI = {
    sync,
    addItem: (payload) => mutate((api) => api.addItem(payload)),
    setQuantity: (variantId, qty) => mutate((api) => api.setQuantity(variantId, qty, cartVersion())),
    removeVariant: (variantId) => mutate((api) => api.removeItem(variantId, cartVersion())),
    clear: () => mutate((api) => api.clear(cartVersion())),
    applyCoupon,
    removeCoupon,
    loadCart: () => (window.Suvera && window.Suvera.cartMirror ? window.Suvera.cartMirror.read() : []),
    currentCart: () => serverCart,
    cartSubtotal,
    computeShipping,
    renderCartPage,
    renderCheckoutPage,
    loadStoreSettings,
    storeSettings: () => storeSettings || {},
  };
})();
