// A23 preference center + one-click confirm/unsubscribe (the /tercihler page).
// CSP-safe (no inline scripts/styles/handlers). Confirm/unsubscribe tokens arrive in
// the URL, are consumed once, and are scrubbed from the address bar immediately so the
// raw token never lingers in history and is never written to storage.
(function () {
  'use strict';

  const root = document.getElementById('prefRoot');
  if (!root) return;

  const api = () => (window.SuveraAPI && window.SuveraAPI.notifications ? window.SuveraAPI : null);

  const PURPOSE_LABELS = {
    marketing: 'Kampanya ve fırsat e-postaları',
    stock_alert: 'Stok geldi bildirimleri',
    price_drop: 'Fiyat düştü bildirimleri',
    favorite_update: 'Favori ürün güncellemeleri',
    abandoned_cart: 'Sepet hatırlatmaları',
  };
  const SUBSCRIPTION_LABELS = {
    back_in_stock: 'Stok geldi',
    price_drop: 'Fiyat alarmı',
    favorite_update: 'Favori güncellemesi',
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  const banner = document.getElementById('prefBanner');
  function setBanner(kind, text) {
    if (!banner) return;
    banner.textContent = text || '';
    banner.dataset.kind = kind || '';
    banner.hidden = !text;
  }

  // Remove a consumed token from the URL without a navigation, so it leaves no trace.
  function scrubUrl() {
    try {
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (_) { /* history unavailable: ignore */ }
  }

  async function consumeToken() {
    const params = new URLSearchParams(window.location.search);
    const confirmToken = (params.get('confirm') || '').trim();
    const unsubToken = (params.get('unsub') || '').trim();
    const sdk = api();
    if (!sdk) return;
    if (confirmToken) {
      scrubUrl();
      try {
        await sdk.notifications.confirm(confirmToken);
        setBanner('ok', 'Aboneliğiniz onaylandı. Koşul gerçekleştiğinde size haber vereceğiz.');
      } catch (_) {
        setBanner('err', 'Onay bağlantısı geçersiz veya süresi dolmuş olabilir.');
      }
    } else if (unsubToken) {
      scrubUrl();
      try {
        await sdk.notifications.unsubscribe(unsubToken);
        setBanner('ok', 'Aboneliğiniz iptal edildi ve bu kanaldaki pazarlama bildirimleri durduruldu.');
      } catch (_) {
        setBanner('err', 'Bağlantı geçersiz veya süresi dolmuş olabilir.');
      }
    }
  }

  const signedIn = () => Boolean(window.SuveraAPI && window.SuveraAPI.hasCustomerSession && window.SuveraAPI.hasCustomerSession());

  function renderConsents(consents) {
    const box = document.getElementById('prefConsents');
    if (!box) return [];
    box.textContent = '';
    const current = new Map();
    for (const row of consents || []) current.set(`${row.channel}:${row.purpose}`, row.status === 'granted');
    const controls = [];
    for (const purpose of Object.keys(PURPOSE_LABELS)) {
      const key = `email:${purpose}`;
      const granted = current.get(key) === true;
      const label = el('label', 'pref-toggle');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = granted;
      input.dataset.channel = 'email';
      input.dataset.purpose = purpose;
      label.appendChild(input);
      label.appendChild(el('span', null, PURPOSE_LABELS[purpose]));
      box.appendChild(label);
      controls.push({ input, channel: 'email', purpose, original: granted });
    }
    return controls;
  }

  function renderSubscriptions(subscriptions) {
    const box = document.getElementById('prefSubscriptions');
    if (!box) return;
    box.textContent = '';
    const active = (subscriptions || []).filter((row) => row.status !== 'unsubscribed');
    if (!active.length) {
      box.appendChild(el('p', 'pref-empty', 'Aktif ürün bildiriminiz yok.'));
      return;
    }
    for (const sub of active) {
      const item = el('div', 'pref-sub');
      item.appendChild(el('span', 'pref-sub-type', SUBSCRIPTION_LABELS[sub.subscription_type] || sub.subscription_type));
      const cancel = el('button', 'pref-sub-cancel', 'İptal et');
      cancel.type = 'button';
      cancel.dataset.subId = String(sub.id);
      item.appendChild(cancel);
      box.appendChild(item);
    }
  }

  async function loadCenter() {
    const center = document.getElementById('prefCenter');
    const gate = document.getElementById('prefSignedOut');
    const sdk = api();
    if (!sdk) return;
    if (!signedIn()) {
      if (gate) gate.hidden = false;
      if (center) center.hidden = true;
      return;
    }
    if (gate) gate.hidden = true;
    if (center) center.hidden = false;
    let controls = [];
    try {
      const data = await sdk.notifications.preferences();
      controls = renderConsents(data.consents);
      renderSubscriptions(data.subscriptions);
    } catch (_) {
      setBanner('err', 'Tercihleriniz yüklenemedi. Lütfen tekrar deneyin.');
      return;
    }

    const saveBtn = document.getElementById('prefSave');
    const saveMsg = document.getElementById('prefSaveMsg');
    if (saveBtn) {
      saveBtn.addEventListener('click', async function () {
        const changes = controls
          .filter((control) => control.input.checked !== control.original)
          .map((control) => ({ channel: control.channel, purpose: control.purpose, granted: control.input.checked }));
        if (!changes.length) { if (saveMsg) saveMsg.textContent = 'Değişiklik yok.'; return; }
        saveBtn.disabled = true;
        try {
          await sdk.notifications.updatePreferences(changes);
          for (const control of controls) control.original = control.input.checked;
          if (saveMsg) saveMsg.textContent = 'Tercihleriniz güncellendi.';
        } catch (_) {
          if (saveMsg) saveMsg.textContent = 'Tercihler kaydedilemedi. Lütfen tekrar deneyin.';
        } finally {
          saveBtn.disabled = false;
        }
      });
    }

    const optOutBtn = document.getElementById('prefOptOut');
    if (optOutBtn) {
      optOutBtn.addEventListener('click', async function () {
        optOutBtn.disabled = true;
        try {
          await sdk.notifications.optOutMarketing();
          for (const control of controls) { control.input.checked = false; control.original = false; }
          setBanner('ok', 'Tüm pazarlama bildirimleri kapatıldı.');
        } catch (_) {
          setBanner('err', 'İşlem tamamlanamadı. Lütfen tekrar deneyin.');
        } finally {
          optOutBtn.disabled = false;
        }
      });
    }

    const subsBox = document.getElementById('prefSubscriptions');
    if (subsBox) {
      subsBox.addEventListener('click', async function (event) {
        const btn = event.target.closest('[data-sub-id]');
        if (!btn) return;
        btn.disabled = true;
        try {
          await sdk.notifications.cancelSubscription(btn.dataset.subId);
          const row = btn.closest('.pref-sub');
          if (row) row.remove();
        } catch (_) {
          btn.disabled = false;
        }
      });
    }
  }

  async function init() {
    await consumeToken();
    await loadCenter();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else void init();
})();
