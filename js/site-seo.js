(function () {
  'use strict';

  const SITE_ORIGIN = window.SUVERA_SITE_ORIGIN || location.origin || 'https://suvera.com.tr';
  const DEFAULT_IMAGE = SITE_ORIGIN + '/og-cover.svg';
  let currentStoreProfile = null;

  function toAbsolute(path) {
    if (!path) return SITE_ORIGIN + '/';
    if (/^https?:\/\//i.test(path)) return path;
    return SITE_ORIGIN + (path.startsWith('/') ? path : '/' + path);
  }

  function ensureMeta(type, key) {
    const selector = type === 'property'
      ? 'meta[property="' + key + '"]'
      : 'meta[name="' + key + '"]';
    let node = document.querySelector(selector);
    if (!node) {
      node = document.createElement('meta');
      node.setAttribute(type, key);
      document.head.appendChild(node);
    }
    return node;
  }

  function ensureCanonical(url) {
    let node = document.querySelector('link[rel="canonical"]');
    if (!node) {
      node = document.createElement('link');
      node.rel = 'canonical';
      document.head.appendChild(node);
    }
    node.href = url;
    return node;
  }

  function applyPageMeta(options) {
    const settings = options || {};
    const title = settings.title || document.title || 'Suvera';
    const description = settings.description || 'Suvera modern tesettür giyim seçkileri.';
    const url = toAbsolute(settings.path || location.pathname + location.search);
    const image = toAbsolute(settings.image || DEFAULT_IMAGE);
    const type = settings.type || 'website';

    document.title = title;
    ensureCanonical(url);
    ensureMeta('name', 'description').content = description;
    ensureMeta('property', 'og:type').content = type;
    ensureMeta('property', 'og:title').content = title;
    ensureMeta('property', 'og:description').content = description;
    ensureMeta('property', 'og:url').content = url;
    ensureMeta('property', 'og:image').content = image;
    ensureMeta('name', 'twitter:card').content = 'summary_large_image';
    ensureMeta('name', 'twitter:title').content = title;
    ensureMeta('name', 'twitter:description').content = description;
    ensureMeta('name', 'twitter:image').content = image;
  }

  function applyJsonLd(id, data) {
    if (!data) return;
    let node = document.getElementById(id);
    if (!node) {
      node = document.createElement('script');
      node.type = 'application/ld+json';
      node.id = id;
      document.head.appendChild(node);
    }
    node.textContent = JSON.stringify(data);
  }

  function ensureHeadLink(rel, href, type) {
    let node = document.querySelector('link[rel="' + rel + '"]');
    if (!node) {
      node = document.createElement('link');
      node.rel = rel;
      document.head.appendChild(node);
    }
    node.href = href;
    if (type) node.type = type;
  }

  function applyBaseSchemas(options) {
    const settings = options || {};
    const path = settings.path || location.pathname;
    const name = settings.name || document.title || 'Suvera';
    const description = settings.description || 'Suvera modern tesettür giyim seçkileri.';

    applyStoreProfile(currentStoreProfile);

    applyJsonLd('suvera-website-schema', {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Suvera',
      url: SITE_ORIGIN,
      potentialAction: {
        '@type': 'SearchAction',
        target: SITE_ORIGIN + '/arama?q={search_term_string}',
        'query-input': 'required name=search_term_string'
      }
    });

    applyJsonLd('suvera-webpage-schema', {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: name,
      description: description,
      url: toAbsolute(path)
    });
  }

  function applyStoreProfile(profile) {
    currentStoreProfile = profile || null;
    const source = currentStoreProfile || {};
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: source.displayName || 'Suvera',
      url: SITE_ORIGIN,
      logo: SITE_ORIGIN + '/favicon.svg'
    };
    if (source.instagramUrl) schema.sameAs = [source.instagramUrl];
    if (source.addressLine1 || source.addressLine2 || source.locality) {
      schema.address = {
        '@type': 'PostalAddress',
        streetAddress: [source.addressLine1, source.addressLine2].filter(Boolean).join(', '),
        addressLocality: source.locality || '',
        addressCountry: 'TR'
      };
    }
    applyJsonLd('suvera-organization-schema', schema);
  }

  window.SuveraSEO = {
    origin: SITE_ORIGIN,
    defaultImage: DEFAULT_IMAGE,
    toAbsolute: toAbsolute,
    applyPageMeta: applyPageMeta,
    applyJsonLd: applyJsonLd,
    applyBaseSchemas: applyBaseSchemas,
    applyStoreProfile: applyStoreProfile,
  };

  ensureMeta('name', 'theme-color').content = '#2f6041';
  ensureHeadLink('icon', SITE_ORIGIN + '/favicon.svg', 'image/svg+xml');
  ensureHeadLink('manifest', SITE_ORIGIN + '/site.webmanifest');
})();
