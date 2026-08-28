// A28 storefront theme runtime.
//
// Two responsibilities, deliberately kept apart:
//
//  1. TOKENS reach the page as a real, same-origin stylesheet (<link rel="stylesheet">).
//     The CSP is `style-src 'self'` with `style-src-attr 'none'`, so a theme is never
//     applied with element.style, a style="" attribute, or an injected <style> block —
//     not even through the site's own data-css hydration, which exists for developer
//     authored markup and must not be fed tenant data.
//
//  2. SECTIONS are rendered into the homepage's single builder host with DOM APIs. It never
//     uses innerHTML — every tenant string reaches textContent or a validated internal href.
//
// Everything here is fail-safe: if the theme cannot be fetched, is empty, or is malformed,
// the storefront keeps the appearance it has without a theme.
(function () {
  'use strict';

  var API_BASE = window.PANELYA_API_BASE || window.SUVERA_API_BASE || '/api';
  var ORGANIZATION_SLUG = String(window.SUVERA_ORGANIZATION_SLUG || 'suvera').trim();
  var PREVIEW_HASH_KEY = 'preview_token';

  // Theme section type -> the wrapper that already exists in the page.
  var SECTION_SELECTORS = {
    hero: '#heroSlider, .hero-slider',
    'collection-blocks': '.cats-bg',
    'collection-showcase': '.home-collection-showcase',
    'category-slider': '.home-category-slider',
    'product-grid': '#homeProductsGrid',
    'product-carousel': '.home-product-carousel',
    editorial: '.home-editorial',
    'promo-banner': '.home-promo-banner',
    'trust-features': '.features-bar',
    newsletter: '.newsletter',
  };

  // Server-owned allowlist (schema.js TRUST_ICONS); the client only picks a glyph for it.
  var TRUST_ICON_GLYPHS = {
    shield: '🛡️', truck: '🚚', refresh: '↩️', lock: '🔒',
    star: '★', gift: '🎁', headset: '💬',
  };

  var state = {
    theme: null,
    preview: false,
    sections: {},
    sectionsById: {},
  };

  // --- token stylesheet ---------------------------------------------------------------

  function stylesheetHref(preview) {
    var path = preview ? '/storefront-theme/preview.css' : '/storefront-theme/theme.css';
    // Only the tenant slug travels in the URL. The preview token never does: the proxy
    // holds it in an HttpOnly session cookie and replays it as a header.
    return API_BASE + path + '?organizationSlug=' + encodeURIComponent(ORGANIZATION_SLUG);
  }

  function attachStylesheet(preview, cacheKey) {
    var existing = document.getElementById('suveraThemeStylesheet');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    var link = document.createElement('link');
    link.id = 'suveraThemeStylesheet';
    link.rel = 'stylesheet';
    // The published version hash makes the URL change exactly when the theme changes, so
    // the browser cache can be trusted without ever serving a stale palette.
    link.href = stylesheetHref(preview) + (cacheKey ? '&v=' + encodeURIComponent(cacheKey) : '');
    // A failed stylesheet must not take the page down with it.
    link.addEventListener('error', function () {
      if (link.parentNode) link.parentNode.removeChild(link);
    });
    document.head.appendChild(link);
    return link;
  }

  // --- preview token handling ----------------------------------------------------------

  // The raw token arrives in the URL fragment, which browsers never send to a server and
  // never put in a Referer. It is read once into a local variable and the fragment is
  // scrubbed immediately. It is never written to localStorage, sessionStorage, a
  // JS-readable cookie, or the console.
  function takePreviewTokenFromHash() {
    var hash = String(window.location.hash || '').replace(/^#/, '');
    if (!hash) return '';
    var params;
    try {
      params = new URLSearchParams(hash);
    } catch (_) {
      return '';
    }
    var token = params.get(PREVIEW_HASH_KEY);
    if (!token) return '';
    params.delete(PREVIEW_HASH_KEY);
    var rest = params.toString();
    try {
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + window.location.search + (rest ? '#' + rest : '')
      );
    } catch (_) {
      window.location.hash = rest;
    }
    return token;
  }

  function requestJson(path, options) {
    var settings = options || {};
    return window.fetch(API_BASE + path, {
      method: settings.method || 'GET',
      credentials: 'same-origin',
      headers: settings.body ? { 'Content-Type': 'application/json' } : undefined,
      body: settings.body ? JSON.stringify(settings.body) : undefined,
    }).then(function (response) {
      if (!response.ok) throw new Error('theme_request_failed');
      return response.json();
    });
  }

  function loadPublishedTheme() {
    return requestJson('/storefront-theme?organizationSlug=' + encodeURIComponent(ORGANIZATION_SLUG))
      .then(function (payload) { return payload && payload.theme; });
  }

  function loadPreviewTheme(token) {
    // The response carries no token back to JS: the proxy strips it into an HttpOnly
    // session cookie, which is what later authorises the preview stylesheet GET.
    return requestJson('/storefront-theme/preview', {
      method: 'POST',
      body: { organizationSlug: ORGANIZATION_SLUG, token: token },
    }).then(function (payload) { return payload && payload.theme; });
  }

  // --- section application --------------------------------------------------------------

  function setText(node, value) {
    if (!node) return;
    var text = typeof value === 'string' ? value.trim() : '';
    if (!text) return;
    node.textContent = text;
  }

  function element(tag, className, textValue) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (textValue) node.textContent = String(textValue);
    return node;
  }

  function internalHref(target) {
    var link = target && typeof target === 'object' ? target : { type: 'none' };
    if (link.type === 'products') return 'urunler';
    if (link.type === 'category') return 'urunler?category_id=' + encodeURIComponent(link.id);
    if (link.type === 'collection') return 'urunler?collection=' + encodeURIComponent(link.id);
    if (link.type === 'product') return 'urun?id=' + encodeURIComponent(link.id);
    if (link.type === 'page' && /^[a-z0-9-]+$/.test(String(link.page || ''))) return String(link.page);
    return '';
  }

  function mediaUrl(theme, mediaId) {
    var raw = mediaId && theme.media ? theme.media[mediaId] : '';
    return raw && window.SuveraAPI ? window.SuveraAPI.assetUrl(raw) : '';
  }

  function appendHeading(wrapper, settings, defaultEyebrow) {
    var title = String(settings.title || '').trim();
    var description = String(settings.description || '').trim();
    if (!title && !description) return;
    var head = element('header', 'home-section-head');
    if (defaultEyebrow) head.appendChild(element('p', 'home-section-eyebrow', defaultEyebrow));
    if (title) head.appendChild(element('h2', 'home-section-title', title));
    if (description) head.appendChild(element('p', 'home-section-description', description));
    wrapper.appendChild(head);
  }

  function appendCta(wrapper, label, target, className) {
    var href = internalHref(target);
    if (!href || !String(label || '').trim()) return;
    var link = element('a', className || 'home-cta', label);
    link.href = href;
    wrapper.appendChild(link);
  }

  function buildHero(section) {
    var wrapper = element('div', 'hero-slider home-builder-section');
    wrapper.id = 'heroSlider';
    wrapper.setAttribute('aria-label', 'Ana vitrin');
    var prev = element('button', 'slider-arrow prev', '‹');
    prev.type = 'button'; prev.dataset.action = 'slide-prev'; prev.setAttribute('aria-label', 'Önceki');
    var next = element('button', 'slider-arrow next', '›');
    next.type = 'button'; next.dataset.action = 'slide-next'; next.setAttribute('aria-label', 'Sonraki');
    var dots = element('div', 'slider-dots'); dots.id = 'heroSliderDots';
    var progress = element('div', 'slider-progress'); progress.id = 'sliderProgress';
    wrapper.appendChild(prev); wrapper.appendChild(next); wrapper.appendChild(dots); wrapper.appendChild(progress);
    return wrapper;
  }

  function buildDataSection(section) {
    var settings = section.settings || {};
    var wrapper = element('section', 'home-builder-section');
    var rail = element('div', 'home-scroll-rail');
    if (section.type === 'product-grid') {
      wrapper.className += ' home-product-grid';
      rail.className = 'prods-grid'; rail.id = 'homeProductsGrid';
      appendHeading(wrapper, settings, 'Ürünler');
    } else if (section.type === 'product-carousel') {
      wrapper.className += ' home-product-carousel';
      rail.className += ' home-product-rail';
      appendHeading(wrapper, settings, 'Ürünler');
    } else if (section.type === 'category-slider') {
      wrapper.className += ' home-category-slider cats-bg';
      rail.className += ' home-category-rail'; rail.id = 'homeCategoryGrid';
      appendHeading(wrapper, settings, 'Kategoriler');
    } else {
      wrapper.className += ' home-collection-showcase';
      rail.className += ' home-collection-rail';
      appendHeading(wrapper, settings, 'Koleksiyonlar');
    }
    wrapper.appendChild(rail);
    if (section.type === 'product-carousel') {
      appendCta(wrapper, settings.ctaLabel, settings.source, 'home-section-link');
    }
    return wrapper;
  }

  function buildEditorial(section, theme) {
    var settings = section.settings || {};
    var wrapper = element('section', 'home-builder-section ' + (section.type === 'editorial' ? 'home-editorial' : 'home-promo-banner'));
    var copy = element('div', 'home-story-copy');
    if (settings.eyebrow) copy.appendChild(element('p', 'home-section-eyebrow', settings.eyebrow));
    if (settings.title) copy.appendChild(element('h2', 'home-story-title', settings.title));
    if (settings.description) copy.appendChild(element('p', 'home-story-description', settings.description));
    appendCta(copy, settings.ctaLabel, settings.ctaTarget, 'home-cta');
    wrapper.appendChild(copy);
    var url = mediaUrl(theme, settings.mediaId);
    if (url) {
      var image = element('img', 'home-story-image');
      image.src = url; image.alt = String(settings.title || ''); image.loading = 'lazy'; image.decoding = 'async';
      wrapper.appendChild(image);
    }
    return wrapper;
  }

  function buildTrust(section) {
    var wrapper = element('aside', 'features-bar home-builder-section');
    wrapper.setAttribute('aria-label', String(section.settings.title || 'Mağaza bilgileri'));
    (section.settings.items || []).forEach(function (item) {
      var feat = element('div', 'feat');
      feat.appendChild(element('span', 'feat-icon', TRUST_ICON_GLYPHS[item.icon] || TRUST_ICON_GLYPHS.shield));
      feat.appendChild(element('strong', '', item.title));
      if (item.text) feat.appendChild(element('small', '', item.text));
      wrapper.appendChild(feat);
    });
    return wrapper;
  }

  function buildNewsletter(section) {
    var settings = section.settings || {};
    var wrapper = element('section', 'newsletter home-builder-section');
    if (settings.title) wrapper.appendChild(element('h2', '', settings.title));
    if (settings.text) wrapper.appendChild(element('span', '', settings.text));
    var form = element('form', 'nl-form'); form.id = 'newsletterForm'; form.noValidate = true;
    var input = element('input', ''); input.id = 'newsletterEmail'; input.type = 'email'; input.required = true;
    input.placeholder = 'E-posta adresiniz';
    var button = element('button', '', settings.buttonLabel || 'Kayıt ol'); button.type = 'submit';
    form.appendChild(input); form.appendChild(button); wrapper.appendChild(form);
    var consent = element('label', 'kvkk-check');
    var checkbox = element('input', ''); checkbox.type = 'checkbox'; checkbox.id = 'kvkk';
    consent.appendChild(checkbox); consent.appendChild(document.createTextNode(' KVKK metnini okudum ve kabul ediyorum.'));
    wrapper.appendChild(consent);
    var status = element('div', 'newsletter-status'); status.id = 'newsletterStatus'; wrapper.appendChild(status);
    return wrapper;
  }

  function buildLegacyCollectionBlocks(section, theme) {
    var wrapper = element('section', 'cats-bg home-builder-section');
    appendHeading(wrapper, section.settings || {}, 'Koleksiyonlar');
    var rail = element('div', 'home-scroll-rail home-collection-rail');
    (section.settings.blocks || []).forEach(function (block) {
      var href = internalHref(block.target);
      if (!href) return;
      var card = element('a', 'home-collection-card', block.title); card.href = href;
      var url = mediaUrl(theme, block.mediaId);
      if (url) { var image = element('img', '', ''); image.src = url; image.alt = String(block.title || ''); image.loading = 'lazy'; card.prepend(image); }
      rail.appendChild(card);
    });
    wrapper.appendChild(rail);
    return wrapper;
  }

  function buildSection(section, theme) {
    if (section.type === 'hero') return buildHero(section);
    if (['product-grid', 'product-carousel', 'category-slider', 'collection-showcase'].includes(section.type)) return buildDataSection(section);
    if (section.type === 'editorial' || section.type === 'promo-banner') return buildEditorial(section, theme);
    if (section.type === 'trust-features') return buildTrust(section);
    if (section.type === 'newsletter') return buildNewsletter(section);
    if (section.type === 'collection-blocks') return buildLegacyCollectionBlocks(section, theme);
    return null;
  }

  function applyAnnouncement(announcement) {
    var node = document.getElementById('campaignAnnouncement');
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
    document.documentElement.classList.remove('announcement-visible');
    var text = announcement && typeof announcement.text === 'string' ? announcement.text.trim() : '';
    if (!announcement || !announcement.enabled || !text) {
      node.hidden = true;
      return;
    }
    node.appendChild(element('span', 'announce-text', text));
    var href = internalHref(announcement.link);
    var label = typeof announcement.linkLabel === 'string' ? announcement.linkLabel.trim() : '';
    if (href && label) {
      var link = element('a', 'announce-link', label);
      link.href = href;
      node.appendChild(link);
    }
    node.hidden = false;
    document.documentElement.classList.add('announcement-visible');
  }

  function applySections(theme) {
    var sections = Array.isArray(theme.sections) ? theme.sections.slice() : [];
    sections.sort(function (a, b) { return Number(a.order) - Number(b.order); });
    var host = document.getElementById('homepageSections');
    if (!host) return;
    while (host.firstChild) host.removeChild(host.firstChild);
    state.sections = {};
    state.sectionsById = {};
    sections.forEach(function (section) {
      state.sections[section.type] = section.settings || {};
      state.sectionsById[section.id] = section;
      try {
        var wrapper = buildSection(section, theme);
        if (!wrapper) return;
        wrapper.dataset.homeSectionId = section.id;
        wrapper.dataset.homeSectionType = section.type;
        host.appendChild(wrapper);
      } catch (_) { /* a bad section must not break the rest of the page */ }
    });
  }

  function applyTheme(theme, preview) {
    state.theme = theme;
    state.preview = !!preview;
    attachStylesheet(!!preview, preview ? String(theme.version_id || '') : theme.hash || '');
    applyAnnouncement(theme.announcement);
    if (document.getElementById('homepageSections')) {
      applySections(theme);
    }
  }

  function bootstrap() {
    var previewToken = takePreviewTokenFromHash();
    var loading = previewToken
      // A preview that cannot be established falls back to the published theme rather than
      // showing an unstyled page or silently leaking that the token was wrong.
      ? loadPreviewTheme(previewToken).then(
        function (theme) { return { theme: theme, preview: true }; },
        function () { return loadPublishedTheme().then(function (theme) { return { theme: theme, preview: false }; }); }
      )
      : loadPublishedTheme().then(function (theme) { return { theme: theme, preview: false }; });

    return loading.then(function (result) {
      if (!result || !result.theme) return null;
      applyTheme(result.theme, result.preview);
      return result.theme;
    }).catch(function () {
      // No theme: the storefront keeps its built-in appearance.
      return null;
    });
  }

  var ready = bootstrap();

  window.SuveraTheme = {
    ready: ready,
    get theme() { return state.theme; },
    get isPreview() { return state.preview; },
    // Read by storefront.js so grid size follows the theme instead of a hardcoded number.
    sectionSettings: function (type) { return state.sections[type] || null; },
    section: function (id) { return state.sectionsById[id] || null; },
  };
}());
