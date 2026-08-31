const modal = document.getElementById('consentPreferences');
const preferencesToggle = document.getElementById('consentPreferencesToggle');
const analyticsToggle = document.getElementById('consentAnalyticsToggle');
let returnFocus = null;

function focusableElements() {
  return Array.from(modal?.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href]') || [])
    .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
}

function setBackgroundInert(inert) {
  Array.from(document.body.children).forEach((node) => {
    if (node === modal) return;
    if (inert) {
      node.dataset.consentWasAriaHidden = node.getAttribute('aria-hidden') || '';
      node.inert = true;
      node.setAttribute('aria-hidden', 'true');
    } else if (Object.prototype.hasOwnProperty.call(node.dataset, 'consentWasAriaHidden')) {
      const previous = node.dataset.consentWasAriaHidden;
      node.inert = false;
      if (previous) node.setAttribute('aria-hidden', previous);
      else node.removeAttribute('aria-hidden');
      delete node.dataset.consentWasAriaHidden;
    }
  });
}

export function closeConsentPreferences() {
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  setBackgroundInert(false);
  document.body.classList.remove('consent-modal-open');
  if (returnFocus instanceof HTMLElement) returnFocus.focus();
  returnFocus = null;
}

export function openConsentPreferences(trigger, consent) {
  if (!modal) return;
  returnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
  if (preferencesToggle) preferencesToggle.checked = Boolean(consent?.preferences);
  if (analyticsToggle) analyticsToggle.checked = Boolean(consent?.analytics);
  modal.hidden = false;
  setBackgroundInert(true);
  document.body.classList.add('consent-modal-open');
  const first = modal.querySelector('[data-consent-close]') || focusableElements()[0];
  if (first instanceof HTMLElement) first.focus();
}

modal?.addEventListener('click', (event) => {
  if (event.target === modal || event.target.closest('[data-consent-action="close"]')) closeConsentPreferences();
  if (event.target.closest('[data-consent-action="save-preferences"]')) {
    window.SuveraConsent.save({ preferences: Boolean(preferencesToggle?.checked), analytics: Boolean(analyticsToggle?.checked) });
    closeConsentPreferences();
  }
  if (event.target.closest('[data-consent-action="necessary-only"]')) closeConsentPreferences();
});

modal?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.preventDefault(); closeConsentPreferences(); return; }
  if (event.key !== 'Tab') return;
  const focusable = focusableElements();
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
});
