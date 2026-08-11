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

  function colorDots(colors, product) {
    const list = Array.isArray(colors) && colors.length ? colors : ['#d8d3c8'];
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
    const stock = Number(product.stock ?? product.stock_quantity ?? product.quantity ?? 0);
    if (Number.isFinite(stock) && stock > 0 && stock <= 3) return 'Son ' + stock + ' urun';
    if (product.in_stock === false || product.is_active === false) return 'Stokta yok';
    return 'Stokta';
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
    const emoji = product.emoji || 'SU';
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
        data-product-emoji="${escapeHtml(emoji)}"
        data-product-image="${escapeHtml(image)}"
        data-product-category="${escapeHtml(product.category_name || '')}"
        data-nav="urun?id=${id}">
        <div class="prod-img">
          <div class="prod-img-bg" data-css="background:linear-gradient(150deg,#d8d3c8,#c5bfb2)"></div>
          ${image ? `<img class="prod-main-image" src="${escapeHtml(responsive.src)}"${responsiveAttrs} alt="${escapeHtml(product.name)}" loading="lazy" decoding="async" data-css="position:relative;z-index:1;width:100%;height:100%;object-fit:cover;"/>` : `<span class="prod-emoji" data-css="position:relative;z-index:1">${escapeHtml(emoji)}</span>`}
          <div class="prod-badges">${badge(product)}</div>
          <div class="prod-hover-actions">
            <button class="quick-add">Hızlı Ekle</button>
            <button class="quick-fav" data-action="toggle-fav">♡</button>
            <button class="quick-view" title="Hızlı Bak">Bak</button>
          </div>
        </div>
        <div class="prod-info">
          <h4>${escapeHtml(product.name)}</h4>
          <div class="prod-colors">${colorDots(product.colors, product)}</div>
          <div class="prod-price">
            <span class="p-new">${money(price)}</span>
            ${oldPrice ? '<span class="p-old">' + money(oldPrice) + '</span>' : ''}
          </div>
          <span class="prod-stock-chip">${escapeHtml(stockLabel(product))}</span>
        </div>
      </div>`;
  }

  function featuredStripCard(product) {
    const price = Number(product.sale_price || product.price || 0);
    const oldPrice = product.sale_price ? Number(product.price || 0) : null;
    const emoji = product.emoji || 'SU';
    const image = imageForColor(product, '');
    const responsive = image && window.SuveraAPI.responsiveImage ? window.SuveraAPI.responsiveImage(image, 'card') : { src: image, srcset: '', sizes: '' };
    const responsiveAttrs = responsive.srcset ? ` srcset="${escapeHtml(responsive.srcset)}" sizes="${escapeHtml(responsive.sizes)}"` : '';
    const id = encodeURIComponent(product.id);

    return `
      <div class="feat-strip-item" data-nav="urun?id=${id}">
        <div class="feat-strip-img">
          ${image ? `<img src="${escapeHtml(responsive.src)}"${responsiveAttrs} alt="${escapeHtml(product.name)}" loading="lazy" decoding="async" data-css="width:100%;height:100%;object-fit:cover;display:block;"/>` : `<span>${escapeHtml(emoji)}</span>`}
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

  function pickCategoryVisual(index) {
    const visuals = ['EL', 'AB', 'TK', 'TR', 'ES', 'KL'];
    return visuals[index % visuals.length];
  }

  function categoryCard(category, index) {
    const categoryId = encodeURIComponent(category.id);
    const visual = pickCategoryVisual(index);
    const image = category.image_url ? window.SuveraAPI.assetUrl(category.image_url) : '';
    const imageStyle = image
      ? 'background-image:linear-gradient(to top, rgba(12,24,12,.58), rgba(12,24,12,.10) 55%),url(' + escapeHtml(image) + ');background-size:cover;background-position:center;'
      : '';
    return `
      <div class="cat-card" data-nav="urunler?category_id=${categoryId}">
        <div class="cat-inner${image ? ' has-image' : ''}" data-css="${imageStyle}">${image ? '' : escapeHtml(visual)}</div>
        <div class="cat-overlay">
          <h3>${escapeHtml(category.name || 'Kategori')}</h3>
          <p>${escapeHtml(category.slug || 'Suvera Seçkisi')}</p>
        </div>
      </div>`;
  }

  function applyEditorialVisual(target, image, fallbackText) {
    if (!target) return;
    target.classList.toggle('has-image', !!image);
    target.style.backgroundImage = image
      ? 'linear-gradient(to top, rgba(18,25,18,.54), rgba(18,25,18,.08) 58%),url(' + image + ')'
      : '';
    target.textContent = image ? '' : fallbackText;
  }

  function pickSlideVisual(index) {
    const visuals = [
      ['SU', 'VE'],
      ['EL', 'BI'],
      ['AB', 'YA'],
      ['ES', 'RP'],
      ['KO', 'LK'],
    ];
    return visuals[index % visuals.length];
  }

  function slideMarkup(slide, index) {
    const title = String(slide.title || 'Suvera Koleksiyonu');
    const pieces = title.split(/\s+/).filter(Boolean);
    const titleTop = pieces.slice(0, Math.max(1, Math.ceil(pieces.length / 2))).join(' ');
    const titleBottom = pieces.slice(Math.max(1, Math.ceil(pieces.length / 2))).join(' ') || 'Keşfet';
    const visuals = pickSlideVisual(index);
    const image = slide.image_url ? window.SuveraAPI.assetUrl(slide.image_url) : '';
    const background = image
      ? 'background-image:linear-gradient(rgba(26,26,26,.16), rgba(26,26,26,.34)),url(' + escapeHtml(image) + ');background-size:cover;background-position:center;'
      : '';
    return `
      <div class="slide${index === 0 ? ' active' : ''}">
        <div class="slide-bg" data-css="${background}"></div>
        <div class="slide-overlay"></div>
        <div class="slide-models">
          <div class="model-left">${escapeHtml(visuals[0])}</div>
          <div class="model-right">${escapeHtml(visuals[1])}</div>
        </div>
        <div class="slide-content">
          <span class="slide-tag">${escapeHtml(slide.tag || "İstanbul'dan yeni sezon")}</span>
          <h1 class="slide-title">
            ${escapeHtml(titleTop)}<br/>
            <em>${escapeHtml(titleBottom)}</em>
          </h1>
          <p class="slide-desc">${escapeHtml(slide.sub || "İstanbul ışığından ve Türkiye'nin şehirli ritminden ilham alan modern tesettür seçkileri.")}</p>
          <div class="hero-market-proof" aria-label="Suvera hizmet avantajları">
            <span>Türkiye geneli hızlı kargo</span>
            <span>İyzico ile güvenli ödeme</span>
            <span>30 gün kolay iade</span>
          </div>
          <div class="slide-ctas">
            <a href="urunler" class="btn-slide-primary">${escapeHtml(slide.btn || 'Keşfet')}</a>
            <a href="urunler" class="btn-slide-outline">Tüm Ürünler</a>
          </div>
        </div>
      </div>`;
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
      const slides = await window.SuveraAPI.slider.list();
      const items = Array.isArray(slides) && slides.length ? slides : [];
      if (!items.length) return;

      slider.querySelectorAll(':scope > .slide').forEach(function (node) {
        node.remove();
      });
      slider.insertAdjacentHTML('afterbegin', items.map(slideMarkup).join(''));
      renderHeroDots(document.getElementById('heroSliderDots'), items.length);

      if (typeof window.rebuildHeroSlider === 'function') {
        window.rebuildHeroSlider();
      }
    } catch (err) {
      console.warn('Suvera hero slider yüklenemedi:', err.message);
    }
  }

  function campaignLabel(campaign) {
    const value = Number(campaign.value || 0);
    const type = String(campaign.type || '').toLocaleLowerCase('tr-TR');
    if (type.includes('percent') || type.includes('yuzde')) return '%' + value + ' indirim';
    if (type.includes('bundle') || type.includes('3 al')) return campaign.name || 'Kampanya';
    return campaign.name || 'Kampanya';
  }

  function collectionHref(collection) {
    return safeHref(
      collection && collection.link_url,
      'urunler?collection=' + encodeURIComponent((collection && (collection.slug || collection.id)) || '')
    );
  }

  function renderAnnouncementItem(target, items, index) {
    if (!target || !items.length) return;
    var safeIndex = ((index % items.length) + items.length) % items.length;
    var item = items[safeIndex];
    target.dataset.index = String(safeIndex);
    target.innerHTML = ''
      + '<button class="announce-arrow" type="button" aria-label="Önceki kampanya">‹</button>'
      + '<a class="announce-link" href="' + escapeHtml(item.href) + '">' + escapeHtml(item.label) + '</a>'
      + '<button class="announce-arrow" type="button" aria-label="Sonraki kampanya">›</button>';
    var buttons = target.querySelectorAll('.announce-arrow');
    buttons[0].onclick = function () {
      renderAnnouncementItem(target, items, safeIndex - 1);
    };
    buttons[1].onclick = function () {
      renderAnnouncementItem(target, items, safeIndex + 1);
    };
  }

  async function renderCampaignAnnouncement() {
    const announcement = document.getElementById('campaignAnnouncement');
    if (!window.SuveraAPI || !announcement) return;

    try {
      const results = await Promise.all([
        window.SuveraAPI.campaigns.list().catch(function () { return []; }),
        window.SuveraAPI.collections ? window.SuveraAPI.collections.list().catch(function () { return []; }) : [],
      ]);
      const campaigns = Array.isArray(results[0]) ? results[0] : [];
      const collections = Array.isArray(results[1]) ? results[1] : [];
      const campaignItems = campaigns.map(function (campaign) {
        return {
          label: '✦ ' + (campaign.name || 'Suvera kampanyası') + ' • ' + campaignLabel(campaign) + ' ✦',
          href: 'urunler',
        };
      });
      const collectionItems = collections.map(function (collection) {
        return {
          label: '✦ ' + (collection.title || 'Suvera koleksiyonu') + ' koleksiyonuna ait ürünler ✦',
          href: collectionHref(collection),
        };
      });
      const items = campaignItems.concat(collectionItems);
      if (!items.length) return;

      renderAnnouncementItem(announcement, items, Number(announcement.dataset.index || 0));
    } catch (err) {
      console.warn('Suvera kampanya alanı yüklenemedi:', err.message);
    }
  }

  async function renderCategories(target, limit) {
    if (!window.SuveraAPI || !target) return;

    try {
      const categories = await window.SuveraAPI.categories.list();
      const items = Array.isArray(categories) ? categories.slice(0, limit || categories.length) : [];
      if (!items.length) return;
      target.innerHTML = items.map(categoryCard).join('');
    } catch (err) {
      console.warn('Suvera kategorileri yüklenemedi:', err.message);
    }
  }

  async function renderProducts(target, limit) {
    if (!window.SuveraAPI || !target) return;

    target.innerHTML = skeletonCards(limit || 6);

    try {
      const products = await window.SuveraAPI.products.list('?status=active&limit=' + limit);
      const items = products || [];
      const count = document.getElementById('productResultCount');
      if (count) count.textContent = items.length ? String(items.length) : '0';

      if (!items.length) {
        target.innerHTML = '<div class="empty-state">Suvera urunleri hazirlaniyor. Cok yakinda burada olacak.</div>';
        return [];
      }

      target.innerHTML = items.map(productCard).join('');
      if (window.Suvera && window.Suvera.refreshWishlistButtons) {
        window.Suvera.refreshWishlistButtons();
      }
      return items;
    } catch (err) {
      target.innerHTML = '<div class="empty-state">Suvera ürünleri şu anda yüklenemiyor. Lütfen kısa süre sonra tekrar deneyin.</div>';
      const count = document.getElementById('productResultCount');
      if (count) count.textContent = '0';
      console.warn('Suvera API urunleri alinamadi:', err.message);
      return [];
    }
  }

  // filterFeatured: true → show only products with featured_in_category=true (if any; else all)
  async function renderFeaturedStrip(target, limit, sourceProducts, filterFeatured) {
    if (!window.SuveraAPI || !target) return;

    target.innerHTML = skeletonCards(limit || 5);

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
        target.innerHTML = '<div class="empty-state">Öne çıkan ürünler hazırlanıyor.</div>';
        return;
      }

      target.innerHTML = items.map(featuredStripCard).join('');
    } catch (err) {
      target.innerHTML = '<div class="empty-state">Öne çıkan ürünler şu anda yüklenemiyor.</div>';
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
        collectionLinks.innerHTML = (collections || []).length
          ? collections.slice(0, 5).map(function (collection) {
              var href = safeHref(collection.link_url, 'urunler?collection=' + encodeURIComponent(collection.slug || collection.id));
              return '<a class="editorial-link" href="' + escapeHtml(href) + '">' +
                escapeHtml(collection.title || 'Suvera Koleksiyonu') + ' <span>' + escapeHtml(collection.slug || 'Seçki') + '</span></a>';
            }).join('')
          : '<a class="editorial-link" href="urunler">Koleksiyon hazırlanıyor <span>Suvera</span></a>';
      }

      var featuredCollection = (collections || [])[0] || null;
      var featuredEditorial = activeCollection || featuredCollection;
      if (featuredEditorial) {
        var editorialImage = featuredEditorial.image_url ? window.SuveraAPI.assetUrl(featuredEditorial.image_url) : '';
        if (editorialFeatureTag) editorialFeatureTag.textContent = featuredEditorial.slug || 'Koleksiyon';
        if (editorialFeatureTitle) editorialFeatureTitle.innerHTML = escapeHtml(featuredEditorial.title || 'Suvera Koleksiyonu').replace(/\s+/g, '<br/>');
        if (editorialFeatureDescription) editorialFeatureDescription.textContent = featuredEditorial.description || 'Panelya panelinden yayınlanan koleksiyon.';
        if (editorialFeatureLink) editorialFeatureLink.href = safeHref(featuredEditorial.link_url, 'urunler');
        applyEditorialVisual(editorialFeatureVisual, editorialImage, '🥻');
      }

      var collectionProducts = products;

      // ── Koleksiyon alt-kategori haritası ─────────────────────────────────
      // Computed once, used in both the sidebar and the editorial card below.
      var colParam = activeCollection ? 'collection=' + encodeURIComponent(selectedCollectionKey) : '';
      var subCats = categories;

      // ── Editorial panel kategori sütunu ──────────────────────────────────
      var editorialCategoryHeading = document.getElementById('editorialCategoryHeading');
      if (editorLinks) {
        if (activeCollection) {
          // Koleksiyon aktifken: o koleksiyonun kategori dağılımını göster
          if (editorialCategoryHeading) editorialCategoryHeading.textContent = activeCollection.title || 'Koleksiyon';
          editorLinks.innerHTML = subCats.length
            ? subCats.map(function (cat) {
                var href = catalogHref(params, { category: cat.id });
                return '<a class="editorial-link' + (String(cat.id) === String(selectedCategoryId) ? ' act' : '') + '" href="' + escapeHtml(href) + '">' +
                  escapeHtml(cat.name) + ' <span>' + cat.count + ' ürün</span></a>';
              }).join('')
            : '<a class="editorial-link" href="urunler?' + escapeHtml(colParam) + '">Ürünler yükleniyor <span>' + escapeHtml(activeCollection.slug || '') + '</span></a>';
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
          : '<div class="empty-state">Renk filtresi hazır değil.</div>';
      }

      if (sizeWrap) {
        sizeWrap.innerHTML = availableSizes.length
          ? availableSizes.map(function (facet) {
              var active = selectedSizes.has(normalizeSize(facet.value)) ? ' act' : '';
              return '<button class="size-btn' + active + '" type="button" data-size="' + escapeHtml(facet.value) + '">' + escapeHtml(facet.value) + ' <small>' + facet.count + '</small></button>';
            }).join('')
          : '<div class="empty-state">Beden filtresi hazır değil.</div>';
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
        applyEditorialVisual(collectionFeatureVisual, categoryImage, '🧕');
        if (!featuredEditorial) applyEditorialVisual(editorialFeatureVisual, categoryImage, '🥻');
      } else {
        applyEditorialVisual(collectionFeatureVisual, '', '🧕');
      }
      if (!activeCategory && (activeCollection || featuredCollection)) {
        var heroCollection = activeCollection || featuredCollection;
        var heroImage = heroCollection.image_url ? window.SuveraAPI.assetUrl(heroCollection.image_url) : '';
        if (featureTag) featureTag.textContent = heroCollection.slug || 'Öne Çıkan';
        if (featureTitle) featureTitle.innerHTML = escapeHtml(heroCollection.title || 'Suvera Seçkisi').replace(/\s+/g, '<br/>');
        if (featureDescription) featureDescription.textContent = heroCollection.description || 'Yayındaki ürünler Panelya panelinden canlı gelir.';
        applyEditorialVisual(collectionFeatureVisual, heroImage, '🧕');
      }

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
    renderHeroSlider();
    renderCampaignAnnouncement();
    bindNewsletterForm();
    renderCategories(document.getElementById('homeCategoryGrid'), 6);
    var homeProductsPromise = whenThemeSettled().then(function () {
      return renderProducts(document.getElementById('homeProductsGrid'), homeProductLimit());
    });
    renderCollectionPage();
    if (!document.getElementById('collectionTitle')) {
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
