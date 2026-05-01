(function () {
  'use strict';

  function money(value) {
    return Number(value || 0).toLocaleString('tr-TR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + ' TL';
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function (char) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
      }[char];
    });
  }

  // FIX: Block unsafe link protocols coming from CMS collection content.
  function safeHref(value, fallback) {
    const href = String(value || '').trim();
    if (!href) return fallback || 'urunler.html';
    try {
      const parsed = new URL(href, location.href);
      if (['http:', 'https:'].includes(parsed.protocol)) return href;
    } catch (_) {}
    if (/^(\/|\.\/|\.\.\/|#|[a-z0-9_-]+\.html(?:[?#].*)?)/i.test(href)) return href;
    return fallback || 'urunler.html';
  }

  function colorDots(colors) {
    const list = Array.isArray(colors) && colors.length ? colors : ['#d8d3c8'];
    return list.slice(0, 4).map(function (color, index) {
      return '<div class="color-dot ' + (index === 0 ? 'active' : '') + '" style="background:' + escapeHtml(color) + '"></div>';
    }).join('');
  }

  function badge(product) {
    if (product.sale_price) return '<span class="badge badge-sale">İndirim</span>';
    if (String(product.tags || '').toLowerCase().includes('yeni')) return '<span class="badge badge-new">Yeni</span>';
    return '';
  }

  function productCard(product) {
    const price = Number(product.sale_price || product.price || 0);
    const oldPrice = product.sale_price ? Number(product.price || 0) : null;
    const emoji = product.emoji || 'SU';
    const image = Array.isArray(product.images) && product.images.length ? window.SuveraAPI.assetUrl(product.images[0]) : '';
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
        onclick="location.href='urun.html?id=${id}'">
        <div class="prod-img">
          <div class="prod-img-bg" style="background:linear-gradient(150deg,#d8d3c8,#c5bfb2)"></div>
          ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async" style="position:relative;z-index:1;width:100%;height:100%;object-fit:cover;"/>` : `<span style="position:relative;z-index:1">${escapeHtml(emoji)}</span>`}
          <div class="prod-badges">${badge(product)}</div>
          <div class="prod-hover-actions">
            <button class="quick-add" onclick="event.stopPropagation();addApiProductToCart('${id}')">Hızlı Ekle</button>
            <button class="quick-fav" onclick="event.stopPropagation()">♡</button>
            <button class="quick-view" onclick="event.stopPropagation()" title="Hızlı Bak">Bak</button>
          </div>
        </div>
        <div class="prod-info">
          <h4>${escapeHtml(product.name)}</h4>
          <div class="prod-colors">${colorDots(product.colors)}</div>
          <div class="prod-price">
            <span class="p-new">${money(price)}</span>
            ${oldPrice ? '<span class="p-old">' + money(oldPrice) + '</span>' : ''}
          </div>
        </div>
      </div>`;
  }

  function featuredStripCard(product) {
    const price = Number(product.sale_price || product.price || 0);
    const oldPrice = product.sale_price ? Number(product.price || 0) : null;
    const emoji = product.emoji || 'SU';
    const image = Array.isArray(product.images) && product.images.length ? window.SuveraAPI.assetUrl(product.images[0]) : '';
    const id = encodeURIComponent(product.id);

    return `
      <div class="feat-strip-item" onclick="location.href='urun.html?id=${id}'">
        <div class="feat-strip-img">
          ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover;display:block;"/>` : `<span>${escapeHtml(emoji)}</span>`}
        </div>
        <div class="feat-strip-info">
          <p>${escapeHtml(product.name)}</p>
          <span>${money(price)}${oldPrice ? ' <del>' + money(oldPrice) + '</del>' : ''}</span>
        </div>
      </div>`;
  }

  function normalizeColor(value) {
    return String(value || '').trim().toLowerCase();
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
    return `
      <div class="cat-card" onclick="location.href='urunler.html?category_id=${categoryId}'">
        <div class="cat-inner">${escapeHtml(visual)}</div>
        <div class="cat-overlay">
          <h3>${escapeHtml(category.name || 'Kategori')}</h3>
          <p>${escapeHtml(category.slug || 'Suvera Seçkisi')}</p>
        </div>
      </div>`;
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
        <div class="slide-bg" style="${background}"></div>
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
            <a href="urunler.html" class="btn-slide-primary">${escapeHtml(slide.btn || 'Keşfet')}</a>
            <a href="urunler.html" class="btn-slide-outline">Tüm Ürünler</a>
          </div>
        </div>
      </div>`;
  }

  function renderHeroDots(target, count) {
    if (!target) return;
    target.innerHTML = Array.from({ length: Math.max(count, 1) }).map(function (_, index) {
      return '<button class="slider-dot' + (index === 0 ? ' active' : '') + '" onclick="goSlide(' + index + ')"></button>';
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

  async function renderCampaignAnnouncement() {
    const announcement = document.getElementById('campaignAnnouncement');
    if (!window.SuveraAPI || !announcement) return;

    try {
      const campaigns = await window.SuveraAPI.campaigns.list();
      const active = Array.isArray(campaigns) && campaigns.length ? campaigns[0] : null;
      if (!active) return;

      announcement.textContent = '✦ ' + (active.name || 'Suvera kampanyasi') + ' • ' + campaignLabel(active) + ' ✦';
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

    target.innerHTML = '<div class="empty-state">Suvera ürünleri yükleniyor.</div>';

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

  async function renderFeaturedStrip(target, limit, sourceProducts) {
    if (!window.SuveraAPI || !target) return;

    target.innerHTML = '<div class="empty-state">Öne çıkan ürünler yükleniyor.</div>';

    try {
      // FIX: Reuse the product list already loaded on the page instead of refetching.
      const products = Array.isArray(sourceProducts)
        ? sourceProducts
        : await window.SuveraAPI.products.list('?status=active&limit=' + limit);
      const items = (products || []).slice(0, limit);

      if (!items.length) {
        target.innerHTML = '<div class="empty-state">One cikan urunler hazirlaniyor.</div>';
        return;
      }

      target.innerHTML = items.map(featuredStripCard).join('');
    } catch (err) {
      target.innerHTML = '<div class="empty-state">Öne çıkan ürünler şu anda yüklenemiyor.</div>';
    }
  }

  function sortProducts(items, sortValue) {
    const list = (items || []).slice();
    if (sortValue === 'price_asc') {
      return list.sort(function (a, b) {
        return Number(a.sale_price || a.price || 0) - Number(b.sale_price || b.price || 0);
      });
    }
    if (sortValue === 'price_desc') {
      return list.sort(function (a, b) {
        return Number(b.sale_price || b.price || 0) - Number(a.sale_price || a.price || 0);
      });
    }
    if (sortValue === 'name_asc') {
      return list.sort(function (a, b) {
        return String(a.name || '').localeCompare(String(b.name || ''), 'tr');
      });
    }
    if (sortValue === 'newest') {
      return list.sort(function (a, b) {
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      });
    }
    return list;
  }

  function syncQuery(params) {
    const query = params.toString();
    const next = location.pathname + (query ? '?' + query : '');
    history.replaceState({}, '', next);
  }

  async function renderCollectionPage() {
    var grid = document.getElementById('prodsGrid');
    if (!window.SuveraAPI || !grid || !document.getElementById('collectionTitle')) return;

    var params = new URLSearchParams(location.search);
    var selectedCategoryId = params.get('category_id') || '';
    var selectedCollectionKey = (params.get('collection') || params.get('collection_slug') || '').trim();
    var selectedQuery = (params.get('q') || '').trim();
    var selectedSort = params.get('sort') || 'recommended';
    var selectedColors = new Set((params.get('colors') || '').split(',').map(normalizeColor).filter(Boolean));
    var selectedSizes = new Set((params.get('sizes') || '').split(',').map(normalizeSize).filter(Boolean));
    var maxPrice = Number(params.get('max_price') || 5000);

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

    if (sortSelect) sortSelect.value = selectedSort;
    if (priceRange) priceRange.value = String(maxPrice);
    if (priceVal) priceVal.textContent = maxPrice + ' TL';

    try {
      var categories = await window.SuveraAPI.categories.list();
      var productQuery = new URLSearchParams({ status: 'active', limit: '64' });
      if (/^\d+$/.test(selectedCategoryId)) productQuery.set('category_id', selectedCategoryId);
      if (selectedQuery) productQuery.set('q', selectedQuery);
      // FIX: Push supported catalog filters into the API query before client-side facets run.
      var products = await window.SuveraAPI.products.list('?' + productQuery.toString());
      var collections = window.SuveraAPI.collections
        ? await window.SuveraAPI.collections.list().catch(function () { return []; })
        : [];

      var categoryMap = new Map((categories || []).map(function (category) {
        return [String(category.id), category];
      }));
      var activeCategory = categoryMap.get(String(selectedCategoryId)) || null;
      var activeCollection = null;
      if (selectedCollectionKey) {
        activeCollection = (collections || []).find(function (collection) {
          return String(collection.slug || '').toLocaleLowerCase('tr-TR') === selectedCollectionKey.toLocaleLowerCase('tr-TR')
            || String(collection.id) === selectedCollectionKey;
        }) || null;
      }

      if (categoryWrap) {
        categoryWrap.innerHTML = '<label class="filter-check"><input type="radio" name="collectionCategory" value="" ' + (activeCategory ? '' : 'checked') + '/> Tüm Ürünler</label>' +
          (categories || []).map(function (category) {
            var checked = String(category.id) === String(selectedCategoryId) ? 'checked' : '';
            return '<label class="filter-check"><input type="radio" name="collectionCategory" value="' + escapeHtml(category.id) + '" ' + checked + '/> ' + escapeHtml(category.name) + '</label>';
          }).join('');
      }

      if (editorLinks) {
        editorLinks.innerHTML = (categories || []).slice(0, 5).map(function (category) {
          return '<a class="editorial-link" href="urunler.html?category_id=' + encodeURIComponent(category.id) + '">' +
            escapeHtml(category.name) + ' <span>' + escapeHtml(category.slug || 'Suvera') + '</span></a>';
        }).join('');
      }

      if (collectionLinks) {
        collectionLinks.innerHTML = (collections || []).length
          ? collections.slice(0, 5).map(function (collection) {
              var href = safeHref(collection.link_url, 'urunler.html?collection=' + encodeURIComponent(collection.slug || collection.id));
              return '<a class="editorial-link" href="' + escapeHtml(href) + '">' +
                escapeHtml(collection.title || 'Suvera Koleksiyonu') + ' <span>' + escapeHtml(collection.slug || 'Seçki') + '</span></a>';
            }).join('')
          : '<a class="editorial-link" href="urunler.html">Koleksiyon hazırlanıyor <span>Suvera</span></a>';
      }

      var featuredCollection = (collections || [])[0] || null;
      var featuredEditorial = activeCollection || featuredCollection;
      if (featuredEditorial) {
        if (editorialFeatureTag) editorialFeatureTag.textContent = featuredEditorial.slug || 'Koleksiyon';
        if (editorialFeatureTitle) editorialFeatureTitle.innerHTML = escapeHtml(featuredEditorial.title || 'Suvera Koleksiyonu').replace(/\s+/g, '<br/>');
        if (editorialFeatureDescription) editorialFeatureDescription.textContent = featuredEditorial.description || 'Panelya panelinden yayınlanan koleksiyon.';
        if (editorialFeatureLink) editorialFeatureLink.href = safeHref(featuredEditorial.link_url, 'urunler.html');
      }

      var availableColors = [];
      var availableSizes = [];
      (products || []).forEach(function (product) {
        (product.colors || []).forEach(function (color) {
          if (color && !availableColors.includes(color)) availableColors.push(color);
        });
        (product.sizes || []).forEach(function (size) {
          if (size && !availableSizes.includes(size)) availableSizes.push(size);
        });
      });

      if (colorWrap) {
        colorWrap.innerHTML = availableColors.length
          ? availableColors.map(function (color) {
              var active = selectedColors.has(normalizeColor(color)) ? ' act' : '';
              return '<div class="cf-dot' + active + '" style="background:' + escapeHtml(color) + '" data-color="' + escapeHtml(color) + '" title="' + escapeHtml(color) + '"></div>';
            }).join('')
          : '<div class="empty-state">Renk filtresi hazır değil.</div>';
      }

      if (sizeWrap) {
        sizeWrap.innerHTML = availableSizes.length
          ? availableSizes.map(function (size) {
              var active = selectedSizes.has(normalizeSize(size)) ? ' act' : '';
              return '<button class="size-btn' + active + '" type="button" data-size="' + escapeHtml(size) + '">' + escapeHtml(size) + '</button>';
            }).join('')
          : '<button class="size-btn act" type="button" data-size="STANDART">Standart</button>';
      }

      var filtered = (products || []).filter(function (product) {
        var price = Number(product.sale_price || product.price || 0);
        var categoryOk = !selectedCategoryId || String(product.category_id || '') === String(selectedCategoryId);
        var queryOk = !selectedQuery || productMatches(product, selectedQuery);
        var priceOk = price <= maxPrice;
        var colorOk = !selectedColors.size || (product.colors || []).some(function (color) {
          return selectedColors.has(normalizeColor(color));
        });
        var sizeOk = !selectedSizes.size || (product.sizes || []).some(function (size) {
          return selectedSizes.has(normalizeSize(size));
        });
        return categoryOk && queryOk && priceOk && colorOk && sizeOk;
      });

      filtered = sortProducts(filtered, selectedSort);

      title.textContent = activeCategory ? activeCategory.name : (selectedQuery ? '"' + selectedQuery + '" için sonuçlar' : 'Tüm Ürünler');
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
      if (!activeCategory && (activeCollection || featuredCollection)) {
        var heroCollection = activeCollection || featuredCollection;
        if (featureTag) featureTag.textContent = heroCollection.slug || 'Öne Çıkan';
        if (featureTitle) featureTitle.innerHTML = escapeHtml(heroCollection.title || 'Suvera Seçkisi').replace(/\s+/g, '<br/>');
        if (featureDescription) featureDescription.textContent = heroCollection.description || 'Yayındaki ürünler Panelya panelinden canlı gelir.';
      }

      var resultCount = document.getElementById('productResultCount');
      if (resultCount) resultCount.textContent = String(filtered.length);

      if (!filtered.length) {
        grid.innerHTML = '<div class="empty-state">Bu filtrelerle eşleşen ürün bulunamadı.</div>';
      } else {
        grid.innerHTML = filtered.map(productCard).join('');
      }

      renderFeaturedStrip(document.getElementById('featuredProductsStrip'), 5, products);
      if (window.Suvera && window.Suvera.refreshWishlistButtons) {
        window.Suvera.refreshWishlistButtons();
      }

      if (categoryWrap) {
        categoryWrap.querySelectorAll('input[name="collectionCategory"]').forEach(function (input) {
          input.addEventListener('change', function () {
            params.set('category_id', input.value);
            if (!input.value) params.delete('category_id');
            syncQuery(params);
            renderCollectionPage();
          });
        });
      }

      if (colorWrap) {
        colorWrap.querySelectorAll('[data-color]').forEach(function (dot) {
          dot.addEventListener('click', function () {
            var key = normalizeColor(dot.getAttribute('data-color'));
            if (selectedColors.has(key)) selectedColors.delete(key);
            else selectedColors.add(key);
            if (selectedColors.size) params.set('colors', Array.from(selectedColors).join(','));
            else params.delete('colors');
            syncQuery(params);
            renderCollectionPage();
          });
        });
      }

      if (sizeWrap) {
        sizeWrap.querySelectorAll('[data-size]').forEach(function (button) {
          button.addEventListener('click', function () {
            var key = normalizeSize(button.getAttribute('data-size'));
            if (selectedSizes.has(key)) selectedSizes.delete(key);
            else selectedSizes.add(key);
            if (selectedSizes.size) params.set('sizes', Array.from(selectedSizes).join(','));
            else params.delete('sizes');
            syncQuery(params);
            renderCollectionPage();
          });
        });
      }

      if (sortSelect) {
        sortSelect.onchange = function () {
          params.set('sort', sortSelect.value);
          syncQuery(params);
          renderCollectionPage();
        };
      }

      if (priceRange) {
        priceRange.oninput = function () {
          if (priceVal) priceVal.textContent = priceRange.value + ' TL';
        };
        priceRange.onchange = function () {
          params.set('max_price', priceRange.value);
          syncQuery(params);
          renderCollectionPage();
        };
      }

      if (resetButton) {
        resetButton.onclick = function () {
          location.href = 'urunler.html';
        };
      }
    } catch (err) {
      grid.innerHTML = '<div class="empty-state">Ürün listesi şu anda yüklenemiyor. Lütfen kısa süre sonra tekrar deneyin.</div>';
      console.warn('Suvera koleksiyon sayfası yüklenemedi:', err.message);
    }
  }

  window.addApiProductToCart = async function (id) {
    if (!window.SuveraAPI || !window.Suvera) return;

    try {
      const product = await window.SuveraAPI.products.get(id);
      const price = Number(product.sale_price || product.price || 0);
      const image = Array.isArray(product.images) && product.images.length ? window.SuveraAPI.assetUrl(product.images[0]) : '';
      window.Suvera.addToCart(product.name, price, product.emoji || 'SU', {
        id: product.id,
        product_id: product.id,
        image,
      });
    } catch (err) {
      console.warn('Urun sepete eklenemedi:', err.message);
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    renderHeroSlider();
    renderCampaignAnnouncement();
    renderCategories(document.getElementById('homeCategoryGrid'), 6);
    var homeProductsPromise = renderProducts(document.getElementById('homeProductsGrid'), 8);
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
