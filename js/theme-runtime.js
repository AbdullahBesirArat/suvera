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
//  2. SECTIONS are applied to the markup the pages already ship: this module reorders,
//     hides and re-labels existing wrappers. It never builds a parallel page, and it
//     never uses innerHTML — every string coming from a theme lands in textContent.
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
    'product-grid': '#homeProductsGrid',
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
  };

  function sectionWrapper(type) {
    var selector = SECTION_SELECTORS[type];
    if (!selector) return null;
    var node = document.querySelector(selector);
    if (!node) return null;
    // The product grid is an inner container; the block that can be hidden or reordered is
    // the <section> around it.
    return node.closest('section') || node;
  }

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

  function applyHero(wrapper, settings) {
    setText(wrapper.querySelector('.slide-title, .hero-title, h1'), settings.title);
    setText(wrapper.querySelector('.slide-sub, .hero-sub, .slide-text'), settings.subtitle);
    var cta = wrapper.querySelector('.slide-cta, .hero-cta, .btn-primary');
    setText(cta, settings.ctaLabel);
  }

  function applyProductGrid(wrapper, settings) {
    setText(wrapper.querySelector('.sec-title'), settings.title);
  }

  function applyCollectionBlocks(wrapper, settings) {
    setText(wrapper.querySelector('.sec-title'), settings.title);
  }

  function applyTrustFeatures(wrapper, settings) {
    var items = Array.isArray(settings.items) ? settings.items : [];
    if (!items.length) return;
    // Rebuilt with createElement/textContent so no theme string is ever parsed as HTML.
    var next = document.createDocumentFragment();
    items.forEach(function (item) {
      var feat = document.createElement('div');
      feat.className = 'feat';
      var icon = document.createElement('div');
      icon.className = 'feat-icon';
      icon.textContent = TRUST_ICON_GLYPHS[item.icon] || TRUST_ICON_GLYPHS.shield;
      var title = document.createElement('h4');
      title.textContent = String(item.title || '');
      var text = document.createElement('p');
      text.textContent = String(item.text || '');
      feat.appendChild(icon);
      feat.appendChild(title);
      feat.appendChild(text);
      next.appendChild(feat);
    });
    while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild);
    wrapper.appendChild(next);
  }

  function applyNewsletter(wrapper, settings) {
    setText(wrapper.querySelector('h2'), settings.title);
    setText(wrapper.querySelector('span'), settings.text);
    setText(wrapper.querySelector('button[type="submit"]'), settings.buttonLabel);
  }

  var SECTION_APPLIERS = {
    hero: applyHero,
    'product-grid': applyProductGrid,
    'collection-blocks': applyCollectionBlocks,
    'trust-features': applyTrustFeatures,
    newsletter: applyNewsletter,
  };

  function applyAnnouncement(announcement) {
    var node = document.getElementById('campaignAnnouncement');
    if (!node || !announcement) return;
    if (!announcement.enabled) {
      node.hidden = true;
      return;
    }
    setText(node, announcement.text);
  }

  // Reorders the wrappers to match the theme. Only elements that already share a parent are
  // moved, so a page with a different layout is left untouched instead of scrambled.
  function applyOrder(sections) {
    var entries = sections
      .map(function (section) { return { section: section, node: sectionWrapper(section.type) }; })
      .filter(function (entry) { return entry.node; });
    if (entries.length < 2) return;
    var parent = entries[0].node.parentNode;
    if (!parent) return;
    if (!entries.every(function (entry) { return entry.node.parentNode === parent; })) return;
    var anchor = entries.reduce(function (earliest, entry) {
      if (!earliest) return entry.node;
      return earliest.compareDocumentPosition(entry.node) & Node.DOCUMENT_POSITION_PRECEDING
        ? entry.node
        : earliest;
    }, null);
    var cursor = anchor;
    entries.forEach(function (entry) {
      parent.insertBefore(entry.node, cursor);
      cursor = entry.node.nextSibling;
    });
  }

  function applySections(theme) {
    var sections = Array.isArray(theme.sections) ? theme.sections.slice() : [];
    sections.sort(function (a, b) { return Number(a.order) - Number(b.order); });

    // Anything the theme does not list is a section the tenant turned off.
    var listed = {};
    sections.forEach(function (section) { listed[section.type] = true; });
    Object.keys(SECTION_SELECTORS).forEach(function (type) {
      var wrapper = sectionWrapper(type);
      if (wrapper) wrapper.hidden = !listed[type];
    });

    sections.forEach(function (section) {
      state.sections[section.type] = section.settings || {};
      var wrapper = sectionWrapper(section.type);
      if (!wrapper) return;
      var apply = SECTION_APPLIERS[section.type];
      if (!apply) return;
      try {
        apply(wrapper, section.settings || {});
      } catch (_) { /* a bad section must not break the rest of the page */ }
    });

    applyOrder(sections);
  }

  function applyTheme(theme, preview) {
    state.theme = theme;
    state.preview = !!preview;
    attachStylesheet(!!preview, preview ? String(theme.version_id || '') : theme.hash || '');
    applyAnnouncement(theme.announcement);
    if (document.getElementById('homeProductsGrid') || document.querySelector('.hero-slider')) {
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
  };
}());
