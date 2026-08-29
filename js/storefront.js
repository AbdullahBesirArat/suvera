import { formatMoney as money, escapeHtml, safeHref, parseImageEntry, productImageEntries, normalizeColor as normalizeProductColor, colorMeta } from './core/storefront-utils.js';
(function () {
  'use strict';

  // FIX: Block unsafe link protocols coming from CMS collection content.
  function imageForColor(product, color) {
    const entries = productImageEntries(product);
    const selected = normalizeProductColor(color);
    const match = selected
      ? entries.find(function (entry) { return normalizeProductColor(entry.color) === selected; })
      : null;
    const entry = match || entries[0] || null;
    return entry ? window.SuveraAPI.assetUrl(entry.url) : '';
  }

  function themeLinkHref(target) {
    if (!target || typeof target !== 'object' || target.type === 'none') return '';
    if (target.type === 'products') return 'urunler';
    if (target.type === 'category') return 'urunler?category_id=' + encodeURIComponent(target.id);
    if (target.type === 'collection') return 'urunler?collection=' + encodeURIComponent(target.id);
    if (target.type === 'product') return 'urun?id=' + encodeURIComponent(target.id);
    if (target.type === 'page' && /^[a-z0-9-]+$/.test(String(target.page || ''))) return String(target.page);
    return '';
  }

  function colorDots(colors, product) {
    const list = Array.isArray(colors) ? colors : [];
    return list.slice(0, 4).map(function (color, index) {
      const meta = colorMeta(color);
      const image = imageForColor(product, color);
      return '<div class="color-dot ' + (index === 0 ? 'active' : '') + '" data-css="background:' + escapeHtml(meta.css) + '" data-image="' + escapeHtml(image) + '" title="' + escapeHtml(meta.label) + '" data-action="select-color"></div>';
    }).join('');
  }

  function badge(product) {
    if (product.sale_price) return '<span class="badge badge-sale">İndirim</span>';
    if (String(product.tags || '').toLowerCase().includes('yeni')) return '<span class="badge badge-new">Yeni</span>';
    return '';
  }

  function stockLabel(product) {
    const rawStock = product.stock ?? product.stock_quantity ?? product.quantity;
    const stock = Number(rawStock);
    if (Number.isFinite(stock) && stock > 0 && stock <= 3) return 'Son ' + stock + ' urun';
    if (product.in_stock === false || product.is_active === false) return 'Stokta yok';
    if (product.in_stock === true || (Number.isFinite(stock) && stock > 0)) return 'Stokta';
    return '';
  }

  function skeletonCards(count) {
    return '<div class="product-skeleton-grid" aria-hidden="true">' + Array.from({ length: count || 6 }).map(function () {
      return '<div class="product-skeleton-card">' +
        '<div class="product-skeleton-media skeleton"></div>' +
        '<div class="product-skeleton-body">' +
        '<div class="product-skeleton-line skeleton"></div>' +
        '<div class="product-skeleton-line short skeleton"></div>' +
        '<div class="product-skeleton-line skeleton"></div>' +
        '</div>' +
        '</div>';
    }).join('') + '</div>';
  }

  function productCard(product) {
    const price = Number(product.sale_price || product.price || 0);
    const oldPrice = product.sale_price ? Number(product.price || 0) : null;
    const image = imageForColor(product, '');
    const responsive = image && window.SuveraAPI.responsiveImage ? window.SuveraAPI.responsiveImage(image, 'card') : { src: image, srcset: '', sizes: '' };
    const responsiveAttrs = responsive.srcset ? ` srcset="${escapeHtml(responsive.srcset)}" sizes="${escapeHtml(responsive.sizes)}"` : '';
    const id = encodeURIComponent(product.id);

    return `
      <div class="prod-card"
        data-product-id="${id}"
        data-product-name="${escapeHtml(product.name)}"
        data-product-price="${price}"
        data-product-price-label="${escapeHtml(money(price))}"
        data-product-image="${escapeHtml(image)}"
        data-product-category="${escapeHtml(product.category_name || '')}"
        data-nav="urun?id=${id}">
        <div class="prod-img">
          <div class="prod-img-bg" data-css="background:linear-gradient(150deg,#d8d3c8,#c5bfb2)"></div>
          ${image ? `<img class="prod-main-image" src="${escapeHtml(responsive.src)}"${responsiveAttrs} alt="${escapeHtml(product.name)}" loading="lazy" decoding="async" data-css="position:relative;z-index:1;width:100%;height:100%;object-fit:cover;"/>` : '<span class="product-media-placeholder" aria-hidden="true"></span>'}
          <div class="prod-badges">${badge(product)}</div>
          <div class="prod-media-actions">
            <button class="quick-fav" type="button" data-action="toggle-fav" data-stop aria-label="Favorilere ekle" aria-pressed="false">♡</button>
            <button class="quick-view" type="button" data-stop aria-label="Ürünü hızlı görüntüle" title="Ürünü hızlı görüntüle">Bak</button>
          </div>
        </div>
        <div class="prod-info">
          <h4>${escapeHtml(product.name)}</h4>
          <div class="prod-colors">${colorDots(product.colors, product)}</div>
          <div class="prod-price">
            <span class="p-new">${money(price)}</span>
            ${oldPrice ? '<span class="p-old">' + money(oldPrice) + '</span>' : ''}
          </div>
          ${stockLabel(product) ? `<span class="prod-stock-chip">${escapeHtml(stockLabel(product))}</span>` : ''}
        </div>
      </div>`;
  }

  function featuredStripCard(product) {
    const price = Number(product.sale_price || product.price || 0);
    const oldPrice = product.sale_price ? Number(product.price || 0) : null;
    const image = imageForColor(product, '');
    const responsive = image && window.SuveraAPI.responsiveImage ? window.SuveraAPI.responsiveImage(image, 'card') : { src: image, srcset: '', sizes: '' };
    const responsiveAttrs = responsive.srcset ? ` srcset="${escapeHtml(responsive.srcset)}" sizes="${escapeHtml(responsive.sizes)}"` : '';
    const id = encodeURIComponent(product.id);

    return `
      <div class="feat-strip-item" data-nav="urun?id=${id}">
        <div class="feat-strip-img">
          ${image ? `<img src="${escapeHtml(responsive.src)}"${responsiveAttrs} alt="${escapeHtml(product.name)}" loading="lazy" decoding="async" data-css="width:100%;height:100%;object-fit:cover;display:block;"/>` : '<span class="product-media-placeholder" aria-hidden="true"></span>'}
        </div>
        <div class="feat-strip-info">
          <p>${escapeHtml(product.name)}</p>
          <span>${money(price)}${oldPrice ? ' <del>' + money(oldPrice) + '</del>' : ''}</span>
        </div>
      </div>`;
  }

  function normalizeSize(value) {
    return String(value || '').trim().toUpperCase();
  }

  function categoryCard(category) {
    const categoryId = encodeURIComponent(category.id);
    const categoryImage = category.image_url || category.fallback_image_url || '';
    const image = categoryImage ? window.SuveraAPI.assetUrl(categoryImage) : '';
    const imageStyle = image
      ? 'background-image:linear-gradient(to top, rgba(12,24,12,.58), rgba(12,24,12,.10) 55%),url(' + escapeHtml(image) + ');background-size:cover;background-position:center;'
      : '';
    return `
      <div class="cat-card" data-nav="urunler?category_id=${categoryId}">
        <div class="cat-inner${image ? ' has-image' : ''}" data-css="${imageStyle}">${image ? '' : '<span class="product-media-placeholder" aria-hidden="true"></span>'}</div>
        <div class="cat-overlay">
          <h3>${escapeHtml(category.name || '')}</h3>
          ${category.slug ? '<p>' + escapeHtml(category.slug) + '</p>' : ''}
        </div>
      </div>`;
  }

  function applyEditorialVisual(target, image) {
    if (!target) return;
    target.hidden = !image;
    target.classList.toggle('has-image', !!image);
    target.style.backgroundImage = image
      ? 'linear-gradient(to top, rgba(18,25,18,.54), rgba(18,25,18,.08) 58%),url(' + image + ')'
      : '';
    target.textContent = '';
  }

  function slideMarkup(slide, index) {
    const title = String(slide.title || '').trim();
    if (!title && !slide.image_url) return '';
    const pieces = title.split(/\s+/).filter(Boolean);
    const titleTop = pieces.slice(0, Math.max(1, Math.ceil(pieces.length / 2))).join(' ');
    const titleBottom = pieces.slice(Math.max(1, Math.ceil(pieces.length / 2))).join(' ');
    const image = slide.image_url ? window.SuveraAPI.assetUrl(slide.image_url) : '';
    return `
      <div class="slide${index === 0 ? ' active' : ''}">
        <div class="slide-bg">${image ? '<img class="slide-bg-image" src="' + escapeHtml(image) + '" alt="" ' + (index === 0 ? 'fetchpriority="high" loading="eager"' : 'loading="lazy"') + ' decoding="async">' : ''}</div>
        <div class="slide-overlay"></div>
        <div class="slide-content">
          ${slide.tag ? '<span class="slide-tag">' + escapeHtml(slide.tag) + '</span>' : ''}
          <h1 class="slide-title">
            ${escapeHtml(titleTop)}<br/>
            ${titleBottom ? '<em>' + escapeHtml(titleBottom) + '</em>' : ''}
          </h1>
          ${slide.sub ? '<p class="slide-desc">' + escapeHtml(slide.sub) + '</p>' : ''}
          <div class="slide-ctas">
            ${slide.btn ? '<a href="' + escapeHtml(safeHref(slide.href, 'urunler')) + '" class="btn-slide-primary">' + escapeHtml(slide.btn) + '</a>' : ''}
          </div>
        </div>
      </div>`;
  }

  function appendHeroCta(parent, label, target, className) {
    const href = themeLinkHref(target);
    const text = String(label || '').trim();
    if (!href || !text) return;
    const link = document.createElement('a');
    link.className = className;
    link.href = href;
    link.textContent = text;
    parent.appendChild(link);
  }

  function themedHeroSlides(settings) {
    const slides = Array.isArray(settings && settings.slides)
      ? settings.slides.filter(function (slide) { return slide && slide.enabled !== false; })
        .slice().sort(function (a, b) { return Number(a.order || 0) - Number(b.order || 0); })
      : [];
    if (slides.length) return slides.filter(function (slide) {
      return slide.title || slide.accentText || slide.subtitle || slide.description || slide.mediaId || slide.mobileMediaId;
    });
    return settings && (settings.title || settings.accentText || settings.subtitle || settings.mediaId || settings.mobileMediaId)
      ? [settings]
      : [];
  }

  function renderThemedHero(slider, settings, theme, index) {
    const desktopRaw = settings.mediaId && theme && theme.media ? theme.media[settings.mediaId] : '';
    const mobileRaw = settings.mobileMediaId && theme && theme.media ? theme.media[settings.mobileMediaId] : '';
    const desktopImage = desktopRaw ? window.SuveraAPI.assetUrl(desktopRaw) : '';
    const mobileImage = mobileRaw ? window.SuveraAPI.assetUrl(mobileRaw) : '';
    const fallbackImage = desktopImage || mobileImage;
    const slide = document.createElement('div');
    slide.className = 'slide' + (index === 0 ? ' active' : '') + ' theme-hero';
    const background = document.createElement('div');
    background.className = 'slide-bg';

    if (fallbackImage) {
      const picture = document.createElement('picture');
      picture.className = 'theme-hero-picture';
      if (mobileImage) {
        const source = document.createElement('source');
        source.media = '(max-width: 767px)';
        source.srcset = mobileImage;
        picture.appendChild(source);
      }
      const image = document.createElement('img');
      image.className = 'slide-bg-image';
      image.src = fallbackImage;
      image.alt = '';
      image.loading = index === 0 ? 'eager' : 'lazy';
      image.decoding = 'async';
      image.fetchPriority = index === 0 ? 'high' : 'auto';
      image.width = desktopImage ? 1600 : 1122;
      image.height = desktopImage ? 800 : 1402;
      picture.appendChild(image);
      background.appendChild(picture);
    }
    slide.appendChild(background);
    const overlay = document.createElement('div');
    overlay.className = 'slide-overlay';
    slide.appendChild(overlay);
    const content = document.createElement('div');
    content.className = 'slide-content';

    if (settings.eyebrow) {
      const eyebrow = document.createElement('span');
      eyebrow.className = 'slide-tag';
      eyebrow.textContent = String(settings.eyebrow);
      content.appendChild(eyebrow);
    }
    if (settings.title || settings.accentText) {
      const heading = document.createElement('h1');
      heading.className = 'slide-title';
      if (settings.title) {
        const title = document.createElement('span');
        title.textContent = String(settings.title);
        heading.appendChild(title);
      }
      if (settings.title && settings.accentText) heading.appendChild(document.createElement('br'));
      if (settings.accentText) {
        const accent = document.createElement('em');
        accent.textContent = String(settings.accentText);
        heading.appendChild(accent);
      }
      content.appendChild(heading);
    }
    if (settings.subtitle && settings.description) {
      const subtitle = document.createElement('p');
      subtitle.className = 'slide-subtitle';
      subtitle.textContent = String(settings.subtitle);
      content.appendChild(subtitle);
    }
    const descriptionText = settings.description || settings.subtitle;
    if (descriptionText) {
      const description = document.createElement('p');
      description.className = 'slide-desc';
      description.textContent = String(descriptionText);
      content.appendChild(description);
    }
    const actions = document.createElement('div');
    actions.className = 'slide-ctas';
    appendHeroCta(actions, settings.ctaLabel, settings.ctaTarget, 'btn-slide-primary');
    appendHeroCta(actions, settings.secondaryCtaLabel, settings.secondaryCtaTarget, 'btn-slide-outline');
    if (actions.childNodes.length) content.appendChild(actions);
    slide.appendChild(content);
    slider.insertBefore(slide, slider.querySelector('.slider-arrow, .slider-dots, .slider-progress'));
  }

  function renderHeroDots(target, count) {
    if (!target) return;
    target.innerHTML = Array.from({ length: Math.max(count, 1) }).map(function (_, index) {
      // A31: these dots were empty <button> elements, so they had no accessible name at
      // all (axe button-name, critical). The name says which slide it goes to and the
      // active one reports itself rather than relying on a colour change.
      return '<button class="slider-dot' + (index === 0 ? ' active' : '')
        + '" type="button" data-action="go-slide" data-index="' + index + '"'
        + ' aria-label="' + (index + 1) + '. slayta git"'
        + (index === 0 ? ' aria-current="true"' : '') + '></button>';
    }).join('');
  }

  async function renderHeroSlider() {
    const slider = document.getElementById('heroSlider');
    if (!window.SuveraAPI || !slider) return;

    try {
      var themed = window.SuveraTheme ? window.SuveraTheme.sectionSettings('hero') : null;
      var theme = window.SuveraTheme ? window.SuveraTheme.theme : null;
      var builderSlides = themedHeroSlides(themed);
      var items;
      if (builderSlides.length) {
        items = null;
      } else {
        const slides = await window.SuveraAPI.slider.list();
        items = Array.isArray(slides) ? slides : [];
      }
      if (items && !items.length) { slider.hidden = true; return; }

      slider.querySelectorAll(':scope > .slide').forEach(function (node) {
        node.remove();
      });
      if (items) {
        slider.insertAdjacentHTML('afterbegin', items.map(slideMarkup).join(''));
        renderHeroDots(document.getElementById('heroSliderDots'), items.length);
      } else {
        builderSlides.forEach(function (slide, index) { renderThemedHero(slider, slide, theme, index); });
        renderHeroDots(document.getElementById('heroSliderDots'), builderSlides.length);
      }
      slider.querySelectorAll('.slider-arrow, .slider-dots, .slider-progress').forEach(function (control) {
        var count = items ? items.length : builderSlides.length;
        control.hidden = count < 2;
      });

      if (typeof window.rebuildHeroSlider === 'function') {
        window.rebuildHeroSlider();
      }
    } catch (err) {
      slider.hidden = true;
      console.warn('Suvera hero slider yüklenemedi:', err.message);
    }
  }

  function collectionHref(collection) {
    return safeHref(
      collection && collection.link_url,
      'urunler?collection=' + encodeURIComponent((collection && (collection.slug || collection.id)) || '')
    );
  }

  async function renderCategories(target, limit, selectedIds) {
    if (!window.SuveraAPI || !target) return;

    try {
      const categories = await window.SuveraAPI.categories.list();
      var all = Array.isArray(categories) ? categories : [];
      var ids = Array.isArray(selectedIds) ? selectedIds.map(String) : [];
      if (ids.length) all = ids.map(function (id) { return all.find(function (item) { return String(item.id) === id; }); }).filter(Boolean);
      const items = all.slice(0, limit || all.length);
      if (!items.length) { target.closest('.home-builder-section')?.setAttribute('hidden', ''); return; }
      // Keep category navigation available while real product-media fallbacks resolve.
      // Owner/category media still wins, and the cards are refreshed below with only
      // canonical catalog media (never a random or fabricated image).
      target.innerHTML = items.map(categoryCard).join('');
      const missing = items.filter(function (category) { return !category.image_url; });
      let cursor = 0;
      async function hydrateNextCategory() {
        while (cursor < missing.length) {
          const category = missing[cursor++];
          try {
            const query = new URLSearchParams({
              page: '1', pageSize: '1', sort: 'recommended', status: 'active', category: String(category.id),
            });
            const result = await window.SuveraAPI.catalog.search(query);
            const product = Array.isArray(result && result.items) ? result.items[0] : null;
            category.fallback_image_url = product ? imageForColor(product, '') : '';
          } catch (_) {
            category.fallback_image_url = '';
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, missing.length) }, hydrateNextCategory));
      target.innerHTML = items.map(categoryCard).join('');
    } catch (err) {
      target.closest('.home-builder-section')?.setAttribute('hidden', '');
      console.warn('Suvera kategorileri yüklenemedi:', err.message);
    }
  }

  async function loadSectionProducts(settings, limit) {
    var source = settings && settings.source ? settings.source : { type: 'products' };
    var selectedIds = Array.isArray(settings && settings.productIds)
      ? settings.productIds.map(Number).filter(function (id) { return Number.isInteger(id) && id > 0; }).slice(0, limit)
      : [];
    if (selectedIds.length) {
      var selected = await window.SuveraAPI.catalog.byIds(selectedIds);
      return (Array.isArray(selected) ? selected : []).filter(function (product) {
        return product && product.status === 'active';
      }).slice(0, limit);
    }
    if (source.type === 'products' || source.type === 'category' || source.type === 'collection') {
      var query = new URLSearchParams({
        page: '1', pageSize: String(limit), sort: settings.sort || 'newest', status: 'active',
      });
      if (source.type === 'category' || source.type === 'collection') {
        query.set(source.type === 'category' ? 'category' : 'collection', String(source.id));
      }
      var catalog = await window.SuveraAPI.catalog.search(query);
      return Array.isArray(catalog && catalog.items) ? catalog.items : [];
    }
    return [];
  }

  function appendNavigationLink(target, label, href, className) {
    if (!target || !label || !href) return;
    var link = document.createElement('a');
    link.href = href;
    link.textContent = label;
    if (className) link.className = className;
    target.appendChild(link);
  }

  async function renderRealNavigation() {
    if (!window.SuveraAPI) return;
    try {
      var results = await Promise.all([
        window.SuveraAPI.categories.list().catch(function () { return []; }),
        window.SuveraAPI.collections.list().catch(function () { return []; }),
        window.SuveraAPI.catalog.search({ page: 1, pageSize: 1, sort: 'best_selling', status: 'active' })
          .catch(function () { return { items: [] }; }),
      ]);
      var categories = Array.isArray(results[0]) ? results[0] : [];
      var collections = Array.isArray(results[1]) ? results[1] : [];
      var hasBestSellers = Array.isArray(results[2] && results[2].items) && results[2].items.length > 0;
      var desktopCategories = document.getElementById('desktopCategoryMenu');
      var mobileCategories = document.getElementById('mobileCategoryLinks');
      if (desktopCategories) desktopCategories.replaceChildren();
      if (mobileCategories) mobileCategories.replaceChildren();
      categories.slice(0, 9).forEach(function (category) {
        var href = 'urunler?category_id=' + encodeURIComponent(category.id);
        appendNavigationLink(desktopCategories, category.name, href, 'mega-link');
        appendNavigationLink(mobileCategories, category.name, href);
      });
      var desktopCategoryItem = document.getElementById('desktopCategoriesItem');
      var mobileCategoryItem = document.getElementById('mobileCategoriesItem');
      if (desktopCategoryItem) desktopCategoryItem.hidden = !categories.length;
      if (mobileCategoryItem) mobileCategoryItem.hidden = !categories.length;
      var desktopCollections = document.getElementById('desktopCollectionMenu');
      var mobileCollections = document.getElementById('mobileCollectionLinks');
      if (desktopCollections) desktopCollections.replaceChildren();
      if (mobileCollections) mobileCollections.replaceChildren();
      collections.slice(0, 9).forEach(function (collection) {
        var collectionKey = collection.slug || collection.id;
        var href = 'urunler?collection=' + encodeURIComponent(collectionKey);
        appendNavigationLink(desktopCollections, collection.title, href, 'mega-link');
        appendNavigationLink(mobileCollections, collection.title, href);
      });
      ['desktopCollectionsItem', 'mobileCollectionsItem'].forEach(function (id) {
        var node = document.getElementById(id);
        if (node) node.hidden = !collections.length;
      });
      ['desktopBestSellersLink', 'mobileBestSellersLink'].forEach(function (id) {
        var node = document.getElementById(id);
        if (node) node.hidden = !hasBestSellers;
      });
    } catch (err) {
      console.warn('Suvera navigasyon verisi yüklenemedi:', err.message);
    }
  }

  async function renderProducts(target, limit, settings) {
    if (!window.SuveraAPI || !target) return;

    target.innerHTML = skeletonCards(limit || 6);

    try {
      const products = await loadSectionProducts(settings || {}, limit);
      const items = products || [];
      const count = document.getElementById('productResultCount');
      if (count) count.textContent = items.length ? String(items.length) : '0';

      if (!items.length) { target.closest('.home-builder-section')?.setAttribute('hidden', ''); return []; }

      target.innerHTML = items.map(productCard).join('');
      if (window.Suvera && window.Suvera.refreshWishlistButtons) {
        window.Suvera.refreshWishlistButtons();
      }
      return items;
    } catch (err) {
      target.innerHTML = '';
      target.closest('.home-builder-section')?.setAttribute('hidden', '');
      const count = document.getElementById('productResultCount');
      if (count) count.textContent = '0';
      console.warn('Suvera API urunleri alinamadi:', err.message);
      return [];
    }
  }

  function collectionCard(collection) {
    var image = collection.image_url ? window.SuveraAPI.assetUrl(collection.image_url) : '';
    return '<a class="home-collection-card" href="' + escapeHtml(collectionHref(collection)) + '">' +
      (image ? '<img src="' + escapeHtml(image) + '" alt="' + escapeHtml(collection.title || '') + '" loading="lazy" decoding="async">' : '') +
      '<span>' + escapeHtml(collection.title || '') + '</span></a>';
  }

  async function renderCollections(target, settings) {
    if (!window.SuveraAPI || !target) return;
    try {
      var preview = Boolean(window.SuveraTheme && window.SuveraTheme.isPreview);
      var loader = preview && window.SuveraAPI.collections.previewList
        ? window.SuveraAPI.collections.previewList
        : window.SuveraAPI.collections.list;
      var collections = await loader();
      var all = Array.isArray(collections) ? collections : [];
      var ids = Array.isArray(settings.collectionIds) ? settings.collectionIds.map(String) : [];
      if (ids.length) all = ids.map(function (id) { return all.find(function (item) { return String(item.id) === id; }); }).filter(Boolean);
      var items = all.slice(0, settings.limit || 4);
      if (!items.length) { target.closest('.home-builder-section')?.setAttribute('hidden', ''); return; }
      target.innerHTML = items.map(collectionCard).join('');
    } catch (err) {
      target.closest('.home-builder-section')?.setAttribute('hidden', '');
    }
  }

  // filterFeatured: true → show only products with featured_in_category=true (if any; else all)
  async function renderFeaturedStrip(target, limit, sourceProducts, filterFeatured) {
    if (!window.SuveraAPI || !target) return;
    var label = document.getElementById('featuredProductsLabel');
    target.hidden = true;
    if (label) label.hidden = true;
    target.innerHTML = '';

    try {
      // FIX: Reuse the product list already loaded on the page instead of refetching.
      const products = Array.isArray(sourceProducts)
        ? sourceProducts
        : await window.SuveraAPI.products.list('?status=active&limit=' + limit);

      var pool = products || [];
      if (filterFeatured) {
        var featured = pool.filter(function (p) { return p.featured_in_category; });
        if (featured.length) pool = featured;
      }
      var items = pool.slice(0, limit);

      if (!items.length) {
        return;
      }

      target.innerHTML = items.map(featuredStripCard).join('');
      target.hidden = false;
      if (label) label.hidden = false;
    } catch (err) {
      target.innerHTML = '';
    }
  }

  var catalogRenderSequence = 0;

  function syncQuery(params, replace) {
    const query = params.toString();
    const next = location.pathname + (query ? '?' + query : '');
    history[replace ? 'replaceState' : 'pushState']({}, '', next);
  }

  function updateCatalogQuery(updates, options) {
    var params = new URLSearchParams(location.search);
    var aliases = {
      category: ['category_id'],
      collection: ['collection_slug'],
      color: ['colors'],
      size: ['sizes'],
      minPrice: ['min_price'],
      maxPrice: ['max_price'],
    };
    Object.keys(updates || {}).forEach(function (key) {
      (aliases[key] || []).forEach(function (alias) { params.delete(alias); });
      var value = updates[key];
      if (value == null || value === '') params.delete(key);
      else params.set(key, String(value));
    });
    if (!(options && options.keepPage)) params.delete('page');
    syncQuery(params, false);
    renderCollectionPage();
  }

  function catalogHref(params, updates) {
    var next = new URLSearchParams(params);
    Object.keys(updates || {}).forEach(function (key) {
      var value = updates[key];
      if (value == null || value === '') next.delete(key);
      else next.set(key, String(value));
    });
    next.delete('category_id');
    next.delete('page');
    return 'urunler' + (next.toString() ? '?' + next.toString() : '');
  }

  function renderCatalogPagination(target, currentPage, totalPages) {
    if (!target) return;
    if (totalPages <= 1) {
      target.innerHTML = '';
      return;
    }
    var pages = [];
    var start = Math.max(1, currentPage - 2);
    var end = Math.min(totalPages, currentPage + 2);
    if (start > 1) pages.push(1);
    if (start > 2) pages.push('ellipsis-start');
    for (var page = start; page <= end; page++) pages.push(page);
    if (end < totalPages - 1) pages.push('ellipsis-end');
    if (end < totalPages) pages.push(totalPages);
    target.innerHTML =
      '<button class="page-btn" type="button" data-catalog-page="' + (currentPage - 1) + '" aria-label="Önceki sayfa">‹</button>' +
      pages.map(function (pageValue) {
        if (typeof pageValue !== 'number') return '<span class="page-ellipsis" aria-hidden="true">…</span>';
        return '<button class="page-btn' + (pageValue === currentPage ? ' act' : '') + '" type="button" data-catalog-page="' + pageValue + '"' +
          (pageValue === currentPage ? ' aria-current="page"' : '') + '>' + pageValue + '</button>';
      }).join('') +
      '<button class="page-btn" type="button" data-catalog-page="' + (currentPage + 1) + '" aria-label="Sonraki sayfa">›</button>';

    target.querySelectorAll('[data-catalog-page]').forEach(function (button) {
      var nextPage = Number(button.getAttribute('data-catalog-page'));
      button.disabled = nextPage < 1 || nextPage > totalPages;
      button.addEventListener('click', function () {
        window.__suveraCatalogPageNavigation = true;
        updateCatalogQuery({ page: nextPage }, { keepPage: true });
      });
    });
  }

  async function renderCollectionPage() {
    var grid = document.getElementById('prodsGrid');
    if (!window.SuveraAPI || !window.SuveraAPI.catalog || !grid || !document.getElementById('collectionTitle')) return;
    var renderId = ++catalogRenderSequence;

    var params = new URLSearchParams(location.search);
    var selectedCategoryId = params.get('category') || params.get('category_id') || '';
    var selectedCollectionKey = (params.get('collection') || params.get('collection_slug') || '').trim();
    var selectedQuery = (params.get('q') || '').trim();
    var selectedSort = params.get('sort') || 'recommended';
    var selectedColors = new Set((params.get('color') || params.get('colors') || '').split(',').map(normalizeProductColor).filter(Boolean));
    var selectedSizes = new Set((params.get('size') || params.get('sizes') || '').split(',').map(normalizeSize).filter(Boolean));
    var maxPriceRaw = params.get('maxPrice') || params.get('max_price') || '';
    var currentPage = Number(params.get('page') || 1);

    var colorWrap = document.getElementById('collectionColorFilters');
    var sizeWrap = document.getElementById('collectionSizeFilters');
    var categoryWrap = document.getElementById('collectionCategoryFilters');
    var sortSelect = document.getElementById('collectionSort');
    var priceRange = document.getElementById('priceRange');
    var priceVal = document.getElementById('priceVal');
    var resetButton = document.getElementById('collectionFilterReset');
    var title = document.getElementById('collectionTitle');
    var breadcrumbLink = document.getElementById('collectionBreadcrumbLink');
    var breadcrumbCurrent = document.getElementById('collectionBreadcrumbCurrent');
    var kicker = document.getElementById('collectionKicker');
    var featureTag = document.getElementById('collectionFeatureTag');
    var featureTitle = document.getElementById('collectionFeatureTitle');
    var featureDescription = document.getElementById('collectionFeatureDescription');
    var editorLinks = document.getElementById('editorialCategoryLinks');
    var collectionLinks = document.getElementById('editorialCollectionLinks');
    var editorialFeatureTag = document.getElementById('editorialFeatureTag');
    var editorialFeatureTitle = document.getElementById('editorialFeatureTitle');
    var editorialFeatureDescription = document.getElementById('editorialFeatureDescription');
    var editorialFeatureLink = document.getElementById('editorialFeatureLink');
    var editorialFeatureVisual = document.getElementById('editorialFeatureVisual');
    var collectionFeatureVisual = document.getElementById('collectionFeatureVisual');
    var collectionEditorial = document.getElementById('collectionEditorial');
    var pagination = document.getElementById('collectionPagination');
    var drawerSizes = document.getElementById('drawerSizes');
    var drawerPriceRange = document.getElementById('drawerPriceRange');
    var drawerPriceVal = document.getElementById('drawerPriceVal');
    var drawerSort = document.getElementById('drawerSort');

    if (sortSelect) sortSelect.value = selectedSort;
    grid.innerHTML = skeletonCards(8);
    grid.setAttribute('aria-busy', 'true');
    if (pagination) pagination.innerHTML = '';

    try {
      var productQuery = new URLSearchParams({
        page: String(Number.isInteger(currentPage) && currentPage > 0 ? currentPage : params.get('page') || 1),
        pageSize: '24',
        sort: selectedSort,
      });
      if (selectedCategoryId) productQuery.set('category', selectedCategoryId);
      if (selectedCollectionKey) productQuery.set('collection', selectedCollectionKey);
      if (selectedQuery) productQuery.set('q', selectedQuery);
      if (selectedColors.size) productQuery.set('color', Array.from(selectedColors).join(','));
      if (selectedSizes.size) productQuery.set('size', Array.from(selectedSizes).join(','));
      if (params.get('minPrice') || params.get('min_price')) productQuery.set('minPrice', params.get('minPrice') || params.get('min_price'));
      if (maxPriceRaw) productQuery.set('maxPrice', maxPriceRaw);
      if (params.get('availability')) productQuery.set('availability', params.get('availability'));
      if (params.get('tag')) productQuery.set('tag', params.get('tag'));

      var responses = await Promise.all([
        window.SuveraAPI.catalog.search(productQuery),
        window.SuveraAPI.collections
          ? window.SuveraAPI.collections.list().catch(function () { return []; })
          : Promise.resolve([]),
      ]);
      if (renderId !== catalogRenderSequence) return;
      var catalog = responses[0] || {};
      var products = Array.isArray(catalog.items) ? catalog.items : [];
      var facets = catalog.facets || {};
      var categories = Array.isArray(facets.categories) ? facets.categories : [];
      var collectionFacets = Array.isArray(facets.collections) ? facets.collections : [];
      var collections = responses[1] || [];

      if (catalog.totalPages && catalog.page > catalog.totalPages) {
        params.set('page', String(catalog.totalPages));
        syncQuery(params, true);
        renderCollectionPage();
        return;
      }

      currentPage = Number(catalog.page || 1);
      selectedSort = catalog.sort || selectedSort;
      if (sortSelect) sortSelect.value = selectedSort;
      if (drawerSort) drawerSort.value = selectedSort;

      var activeCollection = null;
      if (selectedCollectionKey) {
        activeCollection = (collections || []).find(function (collection) {
          return String(collection.slug || '').toLocaleLowerCase('tr-TR') === selectedCollectionKey.toLocaleLowerCase('tr-TR')
            || String(collection.id) === selectedCollectionKey;
        }) || null;
        if (!activeCollection) {
          activeCollection = collectionFacets.find(function (collection) {
            return String(collection.slug || '').toLocaleLowerCase('tr-TR') === selectedCollectionKey.toLocaleLowerCase('tr-TR')
              || String(collection.id) === selectedCollectionKey;
          }) || { title: selectedCollectionKey, slug: selectedCollectionKey };
        }
      }

      var categoryMap = new Map(categories.map(function (category) {
        return [String(category.id), category];
      }));
      var activeCategory = categoryMap.get(String(selectedCategoryId)) ||
        (products[0] && String(products[0].category_id) === String(selectedCategoryId)
          ? { id: selectedCategoryId, name: products[0].category_name }
          : null);

      if (collectionLinks) {
        collectionLinks.innerHTML = (collections || []).slice(0, 5).map(function (collection) {
              var href = safeHref(collection.link_url, 'urunler?collection=' + encodeURIComponent(collection.slug || collection.id));
              return '<a class="editorial-link" href="' + escapeHtml(href) + '">' +
                escapeHtml(collection.title || 'Suvera Koleksiyonu') + ' <span>' + escapeHtml(collection.slug || 'Seçki') + '</span></a>';
            }).join('');
      }

      var featuredCollection = (collections || [])[0] || null;
      var featuredEditorial = activeCollection || featuredCollection;
      if (featuredEditorial) {
        var editorialImage = featuredEditorial.image_url ? window.SuveraAPI.assetUrl(featuredEditorial.image_url) : '';
        if (editorialFeatureTag) editorialFeatureTag.textContent = featuredEditorial.slug || 'Koleksiyon';
        if (editorialFeatureTitle) editorialFeatureTitle.innerHTML = escapeHtml(featuredEditorial.title || 'Suvera Koleksiyonu').replace(/\s+/g, '<br/>');
        if (editorialFeatureDescription) editorialFeatureDescription.textContent = featuredEditorial.description || '';
        if (editorialFeatureLink) editorialFeatureLink.href = safeHref(featuredEditorial.link_url, 'urunler');
        applyEditorialVisual(editorialFeatureVisual, editorialImage);
      }

      var collectionProducts = products;

      // ── Koleksiyon alt-kategori haritası ─────────────────────────────────
      // Computed once, used in both the sidebar and the editorial card below.
      var subCats = categories;

      // ── Editorial panel kategori sütunu ──────────────────────────────────
      var editorialCategoryHeading = document.getElementById('editorialCategoryHeading');
      if (editorLinks) {
        if (activeCollection) {
          // Koleksiyon aktifken: o koleksiyonun kategori dağılımını göster
          if (editorialCategoryHeading) editorialCategoryHeading.textContent = activeCollection.title || 'Koleksiyon';
          editorLinks.innerHTML = subCats.map(function (cat) {
                var href = catalogHref(params, { category: cat.id });
                return '<a class="editorial-link' + (String(cat.id) === String(selectedCategoryId) ? ' act' : '') + '" href="' + escapeHtml(href) + '">' +
                  escapeHtml(cat.name) + ' <span>' + cat.count + ' ürün</span></a>';
              }).join('');
        } else {
          // Koleksiyon yok: genel kategori linkleri
          if (editorialCategoryHeading) editorialCategoryHeading.textContent = 'Kategoriler';
          editorLinks.innerHTML = (categories || []).slice(0, 5).map(function (category) {
            return '<a class="editorial-link" href="' + escapeHtml(catalogHref(params, { category: category.id })) + '">' +
              escapeHtml(category.name) + ' <span>' + category.count + ' ürün</span></a>';
          }).join('');
        }
      }

      // ── Sidebar kategori listesi ──────────────────────────────────────────
      var categoryHeading = document.getElementById('collectionCategoryHeading');
      if (categoryWrap) {
        if (activeCollection) {
          if (categoryHeading) categoryHeading.textContent = activeCollection.title || 'Koleksiyon';

          var totalAllActive = !selectedCategoryId;
          var collectionTotal = subCats.reduce(function (sum, category) {
            return sum + Number(category.count || 0);
          }, 0);
          categoryWrap.innerHTML =
            '<a class="sub-cat-link' + (totalAllActive ? ' act' : '') + '" href="' + escapeHtml(catalogHref(params, { category: '' })) + '">' +
              'Tüm Ürünler <span class="filter-count">' + collectionTotal + '</span></a>' +
            subCats.map(function (cat) {
              var isActive = String(cat.id) === String(selectedCategoryId);
              var href = catalogHref(params, { category: cat.id });
              return '<a class="sub-cat-link' + (isActive ? ' act' : '') + '" href="' + escapeHtml(href) + '">' +
                '<span class="sub-cat-arrow">└</span>' +
                escapeHtml(cat.name) + ' <span class="filter-count">' + cat.count + '</span></a>';
            }).join('');
          // link-based navigation — event listener gerekmez
        } else {
          // Koleksiyon seçili değil: normal kategori radio listesi
          if (categoryHeading) categoryHeading.textContent = 'Kategori';

          categoryWrap.innerHTML = '<label class="filter-check"><input type="radio" name="collectionCategory" value="" ' + (selectedCategoryId ? '' : 'checked') + '/> Tüm Ürünler</label>' +
            (categories || []).map(function (category) {
              var checked = String(category.id) === String(selectedCategoryId) ? 'checked' : '';
              return '<label class="filter-check"><input type="radio" name="collectionCategory" value="' + escapeHtml(category.id) + '" ' + checked + '/> ' + escapeHtml(category.name) + '</label>';
            }).join('');
        }
      }

      var availableColors = Array.isArray(facets.colors) ? facets.colors : [];
      var availableSizes = Array.isArray(facets.sizes) ? facets.sizes : [];

      if (colorWrap) {
        colorWrap.innerHTML = availableColors.length
          ? availableColors.map(function (facet) {
              var active = selectedColors.has(normalizeProductColor(facet.value)) ? ' act' : '';
              var meta = colorMeta(facet.value);
              return '<button class="cf-dot' + active + '" type="button" data-css="background:' + escapeHtml(meta.css) + '" data-color="' + escapeHtml(facet.value) + '" title="' + escapeHtml(meta.label) + ' (' + facet.count + ' ürün)" aria-label="' + escapeHtml(meta.label) + ', ' + facet.count + ' ürün"></button>';
            }).join('')
          : '';
      }

      if (sizeWrap) {
        sizeWrap.innerHTML = availableSizes.length
          ? availableSizes.map(function (facet) {
              var active = selectedSizes.has(normalizeSize(facet.value)) ? ' act' : '';
              return '<button class="size-btn' + active + '" type="button" data-size="' + escapeHtml(facet.value) + '">' + escapeHtml(facet.value) + ' <small>' + facet.count + '</small></button>';
            }).join('')
          : '';
      }

      if (drawerSizes) {
        drawerSizes.innerHTML = availableSizes.map(function (facet) {
          var active = selectedSizes.has(normalizeSize(facet.value)) ? ' active' : '';
          return '<button class="drawer-sz' + active + '" type="button" aria-pressed="' + (active ? 'true' : 'false') + '" data-action="drawer-size" data-size="' + escapeHtml(facet.value) + '">' + escapeHtml(facet.value) + '</button>';
        }).join('');
      }

      var facetMaxPrice = Math.ceil(Number(facets.price && facets.price.max || 0));
      var selectedMaxPrice = Number(maxPriceRaw);
      var rangeMaximum = Math.max(1, facetMaxPrice, Number.isFinite(selectedMaxPrice) ? selectedMaxPrice : 0);
      var visibleMaxPrice = maxPriceRaw && Number.isFinite(selectedMaxPrice) ? selectedMaxPrice : rangeMaximum;
      [priceRange, drawerPriceRange].forEach(function (range) {
        if (!range) return;
        range.max = String(rangeMaximum);
        range.value = String(visibleMaxPrice);
      });
      if (priceVal) priceVal.textContent = money(visibleMaxPrice);
      if (drawerPriceVal) drawerPriceVal.textContent = money(visibleMaxPrice);

      title.textContent = activeCategory
        ? activeCategory.name
        : (activeCollection ? activeCollection.title : (selectedQuery ? '"' + selectedQuery + '" için sonuçlar' : 'Tüm Ürünler'));
      if (breadcrumbLink) breadcrumbLink.textContent = activeCategory ? activeCategory.name : (activeCollection ? activeCollection.title : 'Tüm Ürünler');
      if (breadcrumbCurrent) breadcrumbCurrent.textContent = selectedQuery ? 'Arama' : (activeCategory ? activeCategory.name : (activeCollection ? 'Koleksiyon' : 'Seçki'));
      if (kicker) kicker.textContent = activeCategory
        ? activeCategory.name + ' Seçkisi'
        : (activeCollection ? (activeCollection.title || 'Suvera Koleksiyonu') : 'Suvera Katalog');
      if (featureTag) featureTag.textContent = activeCategory ? (activeCategory.slug || 'Kategori') : 'Canlı Katalog';
      if (featureTitle) featureTitle.innerHTML = activeCategory ? escapeHtml(activeCategory.name).replace(/\s+/g, '<br/>') : 'Suvera<br/>Canlı<br/>Seçki';
      if (featureDescription) {
        featureDescription.textContent = activeCategory
          ? activeCategory.name + ' kategorisindeki ürünler Panelya üzerinden canlı olarak güncellenir.'
          : 'Ürünler, filtreler ve stok bilgileri Panelya kataloğundan canlı gelir.';
      }
      if (activeCategory) {
        var categoryImage = activeCategory.image_url ? window.SuveraAPI.assetUrl(activeCategory.image_url) : '';
        applyEditorialVisual(collectionFeatureVisual, categoryImage);
        if (!featuredEditorial) applyEditorialVisual(editorialFeatureVisual, categoryImage);
      } else {
        applyEditorialVisual(collectionFeatureVisual, '');
      }
      if (!activeCategory && (activeCollection || featuredCollection)) {
        var heroCollection = activeCollection || featuredCollection;
        var heroImage = heroCollection.image_url ? window.SuveraAPI.assetUrl(heroCollection.image_url) : '';
        if (featureTag) featureTag.textContent = heroCollection.slug || 'Öne Çıkan';
        if (featureTitle) featureTitle.innerHTML = escapeHtml(heroCollection.title || 'Suvera Seçkisi').replace(/\s+/g, '<br/>');
        if (featureDescription) featureDescription.textContent = heroCollection.description || '';
        applyEditorialVisual(collectionFeatureVisual, heroImage);
      }
      if (collectionEditorial) collectionEditorial.hidden = !(categories.length || collections.length);

      var resultCount = document.getElementById('productResultCount');
      if (resultCount) resultCount.textContent = String(Number(catalog.total || 0));

      if (!products.length) {
        grid.innerHTML = '<div class="empty-state">Bu filtrelerle eşleşen ürün bulunamadı. Filtreleri temizleyip yeniden deneyebilirsiniz.</div>';
      } else {
        grid.innerHTML = products.map(productCard).join('');
      }
      grid.setAttribute('aria-busy', 'false');
      renderCatalogPagination(pagination, currentPage, Number(catalog.totalPages || 0));

      renderFeaturedStrip(document.getElementById('featuredProductsStrip'), 5, collectionProducts, !!selectedCategoryId);
      if (window.Suvera && window.Suvera.refreshWishlistButtons) {
        window.Suvera.refreshWishlistButtons();
      }

      if (categoryWrap && !activeCollection) {
        categoryWrap.querySelectorAll('input[name="collectionCategory"]').forEach(function (input) {
          input.addEventListener('change', function () {
            updateCatalogQuery({ category: input.value });
          });
        });
      }

      if (colorWrap) {
        colorWrap.querySelectorAll('[data-color]').forEach(function (dot) {
          dot.addEventListener('click', function () {
            var key = normalizeProductColor(dot.getAttribute('data-color'));
            if (selectedColors.has(key)) selectedColors.delete(key);
            else selectedColors.add(key);
            updateCatalogQuery({ color: Array.from(selectedColors).join(',') });
          });
        });
      }

      if (sizeWrap) {
        sizeWrap.querySelectorAll('[data-size]').forEach(function (button) {
          button.addEventListener('click', function () {
            var key = normalizeSize(button.getAttribute('data-size'));
            if (selectedSizes.has(key)) selectedSizes.delete(key);
            else selectedSizes.add(key);
            updateCatalogQuery({ size: Array.from(selectedSizes).join(',') });
          });
        });
      }

      if (sortSelect) {
        sortSelect.onchange = function () {
          updateCatalogQuery({ sort: sortSelect.value });
        };
      }

      if (priceRange) {
        priceRange.oninput = function () {
          if (priceVal) priceVal.textContent = priceRange.value + ' TL';
        };
        priceRange.onchange = function () {
          updateCatalogQuery({ maxPrice: priceRange.value });
        };
      }

      if (resetButton) {
        resetButton.onclick = function () {
          syncQuery(new URLSearchParams(), false);
          renderCollectionPage();
        };
      }

      if (window.__suveraCatalogPageNavigation) {
        window.__suveraCatalogPageNavigation = false;
        title.setAttribute('tabindex', '-1');
        title.focus({ preventScroll: true });
        title.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (err) {
      if (renderId !== catalogRenderSequence) return;
      grid.setAttribute('aria-busy', 'false');
      grid.innerHTML = '<div class="empty-state">Ürün listesi şu anda yüklenemiyor. <button type="button" class="filter-reset" data-catalog-retry>Tekrar dene</button></div>';
      var retry = grid.querySelector('[data-catalog-retry]');
      if (retry) retry.addEventListener('click', renderCollectionPage);
      console.warn('Suvera koleksiyon sayfası yüklenemedi:', err.message);
    }
  }

  window.SuveraCatalog = {
    refresh: renderCollectionPage,
    updateQuery: updateCatalogQuery,
  };
  window.addEventListener('popstate', function () {
    renderCollectionPage();
  });

  window.addApiProductToCart = async function (id) {
    if (!window.SuveraAPI || !window.Suvera) return;

    try {
      const product = await window.SuveraAPI.products.get(id);
      const price = Number(product.sale_price || product.price || 0);
      const image = imageForColor(product, '');
      window.Suvera.addToCart(product.name, price, product.emoji || 'SU', {
        id: product.id,
        product_id: product.id,
        image,
      });
    } catch (err) {
      console.warn('Urun sepete eklenemedi:', err.message);
    }
  };

  window.selectProductCardColor = function (dot) {
    const card = dot && dot.closest ? dot.closest('.prod-card') : null;
    if (!card) return;
    card.querySelectorAll('.color-dot').forEach(function (item) {
      item.classList.remove('active');
    });
    dot.classList.add('active');
    const image = dot.getAttribute('data-image') || '';
    const img = card.querySelector('.prod-main-image');
    if (image && img) {
      var responsive = window.SuveraAPI.responsiveImage ? window.SuveraAPI.responsiveImage(image, 'card') : { src: image, srcset: '', sizes: '' };
      img.src = responsive.src;
      if (responsive.srcset) {
        img.srcset = responsive.srcset;
        img.sizes = responsive.sizes;
      } else {
        img.removeAttribute('srcset');
        img.removeAttribute('sizes');
      }
      card.dataset.productImage = image;
    }
  };

  function bindNewsletterForm() {
    var form = document.getElementById('newsletterForm');
    var status = document.getElementById('newsletterStatus');
    var input = document.getElementById('newsletterEmail');
    if (!form || !input || !window.SuveraAPI || !window.SuveraAPI.newsletter) return;
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var email = (input.value || '').trim();
      if (!email || !email.includes('@')) {
        if (status) status.textContent = 'Gecerli bir e-posta girin.';
        return;
      }
      var kvkk = document.getElementById('kvkk');
      if (kvkk && !kvkk.checked) {
        if (status) status.textContent = 'Devam etmek icin KVKK onayini isaretleyin.';
        return;
      }
      if (status) status.textContent = 'Gonderiliyor...';
      window.SuveraAPI.newsletter.subscribe(email).then(function () {
        if (status) status.textContent = 'Bultene kayit alindi. Tesekkurler!';
        form.reset();
      }).catch(function (err) {
        if (status) status.textContent = (err && err.message) || 'Kayit gerceklestirilemedi.';
      });
    });
  }

  // A28: the home grids follow the published theme's product-grid section when there is one.
  // SuveraTheme.ready never rejects, so a missing or failed theme simply yields the
  // pre-theme defaults and the catalog renders exactly as before.
  function homeProductLimit() {
    var settings = window.SuveraTheme ? window.SuveraTheme.sectionSettings('product-grid') : null;
    return settings && Number.isInteger(settings.limit) ? settings.limit : 8;
  }

  function whenThemeSettled() {
    return Promise.resolve(window.SuveraTheme ? window.SuveraTheme.ready : null).catch(function () { return null; });
  }

  document.addEventListener('DOMContentLoaded', function () {
    renderRealNavigation();
    var homeProductsPromise = whenThemeSettled().then(function () {
      if (!document.getElementById('homepageSections')) return [];
      renderHeroSlider();
      bindNewsletterForm();
      var jobs = [];
      document.querySelectorAll('[data-home-section-id]').forEach(function (wrapper) {
        var section = window.SuveraTheme && window.SuveraTheme.section
          ? window.SuveraTheme.section(wrapper.dataset.homeSectionId)
          : null;
        if (!section) return;
        var settings = section.settings || {};
        if (section.type === 'category-slider') {
          jobs.push(renderCategories(wrapper.querySelector('.home-category-rail'), settings.limit || 8, settings.categoryIds));
        } else if (section.type === 'collection-showcase') {
          jobs.push(renderCollections(wrapper.querySelector('.home-collection-rail'), settings));
        } else if (section.type === 'product-grid' || section.type === 'product-carousel') {
          jobs.push(renderProducts(wrapper.querySelector('.prods-grid, .home-product-rail'), settings.limit || 8, settings));
        }
      });
      return Promise.all(jobs).then(function (results) {
        return results.find(Array.isArray) || [];
      });
    });
    renderCollectionPage();
    if (!document.getElementById('collectionTitle') && !document.getElementById('homepageSections')) {
      var productGrid = document.getElementById('prodsGrid');
      var featuredTarget = document.getElementById('featuredProductsStrip') || document.querySelector('.featured-strip');
      if (!productGrid) {
        Promise.resolve(homeProductsPromise).then(function (products) {
          renderFeaturedStrip(featuredTarget, 5, products);
        });
        return;
      }
      renderProducts(productGrid, 24).then(function (products) {
        renderFeaturedStrip(
          featuredTarget,
          5,
          products
        );
      });
    }
  });
})();
