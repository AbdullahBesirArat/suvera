(function () {
  'use strict';

  let currentProduct = {
    id: null,
    name: 'Ürün',
    price: 0,
    emoji: '👗',
    image: '',
    selectedColor: '',
    selectedSize: '',
    images: [],
    imageEntries: [],
    categoryId: null,
    variants: [],
  };
  let activeImageIndex = 0;
  let lightboxScrollY = 0;

  function money(value) {
    return Number(value || 0).toLocaleString('tr-TR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + ' TL';
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function (char) {
      return ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char];
    });
  }

  function plainDescription(html) {
    return String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+\n/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function measurementLines(text) {
    return text
      .split('\n')
      .map(function (line) { return line.trim(); })
      .filter(function (line) { return /\bbeden\b|cm|göğüs|gogus|bel|omuz|kol|uzunluk/i.test(line); });
  }

  function articleLines(text) {
    return text
      .split('\n')
      .map(function (line) { return line.trim(); })
      .filter(Boolean)
      .slice(0, 4);
  }

  function imageUrl(path) {
    return window.SuveraAPI && window.SuveraAPI.assetUrl ? window.SuveraAPI.assetUrl(path) : path;
  }

  function normalizeColor(value) {
    return String(value || '').trim().toLocaleLowerCase('tr-TR');
  }

  function colorMeta(value) {
    const raw = String(value || '').trim();
    const parts = raw.split('|').map(function (part) { return part.trim(); }).filter(Boolean);
    const hexMatch = raw.match(/#(?:[0-9a-f]{3}){1,2}\b/i);
    const label = parts.length >= 2
      ? parts[0]
      : raw.replace(/#(?:[0-9a-f]{3}){1,2}\b/i, '').replace(/[()]/g, '').trim();
    const css = parts.length >= 2 ? parts[parts.length - 1] : (hexMatch ? hexMatch[0] : raw);
    return {
      label: label || css,
      css: css || '#e9dfd0',
      value: raw,
    };
  }

  function parseImageEntry(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const parts = raw.split('|').map(function (part) { return part.trim(); }).filter(Boolean);
    if (parts.length >= 2) {
      return {
        color: parts[0],
        url: parts[parts.length - 1],
      };
    }
    return {
      color: '',
      url: raw,
    };
  }

  function productImageEntries(product) {
    return (Array.isArray(product.images) ? product.images : [])
      .map(parseImageEntry)
      .filter(function (entry) { return entry && entry.url; });
  }

  function imageEntriesForColor(color) {
    const selected = normalizeColor(color);
    const entries = currentProduct.imageEntries || [];
    const colorEntries = selected
      ? entries.filter(function (entry) { return normalizeColor(entry.color) === selected; })
      : [];
    return colorEntries.length ? colorEntries : entries;
  }

  function imageMarkup(src, alt, fallbackClass) {
    return src
      ? '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(alt) + '" loading="lazy" decoding="async"/>'
      : '<div class="' + fallbackClass + '">' + escapeHtml(currentProduct.emoji) + '</div>';
  }

  function resetLightboxView(stage) {
    if (!stage) return;
    stage.scrollTop = 0;
    stage.scrollLeft = 0;
  }

  function openImageLightbox(index) {
    const src = currentProduct.images[index] || currentProduct.images[activeImageIndex] || currentProduct.images[0] || '';
    if (!src) return;

    const lightbox = document.getElementById('imageLightbox');
    const stage = document.getElementById('imageLightboxStage');
    const img = document.getElementById('imageLightboxImg');
    const zoomButton = document.getElementById('imageLightboxZoom');
    const count = document.getElementById('imageLightboxCount');
    if (!lightbox || !stage || !img) return;

    resetLightboxView(stage);
    img.onload = function () {
      resetLightboxView(stage);
      requestAnimationFrame(function () {
        resetLightboxView(stage);
      });
    };
    img.src = src;
    img.alt = currentProduct.name || 'Suvera ürün görseli';
    lightbox.classList.remove('zoomed');
    if (zoomButton) zoomButton.textContent = '⌕';
    if (count) {
      count.textContent = (index + 1) + ' / ' + Math.max(currentProduct.images.length, 1);
    }
    lightbox.classList.add('open');
    lightbox.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(function () {
      resetLightboxView(stage);
    });
    lightboxScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = '-' + lightboxScrollY + 'px';
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
  }

  function closeImageLightbox() {
    const lightbox = document.getElementById('imageLightbox');
    const stage = document.getElementById('imageLightboxStage');
    const img = document.getElementById('imageLightboxImg');
    if (!lightbox) return;

    lightbox.classList.remove('open');
    lightbox.classList.remove('zoomed');
    lightbox.setAttribute('aria-hidden', 'true');
    if (stage) {
      resetLightboxView(stage);
    }
    if (img) img.removeAttribute('src');
    document.documentElement.style.overflow = '';
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    window.scrollTo(0, lightboxScrollY);
  }

  function setActiveThumb(index) {
    activeImageIndex = index;
    const thumbs = document.querySelectorAll('.thumb-btn');
    thumbs.forEach(function (thumb, i) {
      thumb.classList.toggle('active', i === index);
    });

    const media = currentProduct.images[index] || currentProduct.images[0] || '';
    currentProduct.image = media;
    const favButton = document.getElementById('favToggle');
    if (favButton) {
      favButton.dataset.productImage = media;
      if (window.Suvera && window.Suvera.syncFavoriteButton) {
        window.Suvera.syncFavoriteButton(favButton, {
          id: currentProduct.id,
          name: currentProduct.name,
          price: currentProduct.price,
          image: media,
          emoji: currentProduct.emoji,
        });
      }
    }
    const mainMedia = document.getElementById('detailMainMedia');
    const counter = document.getElementById('galleryCounter');

    if (mainMedia) {
      mainMedia.innerHTML = imageMarkup(media, currentProduct.name, 'main-fallback');
      mainMedia.onclick = function () {
        openImageLightbox(activeImageIndex);
      };
    }
    if (counter) {
      counter.textContent = (index + 1) + ' / ' + Math.max(currentProduct.images.length, 1);
    }
  }

  function renderGallery(product, color) {
    currentProduct.imageEntries = productImageEntries(product);
    const images = imageEntriesForColor(color).map(function (entry) {
      return imageUrl(entry.url);
    });

    currentProduct.images = images;
    currentProduct.image = images[0] || '';

    const thumbs = document.getElementById('detailThumbs');
    if (!thumbs) return;

    if (!images.length) {
      thumbs.innerHTML = '<button class="thumb-btn active" type="button"><div class="thumb-fallback">' + escapeHtml(currentProduct.emoji) + '</div></button>';
      setActiveThumb(0);
      return;
    }

    thumbs.innerHTML = images.map(function (src, index) {
      return '<button class="thumb-btn' + (index === 0 ? ' active' : '') + '" type="button" data-index="' + index + '">' +
        imageMarkup(src, product.name + ' görsel ' + (index + 1), 'thumb-fallback') +
        '</button>';
    }).join('');

    thumbs.querySelectorAll('.thumb-btn').forEach(function (button) {
      button.addEventListener('click', function () {
        setActiveThumb(Number(button.dataset.index || 0));
      });
    });

    setActiveThumb(0);
  }

  function renderSwatches(product) {
    const colors = Array.isArray(product.colors) && product.colors.length ? product.colors : ['#e9dfd0'];
    currentProduct.selectedColor = colors[0];

    const wrap = document.getElementById('detailColors');
    const label = document.getElementById('detailColorLabel');
    if (!wrap) return;

    wrap.innerHTML = colors.map(function (color, index) {
      const meta = colorMeta(color);
      return '<button class="swatch' + (index === 0 ? ' active' : '') + '" type="button" style="background:' + escapeHtml(meta.css) + '" data-color="' + escapeHtml(color) + '" title="' + escapeHtml(meta.label) + '"></button>';
    }).join('');

    if (label) label.textContent = colorMeta(colors[0]).label;

    wrap.querySelectorAll('.swatch').forEach(function (button) {
      button.addEventListener('click', function () {
        wrap.querySelectorAll('.swatch').forEach(function (item) { item.classList.remove('active'); });
        button.classList.add('active');
        currentProduct.selectedColor = button.dataset.color || '';
        if (label) label.textContent = colorMeta(currentProduct.selectedColor).label;
        renderGallery(product, currentProduct.selectedColor);
      });
    });
  }

  function renderSizes(product) {
    const sizes = Array.isArray(product.sizes) && product.sizes.length ? product.sizes : ['Standart'];
    currentProduct.selectedSize = sizes[0];

    const wrap = document.getElementById('detailSizes');
    const label = document.getElementById('detailSizeLabel');
    if (!wrap) return;

    wrap.innerHTML = sizes.map(function (size, index) {
      return '<button class="size-btn' + (index === 0 ? ' active' : '') + '" type="button" data-size="' + escapeHtml(size) + '">' + escapeHtml(size) + '</button>';
    }).join('');

    if (label) label.textContent = sizes[0];

    wrap.querySelectorAll('.size-btn').forEach(function (button) {
      button.addEventListener('click', function () {
        wrap.querySelectorAll('.size-btn').forEach(function (item) { item.classList.remove('active'); });
        button.classList.add('active');
        currentProduct.selectedSize = button.dataset.size || '';
        if (label) label.textContent = currentProduct.selectedSize;
      });
    });
  }

  function renderInfo(product) {
    const finalPrice = Number(product.sale_price || product.price || 0);
    const oldPrice = product.sale_price ? Number(product.price || 0) : 0;
    const text = plainDescription(product.description);
    const measure = measurementLines(text);
    const story = articleLines(text);
    const details = product.details && typeof product.details === 'object' ? product.details : {};
    const storyText = details.story || story.join(' ') || 'Bu ürün, sade çizgiyi yumuşak kumaş hissiyle bir araya getirir.';
    const shortText = details.short_description || story[0] || 'Rahat kalıp, dengeli duruş ve sezon boyunca sık kullanılacak bir parça.';
    const deliveryText = details.delivery_note || 'Siparişler 1-3 iş günü içinde hazırlanır. Kargo çıktığında takip numarası hesabınıza ve sipariş ekranına işlenir.\nKullanılmamış ürünlerde değişim ve iade desteği için bizimle iletişime geçebilirsiniz.';
    const customMeasurements = details.measurements
      ? details.measurements.split('\n').map(function (line) { return line.trim(); }).filter(Boolean)
      : [];
    const measurementData = customMeasurements.length ? customMeasurements : measure;
    const stock = Number(product.stock || 0);

    currentProduct.id = product.id;
    currentProduct.name = product.name || 'Ürün';
    currentProduct.price = finalPrice;
    currentProduct.emoji = product.emoji || '👗';
    currentProduct.categoryId = product.category_id || null;
    currentProduct.variants = Array.isArray(product.variants) ? product.variants : [];

    document.title = currentProduct.name + ' – Suvera';
    document.getElementById('detailProductTitle').textContent = currentProduct.name;
    document.getElementById('detailCategory').textContent = product.category_name || 'Suvera Seçkisi';
    document.getElementById('detailPriceNew').textContent = money(finalPrice);
    document.getElementById('detailPriceNew').classList.toggle('price-sale', !!product.sale_price);
    document.getElementById('detailSku').textContent = 'SKU: MV-' + String(product.id || 0).padStart(5, '0');

    const oldPriceNode = document.getElementById('detailPriceOld');
    oldPriceNode.style.display = oldPrice ? '' : 'none';
    oldPriceNode.textContent = oldPrice ? money(oldPrice) : '';

    document.getElementById('detailStockText').innerHTML = '<strong>Stok durumu</strong> ' + (stock > 0 ? stock + ' adet hazır' : 'Tükendi');
    document.getElementById('stockBadge').textContent = stock > 0 ? 'Stokta' : 'Tükendi';

    const meta = [];
    if (product.tags) meta.push(product.tags.split(',')[0]);
    if (product.category_name) meta.push(product.category_name);
    meta.push(stock > 0 ? 'Hızlı Kargo' : 'Tekrar Geliyor');
    document.getElementById('detailMeta').innerHTML = meta.map(function (item) {
      return '<span class="meta-chip">' + escapeHtml(item) + '</span>';
    }).join('');

    document.getElementById('detailShortDesc').textContent = shortText;
    document.getElementById('detailDescriptionBody').innerHTML = story.length
      ? story.map(function (line) { return '<p>' + escapeHtml(line) + '</p>'; }).join('')
      : '<p>Ürün açıklaması hazırlanıyor.</p>';

    document.getElementById('detailDescriptionBody').innerHTML = (details.story || story.length)
      ? (details.story ? details.story.split('\n').filter(Boolean).map(function (line) { return '<p>' + escapeHtml(line.trim()) + '</p>'; }).join('') : story.map(function (line) { return '<p>' + escapeHtml(line) + '</p>'; }).join(''))
      : '<p>Ürün açıklaması hazırlanıyor.</p>';

    document.getElementById('detailMeasurementBody').innerHTML = measurementData.length
      ? '<table>' + measurementData.map(function (line) { return '<tr><td>' + escapeHtml(line) + '</td></tr>'; }).join('') + '</table>'
      : '<p>Ölçü bilgisi hazırlanıyor.</p>';

    document.getElementById('detailStoryCopy').textContent = storyText;

    const measureList = document.getElementById('detailMeasureList');
    measureList.innerHTML = measurementData.slice(0, 5).map(function (line, index) {
      return '<div class="measure-row"><span>Detay ' + (index + 1) + '</span><strong>' + escapeHtml(line) + '</strong></div>';
    }).join('') || '<div class="measure-row"><span>Bilgi</span><strong>Ölçü tablosu eklenecek</strong></div>';

    const deliveryBodies = document.querySelectorAll('.info-body');
    if (deliveryBodies[2]) {
      deliveryBodies[2].innerHTML = deliveryText.split('\n').filter(Boolean).map(function (line) {
        return '<p>' + escapeHtml(line.trim()) + '</p>';
      }).join('');
    }

    const breadcrumb = document.getElementById('productBreadcrumb');
    breadcrumb.innerHTML = '<a href="anasayfa">Ana Sayfa</a><span>›</span><a href="urunler">Ürünler</a><span>›</span><a href="urunler">' +
      escapeHtml(product.category_name || 'Kategori') + '</a><span>›</span><span>' + escapeHtml(currentProduct.name) + '</span>';

    const favButton = document.getElementById('favToggle');
    if (favButton) {
      favButton.dataset.productId = String(currentProduct.id || '');
      favButton.dataset.productName = currentProduct.name;
      favButton.dataset.productPrice = String(currentProduct.price || 0);
      favButton.dataset.productImage = currentProduct.image || '';
      favButton.dataset.productEmoji = currentProduct.emoji || '';
      favButton.dataset.productUrl = currentProduct.id ? ('urun?id=' + encodeURIComponent(currentProduct.id)) : 'urun';
      if (window.Suvera && window.Suvera.syncFavoriteButton) {
        window.Suvera.syncFavoriteButton(favButton, {
          id: currentProduct.id,
          name: currentProduct.name,
          price: currentProduct.price,
          image: currentProduct.image,
          emoji: currentProduct.emoji,
        });
      }
    }

    if (window.SuveraSEO) {
      const pagePath = 'urun?id=' + encodeURIComponent(currentProduct.id || '');
      window.SuveraSEO.applyPageMeta({
        title: currentProduct.name + ' | Suvera',
        description: shortText,
        path: pagePath,
        image: currentProduct.image || window.SuveraSEO.defaultImage,
        type: 'product',
      });
      window.SuveraSEO.applyBaseSchemas({
        path: pagePath,
        name: currentProduct.name + ' | Suvera',
        description: shortText,
      });
      window.SuveraSEO.applyJsonLd('suvera-product-schema', {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: currentProduct.name,
        image: currentProduct.image ? [window.SuveraSEO.toAbsolute(currentProduct.image)] : [window.SuveraSEO.defaultImage],
        description: shortText,
        sku: 'MV-' + String(product.id || 0).padStart(5, '0'),
        brand: {
          '@type': 'Brand',
          name: 'Suvera'
        },
        offers: {
          '@type': 'Offer',
          priceCurrency: 'TRY',
          price: finalPrice,
          availability: stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          url: window.SuveraSEO.toAbsolute(pagePath)
        }
      });
    }
  }

  function bindImageLightbox() {
    const lightbox = document.getElementById('imageLightbox');
    const closeButton = document.getElementById('imageLightboxClose');
    const zoomButton = document.getElementById('imageLightboxZoom');
    const stage = document.getElementById('imageLightboxStage');
    if (!lightbox) return;

    if (closeButton) {
      closeButton.addEventListener('click', closeImageLightbox);
    }
    if (zoomButton) {
      zoomButton.addEventListener('click', function (event) {
        event.stopPropagation();
        lightbox.classList.toggle('zoomed');
        zoomButton.textContent = lightbox.classList.contains('zoomed') ? '−' : '⌕';
        resetLightboxView(stage);
        requestAnimationFrame(function () {
          resetLightboxView(stage);
        });
      });
    }
    lightbox.addEventListener('click', function (event) {
      if (event.target === lightbox) closeImageLightbox();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeImageLightbox();
    });
  }

  function renderRelated(products) {
    const wrap = document.getElementById('relatedProducts');
    if (!wrap) return;

    if (!products.length) {
      wrap.innerHTML = '<div class="empty-state">Benzer ürünler bu kategoriye ürün eklendikçe burada görünür.</div>';
      return;
    }

    wrap.innerHTML = products.map(function (product) {
      const price = Number(product.sale_price || product.price || 0);
      const firstImage = productImageEntries(product)[0];
      const src = firstImage ? imageUrl(firstImage.url) : '';
      // FIX: Encode product ids before inserting them into inline navigation handlers.
      return '<article class="related-card" onclick="location.href=\'urun?id=' + encodeURIComponent(product.id) + '\'">' +
        '<div class="related-media">' + imageMarkup(src, product.name, 'related-fallback') + '</div>' +
        '<div class="related-info"><p>' + escapeHtml(product.category_name || 'Seçki') + '</p><h3>' + escapeHtml(product.name) + '</h3><div class="related-price">' + money(price) + '</div></div>' +
      '</article>';
    }).join('');
  }

  function showCartFeedback(message, options = {}) {
    const feedback = document.getElementById('cartFeedback');
    const button = document.getElementById('detailAddCartBtn');
    if (feedback) {
      feedback.textContent = message;
      feedback.classList.add('show');
      clearTimeout(showCartFeedback.timer);
      showCartFeedback.timer = setTimeout(function () {
        feedback.classList.remove('show');
      }, 3600);
    }

    if (button && options.success !== false) {
      const original = button.dataset.originalText || button.textContent || 'Sepete Ekle';
      button.dataset.originalText = original;
      button.textContent = 'Sepete Eklendi';
      clearTimeout(showCartFeedback.buttonTimer);
      showCartFeedback.buttonTimer = setTimeout(function () {
        button.textContent = original;
      }, 1800);
    }
  }

  function matchingVariant(product) {
    const variants = Array.isArray(product && product.variants) ? product.variants : [];
    const selectedColor = normalizeColor(currentProduct.selectedColor);
    const selectedSize = String(currentProduct.selectedSize || '').trim().toLocaleLowerCase('tr-TR');
    return variants.find(function (variant) {
      const colorMatches = !selectedColor || normalizeColor(variant.color) === selectedColor;
      const sizeMatches = !selectedSize || String(variant.size || '').trim().toLocaleLowerCase('tr-TR') === selectedSize;
      return colorMatches && sizeMatches;
    }) || null;
  }

  async function latestAvailability() {
    if (!window.SuveraAPI || !window.SuveraAPI.products || !currentProduct.id) {
      return { ok: true, variant: null };
    }
    const latest = await window.SuveraAPI.products.get(currentProduct.id, { cache: 'no-store' });
    const variant = matchingVariant(latest);
    const stock = variant ? Number(variant.stock || 0) : Number(latest.stock || 0);
    return {
      ok: stock > 0 && latest.status === 'active' && (!variant || variant.status === 'active'),
      stock,
      variant,
    };
  }

  async function addCurrentProductToCart() {
    if (!window.Suvera || !currentProduct.id) return false;

    let availability;
    try {
      availability = await latestAvailability();
    } catch (_) {
      availability = { ok: true, variant: null };
    }

    if (!availability.ok) {
      const message = 'Bu secenek icin stok su anda tukendi. Lutfen farkli beden/renk deneyin.';
      showCartFeedback(message, { success: false });
      if (window.showToast) window.showToast(message, 'dark');
      return false;
    }

    const variant = availability.variant;
    window.Suvera.addToCart(currentProduct.name, currentProduct.price, currentProduct.emoji, {
      id: currentProduct.id,
      product_id: currentProduct.id,
      variant_id: variant ? variant.id : null,
      image: currentProduct.image,
      color: currentProduct.selectedColor,
      size: currentProduct.selectedSize,
      variant: [colorMeta(currentProduct.selectedColor).label, currentProduct.selectedSize].filter(Boolean).join(' / '),
    });

    showCartFeedback('Ürün sepetinize eklenmiştir. Sepetten devam edebilir ya da Satın Al ile ödeme adımına geçebilirsiniz.');
    if (window.showToast) {
      window.showToast('Ürün sepetinize eklenmiştir', 'green');
    }
    return true;
  }

  async function loadRelated(product) {
    if (!window.SuveraAPI) return;

    try {
      const params = product.category_id ? '?category_id=' + product.category_id + '&status=active&limit=8' : '?status=active&limit=8';
      const items = await window.SuveraAPI.products.list(params);
      const related = (items || [])
        .filter(function (item) { return String(item.id) !== String(product.id); })
        .slice(0, 4);
      renderRelated(related);
    } catch (err) {
      renderRelated([]);
    }
  }

  function bindWishlist() {
    const button = document.getElementById('favToggle');
    if (!button) return;

    button.addEventListener('click', function () {
      if (!window.Suvera || !window.Suvera.toggleFavorite) return;
      const result = window.Suvera.toggleFavorite({
        id: currentProduct.id,
        name: currentProduct.name,
        price: currentProduct.price,
        image: currentProduct.image,
        emoji: currentProduct.emoji,
        url: currentProduct.id ? ('urun?id=' + encodeURIComponent(currentProduct.id)) : 'urun',
      });
      if (window.showToast) {
        window.showToast(
          result.active ? 'Favorilere eklendi' : 'Favorilerden kaldirildi',
          result.active ? 'green' : 'dark'
        );
      }
    });
  }

  async function loadProduct() {
    bindWishlist();

    if (!window.SuveraAPI) return;
    const params = new URLSearchParams(location.search);
    let id = params.get('id');

    try {
      if (!id) {
        const items = await window.SuveraAPI.products.list('?status=active&limit=24');
        if (!items || !items.length) throw new Error('Suvera urunleri hazirlaniyor.');
        id = items[0].id;
        params.set('id', id);
        history.replaceState({}, '', 'urun?' + params.toString());
      }
      const product = await window.SuveraAPI.products.get(id);
      renderInfo(product);
      renderSwatches(product);
      renderGallery(product, currentProduct.selectedColor);
      renderSizes(product);
      loadRelated(product);
    } catch (err) {
      document.getElementById('detailProductTitle').textContent = 'Ürün yüklenemedi';
      document.getElementById('detailShortDesc').textContent = err.message || 'Ürün bilgisi alınamadı.';
    }
  }

  window.addToCart = function () {
    addCurrentProductToCart();
  };

  window.buyNow = async function () {
    if (await addCurrentProductToCart()) {
      window.location.href = 'siparis';
    }
  };

  document.addEventListener('click', function (event) {
    const waBtn = event.target.closest('.wa-btn');
    if (!waBtn) return;
    const text = encodeURIComponent('Merhaba, ' + currentProduct.name + ' ürünü hakkında bilgi almak istiyorum.');
    window.open('https://wa.me/905555555555?text=' + text, '_blank');
  });

  document.addEventListener('DOMContentLoaded', function () {
    bindImageLightbox();
    loadProduct();
  });
})();
