// A23 product-page notifications: "notify me when back in stock" and a price alarm.
// CSP-safe: no inline scripts/styles/handlers, and the confirm/unsubscribe tokens are
// never returned here — they are emailed and consumed on the /tercihler page. The
// consent checkbox is never pre-checked.
(function () {
  'use strict';

  const section = document.getElementById('notifySection');
  if (!section) return;
  const productId = new URLSearchParams(window.location.search).get('id');
  if (!productId) return;

  const api = () => (window.SuveraAPI && window.SuveraAPI.notifications ? window.SuveraAPI : null);
  const state = { variantId: null, inStock: true };

  const stockBtn = document.getElementById('notifyStockBtn');
  const priceBtn = document.getElementById('notifyPriceBtn');
  const form = document.getElementById('notifyForm');
  const formTitle = document.getElementById('notifyFormTitle');
  const emailField = document.getElementById('notifyEmailField');
  const emailInput = document.getElementById('notifyEmail');
  const consentInput = document.getElementById('notifyConsent');
  const submitBtn = document.getElementById('notifySubmit');
  const cancelBtn = document.getElementById('notifyCancel');
  const status = document.getElementById('notifyStatus');

  let mode = 'back_in_stock';

  function signedIn() {
    return Boolean(window.SuveraAPI && window.SuveraAPI.hasCustomerSession && window.SuveraAPI.hasCustomerSession());
  }

  function setStatus(text) {
    if (status) status.textContent = text || '';
  }

  function openForm(nextMode, title) {
    mode = nextMode;
    setStatus('');
    if (formTitle) formTitle.textContent = title;
    // A signed-in customer notifies on their account address; guests must supply one.
    if (emailField) emailField.hidden = signedIn();
    if (consentInput) consentInput.checked = false;
    if (form) form.hidden = false;
  }

  function reflectStock() {
    // The back-in-stock action only makes sense while the selection is out of stock.
    if (stockBtn) stockBtn.hidden = state.inStock;
    // If the shopper closed the out-of-stock state while its form was open, drop it.
    if (mode === 'back_in_stock' && state.inStock && form && !form.hidden) {
      form.hidden = true;
    }
  }

  window.addEventListener('suvera:availability', function (event) {
    const detail = event && event.detail ? event.detail : {};
    if (detail.variantId != null) state.variantId = Number(detail.variantId);
    else state.variantId = null;
    state.inStock = Boolean(detail.inStock);
    reflectStock();
  });

  if (stockBtn) {
    stockBtn.addEventListener('click', function () {
      openForm('back_in_stock', 'Bu ürün stoğa girdiğinde size haber verelim.');
    });
  }
  if (priceBtn) {
    priceBtn.addEventListener('click', function () {
      openForm('price_drop', 'Fiyatı düştüğünde size haber verelim.');
    });
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', function () { if (form) form.hidden = true; setStatus(''); });
  }

  if (form) {
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      const sdk = api();
      if (!sdk) return;
      const guest = !signedIn();
      const email = emailInput ? emailInput.value.trim() : '';
      if (!consentInput || !consentInput.checked) {
        setStatus('Devam etmek için lütfen bildirim onayını işaretleyin.');
        return;
      }
      if (guest && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setStatus('Lütfen geçerli bir e-posta adresi girin.');
        return;
      }
      if (submitBtn) submitBtn.disabled = true;
      try {
        const payload = {
          product_id: Number(productId),
          subscription_type: mode,
          channel: 'email',
          consent: true,
        };
        if (mode === 'back_in_stock' && state.variantId != null) payload.variant_id = state.variantId;
        if (guest) payload.email = email;
        const result = await sdk.notifications.subscribe(payload);
        if (result && result.requires_confirmation) {
          setStatus('Onay e-postası gönderildi. Bildirimleri başlatmak için lütfen e-postanızdaki bağlantıya tıklayın.');
        } else {
          setStatus('Hazır! Koşul gerçekleştiğinde size e-posta göndereceğiz.');
        }
        form.reset();
        form.hidden = true;
      } catch (error) {
        if (error && error.status === 429) setStatus('Çok fazla istek. Lütfen biraz sonra tekrar deneyin.');
        else if (error && error.status === 422) setStatus('Bildirim için açık onay gereklidir.');
        else setStatus('Bildirim isteği alınamadı. Lütfen tekrar deneyin.');
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // Reveal the block on product pages once the SDK is present.
  section.hidden = false;
  reflectStock();
})();
