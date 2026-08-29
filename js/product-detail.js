import {
  defaultProductColor,
  escapeHtml,
  explicitMeasurementLines,
  formatMoney as money,
  normalizeColor,
  productColorOptions,
  productGalleryEntries,
  productImageEntries,
  productSizeLabels,
  colorMeta as sharedColorMeta,
  resolveAssetUrl as imageUrl,
} from './core/storefront-utils.js';
const colorMeta = (value) => sharedColorMeta(value, '#e9dfd0');
﻿(function () {
  'use strict';

  let currentProduct = {
    id: null,
    name: 'Ürün',
    price: 0,
    emoji: '',
    image: '',
    selectedColor: '',
    selectedSize: '',
    images: [],
    imageEntries: [],
    categoryId: null,
    variants: [],
    stock: 0,
    status: 'draft',
  };
  let activeImageIndex = 0;
  let addingToCart = false;

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

  function articleLines(text) {
    return text
      .split('\n')
      .map(function (line) { return line.trim(); })
      .filter(Boolean)
      .slice(0, 4);
  }

  function imageMarkup(src, alt, fallbackClass, options) {
    const settings = options || {};
    const responsive = src && window.SuveraAPI.responsiveImage
      ? window.SuveraAPI.responsiveImage(src, settings.purpose || 'detail')
      : { src: src, srcset: '', sizes: '' };
    const responsiveAttrs = responsive.srcset
      ? ' srcset="' + escapeHtml(responsive.srcset) + '" sizes="' + escapeHtml(responsive.sizes) + '"'
      : '';
    return src
      ? '<img src="' + escapeHtml(responsive.src) + '"' + responsiveAttrs + ' alt="' + escapeHtml(alt) + '" loading="' + (settings.priority ? 'eager' : 'lazy') + '"' + (settings.priority ? ' fetchpriority="high"' : '') + ' decoding="async"/>'
      : '<div class="' + fallbackClass + '"><span class="product-media-placeholder" aria-hidden="true"></span></div>';
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
    const prevButton = document.getElementById('imageLightboxPrev');
    const nextButton = document.getElementById('imageLightboxNext');
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
    if (zoomButton) {
      (zoomButton.querySelector('[aria-hidden="true"]') || zoomButton).textContent = '⌕';
      zoomButton.setAttribute('aria-label', 'Görseli yakınlaştır');
      zoomButton.setAttribute('aria-pressed', 'false');
    }
    if (count) {
      count.textContent = (index + 1) + ' / ' + Math.max(currentProduct.images.length, 1);
    }
    const hasMultipleImages = currentProduct.images.length > 1;
    if (prevButton) prevButton.hidden = !hasMultipleImages;
    if (nextButton) nextButton.hidden = !hasMultipleImages;
    lightbox.classList.add('open');
    requestAnimationFrame(function () {
      resetLightboxView(stage);
    });
    // A31: focus trap, Escape, scroll lock and focus restore come from the shared dialog
    // primitive (js/a11y.js) instead of a second hand-rolled implementation per overlay.
    document.documentElement.style.overflow = 'hidden';
    window.SuveraA11y?.openDialog(lightbox, {
      initialFocus: '#imageLightboxClose',
      onClose: closeImageLightbox,
    });
  }

  function closeImageLightbox() {
    const lightbox = document.getElementById('imageLightbox');
    const stage = document.getElementById('imageLightboxStage');
    const img = document.getElementById('imageLightboxImg');
    if (!lightbox) return;

    // Reached both directly and as the primitive's onClose, so it must be idempotent.
    if (window.SuveraA11y?.isOpen(lightbox)) {
      window.SuveraA11y.closeDialog(lightbox);
      return;
    }
    lightbox.classList.remove('open');
    lightbox.classList.remove('zoomed');
    if (stage) {
      resetLightboxView(stage);
    }
    if (img) img.removeAttribute('src');
    document.documentElement.style.overflow = '';
  }

  function setActiveThumb(index) {
    activeImageIndex = index;
    const thumbs = document.querySelectorAll('.thumb-btn');
    thumbs.forEach(function (thumb, i) {
      thumb.classList.toggle('active', i === index);
      thumb.setAttribute('aria-pressed', i === index ? 'true' : 'false');
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
      mainMedia.innerHTML = imageMarkup(media, currentProduct.name, 'main-fallback', { priority: true, purpose: 'detail' });
      mainMedia.setAttribute('aria-label', currentProduct.name + ' büyük görselini aç');
      mainMedia.onclick = function () {
        openImageLightbox(activeImageIndex);
      };
      mainMedia.onkeydown = function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openImageLightbox(activeImageIndex);
      };
    }
    if (counter) {
      counter.textContent = (index + 1) + ' / ' + Math.max(currentProduct.images.length, 1);
    }
  }

  function renderGallery(product, color) {
    currentProduct.imageEntries = productImageEntries(product);
    const images = productGalleryEntries(product, color).map(function (entry) {
      return imageUrl(entry.url);
    });

    currentProduct.images = images;
    currentProduct.image = images[0] || '';

    const thumbs = document.getElementById('detailThumbs');
    if (!thumbs) return;

    if (!images.length) {
      thumbs.innerHTML = '<button class="thumb-btn active" type="button" aria-label="' + escapeHtml(product.name || 'Ürün') + ' görseli" aria-pressed="true"><div class="thumb-fallback" aria-hidden="true"><span class="product-media-placeholder"></span></div></button>';
      setActiveThumb(0);
      return;
    }

    thumbs.innerHTML = images.map(function (src, index) {
      return '<button class="thumb-btn' + (index === 0 ? ' active' : '') + '" type="button" data-index="' + index + '" aria-label="' + escapeHtml(product.name || 'Ürün') + ' görsel ' + (index + 1) + '" aria-pressed="' + (index === 0 ? 'true' : 'false') + '">' +
        imageMarkup(src, product.name + ' görsel ' + (index + 1), 'thumb-fallback', { purpose: 'thumbnail' }) +
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
    const colorOptions = productColorOptions(product);
    currentProduct.selectedColor = defaultProductColor(product);

    const wrap = document.getElementById('detailColors');
    const label = document.getElementById('detailColorLabel');
    if (!wrap) return;

    wrap.innerHTML = colorOptions.map(function (option) {
      const color = option.value;
      const meta = colorMeta(color);
      const selected = color === currentProduct.selectedColor;
      return '<button class="swatch' + (selected ? ' active' : '') + '" type="button" data-css="background:' + escapeHtml(meta.css) + '" data-color="' + escapeHtml(color) + '" aria-label="' + escapeHtml(meta.label) + ' rengi' + (option.inStock ? '' : ', stokta yok') + '" aria-pressed="' + (selected ? 'true' : 'false') + '"></button>';
    }).join('');

    if (label) label.textContent = colorMeta(currentProduct.selectedColor).label;

    wrap.querySelectorAll('.swatch').forEach(function (button) {
      button.addEventListener('click', function () {
        wrap.querySelectorAll('.swatch').forEach(function (item) { item.classList.remove('active'); item.setAttribute('aria-pressed', 'false'); });
        button.classList.add('active');
        button.setAttribute('aria-pressed', 'true');
        currentProduct.selectedColor = button.dataset.color || '';
        if (label) label.textContent = colorMeta(currentProduct.selectedColor).label;
        renderGallery(product, currentProduct.selectedColor);
        renderSizes(product);
        updateStockDisplay();
      });
    });
  }

  function variantsForSelectedColor(product) {
    const variants = Array.isArray(product && product.variants) ? product.variants : [];
    const selectedColor = normalizeColor(currentProduct.selectedColor);
    return selectedColor
      ? variants.filter(function (variant) { return normalizeColor(variant.color) === selectedColor; })
      : variants;
  }

  function variantForSelection(product) {
    const variants = Array.isArray(product && product.variants) ? product.variants : [];
    const selectedColor = normalizeColor(currentProduct.selectedColor);
    const selectedSize = String(currentProduct.selectedSize || '').trim().toLocaleLowerCase('tr-TR');
    return variants.find(function (variant) {
      const colorMatches = !selectedColor || normalizeColor(variant.color) === selectedColor;
      const sizeMatches = !selectedSize || String(variant.size || '').trim().toLocaleLowerCase('tr-TR') === selectedSize;
      return colorMatches && sizeMatches;
    }) || null;
  }

  function optionInStock(option) {
    return Number(option && option.stock || 0) > 0 && (option.status || 'active') === 'active';
  }

  function updateStockDisplay() {
    const variant = variantForSelection(currentProduct);
    const stock = variant ? Number(variant.stock || 0) : Number(currentProduct.stock || 0);
    const active = currentProduct.status === 'active' && (!variant || optionInStock(variant));
    const stockText = document.getElementById('detailStockText');
    const stockBadge = document.getElementById('stockBadge');
    const addButton = document.getElementById('detailAddCartBtn');
    const buyButton = document.querySelector('.buy-btn.secondary');

    if (stockText) {
      stockText.innerHTML = '<strong>Stok durumu</strong> ' + (active && stock > 0 ? stock + ' adet hazır' : 'Tükendi');
    }
    if (stockBadge) {
      stockBadge.textContent = active && stock > 0 ? 'Stokta' : 'Tükendi';
    }
    if (addButton) {
      addButton.disabled = addingToCart || !(active && stock > 0);
      addButton.setAttribute('aria-busy', addingToCart ? 'true' : 'false');
    }
    if (buyButton) {
      buyButton.disabled = addingToCart || !(active && stock > 0);
      buyButton.setAttribute('aria-busy', addingToCart ? 'true' : 'false');
    }
    // A23: broadcast the current variant + availability so the notifications UI can
    // offer a back-in-stock alert on the exact selection without coupling to internals.
    window.dispatchEvent(new CustomEvent('suvera:availability', {
      detail: {
        productId: currentProduct && currentProduct.id != null ? Number(currentProduct.id) : null,
        variantId: variant && variant.id != null ? Number(variant.id) : null,
        inStock: Boolean(active && stock > 0),
      },
    }));
  }

  function renderSizes(product) {
    const variantOptions = variantsForSelectedColor(product);
    const sizes = variantOptions.length
      ? [...new Set(variantOptions.map(function (variant) { return String(variant.size || '').trim(); }).filter(Boolean))]
      : (Array.isArray(product.sizes) && product.sizes.length ? product.sizes : ['Standart']);
    const selectedVariant = variantOptions.find(function (variant) {
      return String(variant.size || '').trim() === currentProduct.selectedSize;
    });
    const firstInStock = variantOptions.find(optionInStock);
    currentProduct.selectedSize = sizes.includes(currentProduct.selectedSize) && (!variantOptions.length || optionInStock(selectedVariant))
      ? currentProduct.selectedSize
      : (firstInStock ? String(firstInStock.size || '').trim() : sizes[0]);

    const wrap = document.getElementById('detailSizes');
    const label = document.getElementById('detailSizeLabel');
    if (!wrap) return;

    wrap.innerHTML = sizes.map(function (size, index) {
      const variant = variantOptions.find(function (item) { return String(item.size || '').trim() === String(size); });
      const disabled = variantOptions.length && !optionInStock(variant);
      const selected = size === currentProduct.selectedSize || (!currentProduct.selectedSize && index === 0);
      return '<button class="size-btn' + (selected ? ' active' : '') + '" type="button" data-size="' + escapeHtml(size) + '" aria-label="' + escapeHtml(size) + ' beden' + (disabled ? ', stokta yok' : '') + '" aria-pressed="' + (selected ? 'true' : 'false') + '"' + (disabled ? ' disabled aria-disabled="true"' : '') + '>' + escapeHtml(size) + '</button>';
    }).join('');

    if (label) label.textContent = currentProduct.selectedSize || sizes[0] || '';

    wrap.querySelectorAll('.size-btn').forEach(function (button) {
      button.addEventListener('click', function () {
        if (button.disabled) {
          showCartFeedback('Bu beden bu renk icin stokta yok. Lutfen farkli beden/renk deneyin.', { success: false });
          return;
        }
        wrap.querySelectorAll('.size-btn').forEach(function (item) { item.classList.remove('active'); item.setAttribute('aria-pressed', 'false'); });
        button.classList.add('active');
        button.setAttribute('aria-pressed', 'true');
        currentProduct.selectedSize = button.dataset.size || '';
        if (label) label.textContent = currentProduct.selectedSize;
        updateStockDisplay();
      });
    });
    updateStockDisplay();
  }

  function renderInfo(product) {
    const finalPrice = Number(product.sale_price || product.price || 0);
    const oldPrice = product.sale_price ? Number(product.price || 0) : 0;
    const text = plainDescription(product.description);
    const story = articleLines(text);
    const details = product.details && typeof product.details === 'object' ? product.details : {};
    const storyText = (product.product_story && product.product_story.trim())
      || details.story || story.join(' ') || 'Bu ürün, sade çizgiyi yumuşak kumaş hissiyle bir araya getirir.';
    const shortText = details.short_description || story[0] || 'Rahat kalıp, dengeli duruş ve sezon boyunca sık kullanılacak bir parça.';
    const deliveryText = details.delivery_note || 'Siparişler 1-3 iş günü içinde hazırlanır. Kargo çıktığında takip numarası hesabınıza ve sipariş ekranına işlenir.\nKullanılmamış ürünlerde değişim ve iade desteği için bizimle iletişime geçebilirsiniz.';
    const measurementData = explicitMeasurementLines(product);
    const sizeLabels = productSizeLabels(product);
    const sizeSummary = sizeLabels.length ? 'Mevcut bedenler: ' + sizeLabels.join(', ') + '.' : 'Ölçü bilgisi paylaşılmadı.';
    const stock = Number(product.stock || 0);

    currentProduct.id = product.id;
    currentProduct.name = product.name || 'Ürün';
    currentProduct.price = finalPrice;
    currentProduct.emoji = '';
    currentProduct.categoryId = product.category_id || null;
    currentProduct.variants = Array.isArray(product.variants) ? product.variants : [];
    currentProduct.stock = stock;
    currentProduct.status = product.status || 'draft';

    document.title = currentProduct.name + ' – Suvera';
    document.getElementById('detailProductTitle').textContent = currentProduct.name;
    document.getElementById('detailCategory').textContent = product.category_name || 'Suvera Seçkisi';
    document.getElementById('detailPriceNew').textContent = money(finalPrice);
    document.getElementById('detailPriceNew').setAttribute('aria-label', 'Güncel fiyat ' + money(finalPrice));
    document.getElementById('detailPriceNew').classList.toggle('price-sale', !!product.sale_price);
    document.getElementById('detailSku').textContent = 'SKU: MV-' + String(product.id || 0).padStart(5, '0');

    const oldPriceNode = document.getElementById('detailPriceOld');
    oldPriceNode.style.display = oldPrice ? '' : 'none';
    oldPriceNode.textContent = oldPrice ? money(oldPrice) : '';
    oldPriceNode.setAttribute('aria-label', oldPrice ? 'Eski fiyat ' + money(oldPrice) : '');

    updateStockDisplay();

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

    document.getElementById('detailMeasurementBody').innerHTML = measurementData.length
      ? '<table>' + measurementData.map(function (line) { return '<tr><td>' + escapeHtml(line) + '</td></tr>'; }).join('') + '</table>'
      : '<p>' + escapeHtml(sizeSummary) + '</p>';

    document.getElementById('detailStoryCopy').textContent = storyText;

    const measureList = document.getElementById('detailMeasureList');
    measureList.innerHTML = measurementData.slice(0, 5).map(function (line, index) {
      return '<div class="measure-row"><span>Detay ' + (index + 1) + '</span><strong>' + escapeHtml(line) + '</strong></div>';
    }).join('') || '<div class="measure-row"><span>Bedenler</span><strong>' + escapeHtml(sizeLabels.join(', ') || 'Ölçü bilgisi paylaşılmadı') + '</strong></div>';

    const deliveryBodies = document.querySelectorAll('.info-body');
    if (deliveryBodies[2]) {
      deliveryBodies[2].innerHTML = deliveryText.split('\n').filter(Boolean).map(function (line) {
        return '<p>' + escapeHtml(line.trim()) + '</p>';
      }).join('');
    }

    const breadcrumb = document.getElementById('productBreadcrumb');
    breadcrumb.innerHTML = '<ol><li><a href="anasayfa">Ana Sayfa</a></li><li><a href="urunler">Ürünler</a></li><li><a href="urunler">' +
      escapeHtml(product.category_name || 'Kategori') + '</a></li><li aria-current="page">' + escapeHtml(currentProduct.name) + '</li></ol>';

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
    const prevButton = document.getElementById('imageLightboxPrev');
    const nextButton = document.getElementById('imageLightboxNext');
    const stage = document.getElementById('imageLightboxStage');
    if (!lightbox) return;

    if (closeButton) {
      closeButton.addEventListener('click', closeImageLightbox);
    }
    if (zoomButton) {
      zoomButton.addEventListener('click', function (event) {
        event.stopPropagation();
        const zoomed = lightbox.classList.toggle('zoomed');
        // The glyph lives in an aria-hidden span, so the icon is swapped there and the
        // accessible name is updated separately rather than being overwritten by it.
        const glyph = zoomButton.querySelector('[aria-hidden="true"]') || zoomButton;
        glyph.textContent = zoomed ? '−' : '⌕';
        zoomButton.setAttribute('aria-label', zoomed ? 'Görseli uzaklaştır' : 'Görseli yakınlaştır');
        zoomButton.setAttribute('aria-pressed', zoomed ? 'true' : 'false');
        resetLightboxView(stage);
        requestAnimationFrame(function () {
          resetLightboxView(stage);
        });
      });
    }
    if (prevButton) {
      prevButton.addEventListener('click', function (event) {
        event.stopPropagation();
        stepLightbox(-1);
      });
    }
    if (nextButton) {
      nextButton.addEventListener('click', function (event) {
        event.stopPropagation();
        stepLightbox(1);
      });
    }
    lightbox.addEventListener('click', function (event) {
      if (event.target === lightbox) closeImageLightbox();
    });
    if (stage) {
      stage.addEventListener('click', function (event) {
        if (event.target === stage) closeImageLightbox();
      });
      window.Suvera?.bindHorizontalSwipe(stage, function (step) {
        if (!lightbox.classList.contains('zoomed')) stepLightbox(step);
      });
    }
    // Escape is handled by the shared dialog primitive. Arrow keys move between images:
    // the thumbnails are behind the modal and inert while it is open, so without this a
    // keyboard user could only ever see the one image they opened.
    lightbox.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      stepLightbox(event.key === 'ArrowRight' ? 1 : -1);
    });
  }

  function bindMainGallerySwipe() {
    const mainMedia = document.getElementById('detailMainMedia');
    if (!mainMedia) return;
    window.Suvera?.bindHorizontalSwipe(mainMedia, function (step) {
      const images = Array.isArray(currentProduct.images) ? currentProduct.images : [];
      if (images.length < 2) return;
      setActiveThumb((activeImageIndex + step + images.length) % images.length);
    });
  }

  function stepLightbox(step) {
    const images = Array.isArray(currentProduct.images) ? currentProduct.images : [];
    if (images.length < 2) return;
    const next = (activeImageIndex + step + images.length) % images.length;
    setActiveThumb(next);
    showLightboxImage(next);
  }

  // Swaps the visible image without reopening the dialog, so focus and the trap survive.
  function showLightboxImage(index) {
    const images = Array.isArray(currentProduct.images) ? currentProduct.images : [];
    const src = images[index];
    if (!src) return;
    const lightbox = document.getElementById('imageLightbox');
    const stage = document.getElementById('imageLightboxStage');
    const img = document.getElementById('imageLightboxImg');
    const count = document.getElementById('imageLightboxCount');
    if (!lightbox || !img) return;
    img.src = src;
    img.alt = (currentProduct.name || 'Suvera ürün görseli') + ' — görsel ' + (index + 1);
    lightbox.classList.remove('zoomed');
    if (stage) resetLightboxView(stage);
    if (count) count.textContent = (index + 1) + ' / ' + Math.max(images.length, 1);
  }

  function relatedCardMarkup(product) {
    const price = Number(product.sale_price || product.price || 0);
    const firstImage = productImageEntries(product)[0];
    const src = firstImage ? imageUrl(firstImage.url) : '';
    // FIX: Encode product ids before inserting them into inline navigation handlers.
    return '<article class="related-card" data-nav="urun?id=' + encodeURIComponent(product.id) + '">' +
      '<div class="related-media">' + imageMarkup(src, product.name, 'related-fallback', { purpose: 'card' }) + '</div>' +
      '<div class="related-info"><p>' + escapeHtml(product.category_name || 'Seçki') + '</p><h3>' + escapeHtml(product.name) + '</h3><div class="related-price">' + money(price) + '</div></div>' +
    '</article>';
  }

  function renderRelated(products) {
    const wrap = document.getElementById('relatedProducts');
    if (!wrap) return;
    if (!products.length) {
      wrap.innerHTML = '<div class="empty-state">Benzer ürünler bu kategoriye ürün eklendikçe burada görünür.</div>';
      return;
    }
    wrap.innerHTML = products.map(relatedCardMarkup).join('');
  }

  // A24.2 complementary strip: hidden entirely when the API returns no complementary
  // products (curated by the admin, else a deterministic same-category fallback).
  function renderComplementary(products) {
    const wrap = document.getElementById('complementaryProducts');
    if (!wrap) return;
    const section = wrap.closest('.related-section');
    if (!products.length) { if (section) section.hidden = true; return; }
    if (section) section.hidden = false;
    wrap.innerHTML = products.map(relatedCardMarkup).join('');
  }

  function showCartFeedback(message, options = {}) {
    const feedback = document.getElementById('cartFeedback');
    const button = document.getElementById('detailAddCartBtn');
    if (feedback) {
      feedback.textContent = message;
      feedback.classList.add('show');
      feedback.setAttribute('role', options.success === false ? 'alert' : 'status');
      feedback.setAttribute('aria-live', options.success === false ? 'assertive' : 'polite');
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

  function validateVariantSelection() {
    const colorButtons = Array.from(document.querySelectorAll('#detailColors .swatch:not([disabled])'));
    const sizeButtons = Array.from(document.querySelectorAll('#detailSizes .size-btn:not([disabled])'));
    if (colorButtons.length && !currentProduct.selectedColor) {
      showCartFeedback('Sepete eklemeden önce bir renk seçin.', { success: false });
      colorButtons[0].focus();
      return false;
    }
    if (sizeButtons.length && !currentProduct.selectedSize) {
      showCartFeedback('Sepete eklemeden önce bir beden seçin.', { success: false });
      sizeButtons[0].focus();
      return false;
    }
    return true;
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
    if (!window.Suvera || !currentProduct.id || addingToCart || !validateVariantSelection()) return false;
    addingToCart = true;
    updateStockDisplay();

    try {
      let availability;
      try {
        availability = await latestAvailability();
      } catch (_) {
        availability = { ok: true, variant: null };
      }

      if (!availability.ok) {
        const message = 'Bu seçenek için stok şu anda tükendi. Lütfen farklı beden veya renk deneyin.';
        showCartFeedback(message, { success: false });
        if (window.showToast) window.showToast(message, 'dark');
        return false;
      }

      const variant = availability.variant;
      await window.Suvera.addToCart(currentProduct.name, currentProduct.price, currentProduct.emoji, {
        id: currentProduct.id,
        product_id: currentProduct.id,
        variant_id: variant ? variant.id : null,
        image: currentProduct.image,
        color: currentProduct.selectedColor,
        size: currentProduct.selectedSize,
        variant: [colorMeta(currentProduct.selectedColor).label, currentProduct.selectedSize].filter(Boolean).join(' / '),
      });

      showCartFeedback('Ürün sepetinize eklenmiştir. Sepetten devam edebilir ya da Satın Al ile ödeme adımına geçebilirsiniz.');
      if (window.showToast) window.showToast('Ürün sepetinize eklenmiştir', 'green');
      return true;
    } finally {
      addingToCart = false;
      updateStockDisplay();
    }
  }

  async function loadRelatedLegacy(product) {
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

  async function loadRelated(product) {
    if (!window.SuveraAPI) return;
    const hasRelatedApi = Boolean(window.SuveraAPI.catalog && window.SuveraAPI.catalog.related);

    // A24.2: server-backed curated related products (admin manual selection) with a
    // deterministic same-category/collection fallback in the API. Legacy client-side
    // category lookup only if the endpoint is unavailable or errors.
    try {
      if (hasRelatedApi) {
        const data = await window.SuveraAPI.catalog.related(product.id, 'related', 8);
        const items = (data && data.items) || [];
        if (items.length) renderRelated(items.slice(0, 8));
        else await loadRelatedLegacy(product);
      } else {
        await loadRelatedLegacy(product);
      }
    } catch (_) {
      await loadRelatedLegacy(product);
    }

    try {
      const data = hasRelatedApi ? await window.SuveraAPI.catalog.related(product.id, 'complementary', 8) : null;
      renderComplementary(((data && data.items) || []).slice(0, 8));
    } catch (_) {
      renderComplementary([]);
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
    bindMainGallerySwipe();
    loadProduct();
  });
})();
