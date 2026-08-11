const CONSENT_KEY = 'suvera:privacy-consent:v1';
const banner = document.getElementById('consentBanner');

function readConsent() {
  try {
    const value = localStorage.getItem(CONSENT_KEY);
    return value === 'essential' || value === 'analytics' ? value : null;
  } catch {
    return null;
  }
}

function applyConsent(value) {
  document.documentElement.dataset.consent = value || 'unset';
  if (banner) banner.hidden = Boolean(value);
  window.dispatchEvent(new CustomEvent('suvera:consent', { detail: { analytics: value === 'analytics' } }));
}

banner?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-consent]');
  if (!button) return;
  const value = button.dataset.consent;
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // The selection still applies for this page when storage is restricted.
  }
  applyConsent(value);
});

applyConsent(readConsent());
