(function () {
  'use strict';

  const COUPON_KEY = 'suvera:coupon:v1';

  function load() {
    try { return String(localStorage.getItem(COUPON_KEY) || '').trim(); } catch (_) { return ''; }
  }

  function save(code) {
    const normalized = String(code || '').trim().toLocaleUpperCase('tr-TR');
    try {
      if (normalized) localStorage.setItem(COUPON_KEY, normalized);
      else localStorage.removeItem(COUPON_KEY);
    } catch (_) {}
    return normalized;
  }

  function clear() {
    try { localStorage.removeItem(COUPON_KEY); } catch (_) {}
  }

  function items(cart) {
    return (cart || []).map(function (item) {
      return {
        product_id: item.product_id || item.id,
        variant_id: item.variant_id || item.variantId || null,
        quantity: Number(item.qty || item.quantity || 1),
      };
    }).filter(function (item) { return item.product_id; });
  }

  async function evaluate(cart, code, email) {
    if (!window.SuveraAPI || !window.SuveraAPI.coupons) throw new Error('Kupon servisi kullanilamiyor');
    const normalized = save(code);
    if (!normalized) throw new Error('Kupon kodunu girin');
    return window.SuveraAPI.coupons.evaluate({
      couponCode: normalized,
      email: String(email || '').trim(),
      items: items(cart),
    });
  }

  window.SuveraCoupons = { clear, evaluate, items, load, save };
})();
