(function () {
  'use strict';
  const LABEL = 'Suvera Instagram hesabını aç';
  const clean = (value) => String(value || '').trim();
  const all = (selector) => document.querySelectorAll(selector);
  function canonicalInstagramUrl(value) {
    try {
      const url = new URL(clean(value));
      const handle = url.pathname.split('/').filter(Boolean)[0] || '';
      return url.protocol === 'https:'
        && url.hostname.toLowerCase().replace(/^www\./, '') === 'instagram.com'
        && /^[a-zA-Z0-9._]+$/.test(handle)
        ? 'https://www.instagram.com/' + handle
        : '';
    } catch (_) { return ''; }
  }
  function normalize(organization) {
    const settings = organization && typeof organization.store_settings === 'object' ? organization.store_settings : {};
    const brand = settings.brand || {};
    const social = settings.social || {};
    const contact = settings.contact || {};
    const instagramUrl = canonicalInstagramUrl(social.instagramUrl || social.instagram);
    const handle = clean(social.instagramHandle).replace(/^@+/, '');
    const district = clean(contact.district);
    const city = clean(contact.city);
    const postal = clean(contact.postalCode);
    return {
      displayName: clean(brand.name),
      storeType: clean(settings.storeType),
      instagramUrl,
      instagramHandle: instagramUrl && handle ? '@' + handle : '',
      addressLine1: clean(contact.addressLine1),
      addressLine2: clean(contact.addressLine2),
      locality: [district, city].filter(Boolean).join(' / ') + (postal ? ' ' + postal : ''),
      serviceNotes: Array.isArray(settings.serviceNotes)
        ? settings.serviceNotes.filter((note) => typeof note === 'string').map(clean).filter(Boolean).slice(0, 12)
        : [],
    };
  }
  function setText(selector, value) {
    all(selector).forEach((node) => {
      node.textContent = value;
      node.hidden = !value;
    });
  }
  function noteElement(container, note) {
    const card = document.createElement(container.classList.contains('service-grid') || container.classList.contains('page-checklist') ? 'div' : 'span');
    if (container.classList.contains('service-grid')) card.className = 'service-card';
    else if (container.classList.contains('page-checklist')) card.className = 'page-check';
    else card.className = 'store-service-item';
    const target = card.className === 'store-service-item' ? card : card.appendChild(document.createElement('strong'));
    target.textContent = note;
    return card;
  }
  function render(profile) {
    setText('[data-store-display-name]', profile.displayName);
    setText('[data-store-type]', profile.storeType);
    setText('[data-store-instagram-handle]', profile.instagramHandle);
    setText('[data-store-address-line1]', profile.addressLine1);
    setText('[data-store-address-line2]', profile.addressLine2);
    setText('[data-store-address-locality]', profile.locality);

    const hasInstagram = Boolean(profile.instagramUrl && profile.instagramHandle);
    all('[data-store-instagram]').forEach((link) => {
      link.hidden = !hasInstagram;
      if (!hasInstagram) return link.removeAttribute('href');
      link.href = profile.instagramUrl;
    });
    all('[data-store-instagram-row]').forEach((row) => { row.hidden = !hasInstagram; });

    all('[data-store-service-notes]').forEach((container) => {
      container.replaceChildren(...profile.serviceNotes.map((note) => noteElement(container, note)));
      container.hidden = profile.serviceNotes.length === 0;
    });
    all('[data-store-service-card]').forEach((card) => { card.hidden = profile.serviceNotes.length === 0; });

    const hasAddress = Boolean(profile.addressLine1 || profile.addressLine2 || profile.locality);
    all('[data-store-address],[data-store-address-card]').forEach((node) => { node.hidden = !hasAddress; });
    all('[data-store-name-row]').forEach((row) => { row.hidden = !(profile.displayName || profile.storeType); });
    all('[data-store-profile]').forEach((node) => {
      node.hidden = !(profile.displayName || profile.storeType || hasAddress || hasInstagram);
    });
    window.SuveraSEO?.applyStoreProfile?.(profile);
  }
  async function load() {
    try {
      render(normalize(await window.SuveraAPI.organization.current()));
    } catch (_) { return null; }
  }
  window.SuveraStoreProfile = { normalize };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
