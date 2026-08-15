export function formatMoney(value) {
  return Number(value || 0).toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' TL';
}

export function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, function (char) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
  });
}

export function safeHref(value, fallback = 'urunler') {
  const href = String(value || '').trim();
  if (!href) return fallback;
  try {
    const parsed = new URL(href, location.href);
    if (['http:', 'https:'].includes(parsed.protocol)) return href;
  } catch (_) {}
  if (/^(\/|\.\/|\.\.\/|#|[a-z0-9_-]+(?:\.html)?(?:[?#].*)?)/i.test(href)) return href;
  return fallback;
}

export function safeHttpUrl(
  value,
  base = typeof location !== 'undefined' ? location.href : 'http://localhost/'
) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, base);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch (_) {
    return '';
  }
}

export function parseImageEntry(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parts = raw.split('|').map(function (part) { return part.trim(); }).filter(Boolean);
  if (parts.length >= 2) return { color: parts[0], url: parts[parts.length - 1] };
  return { color: '', url: raw };
}

export function productImageEntries(product) {
  return (Array.isArray(product && product.images) ? product.images : [])
    .map(parseImageEntry)
    .filter(function (entry) { return entry && entry.url; });
}

export function productGalleryEntries(product, color) {
  const entries = productImageEntries(product);
  const selected = normalizeColor(color);
  if (!selected) return entries;

  const selectedColorEntries = entries.filter(function (entry) {
    return normalizeColor(entry.color) === selected;
  });
  const generalEntries = entries.filter(function (entry) {
    return !normalizeColor(entry.color);
  });
  const selectedEntries = selectedColorEntries.length || generalEntries.length
    ? [...selectedColorEntries, ...generalEntries]
    : entries;
  const seen = new Set();
  return selectedEntries.filter(function (entry) {
    if (seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  });
}

export function productColorOptions(product) {
  const colors = Array.isArray(product && product.colors) && product.colors.length
    ? product.colors
    : ['#e9dfd0'];
  const variants = Array.isArray(product && product.variants) ? product.variants : [];
  return colors.map(function (color) {
    const selected = normalizeColor(color);
    const matches = variants.filter(function (variant) {
      return normalizeColor(variant.color) === selected;
    });
    const inStock = !matches.length || matches.some(function (variant) {
      return Number(variant.stock || 0) > 0 && (variant.status || 'active') === 'active';
    });
    return { value: color, inStock, selectable: true };
  });
}

export function defaultProductColor(product) {
  const options = productColorOptions(product);
  const firstBoundImage = productImageEntries(product).find(function (entry) {
    return normalizeColor(entry.color);
  });
  if (firstBoundImage) {
    const selected = normalizeColor(firstBoundImage.color);
    const matchingOption = options.find(function (option) {
      return normalizeColor(option.value) === selected;
    });
    if (matchingOption) return matchingOption.value;
  }
  const available = options.find(function (option) { return option.inStock; });
  return (available || options[0] || {}).value || '';
}

export function explicitMeasurementLines(product) {
  const details = product && product.details && typeof product.details === 'object'
    ? product.details
    : {};
  return String(details.measurements || '')
    .split('\n')
    .map(function (line) { return line.trim(); })
    .filter(Boolean);
}

export function productSizeLabels(product) {
  const declared = Array.isArray(product && product.sizes) ? product.sizes : [];
  const variants = Array.isArray(product && product.variants) ? product.variants : [];
  const source = declared.length ? declared : variants.map(function (variant) { return variant.size; });
  return [...new Set(source.map(function (size) { return String(size || '').trim(); }).filter(Boolean))];
}

export function productFinalPrice(product) {
  return Number(product && (product.sale_price || product.price) || 0);
}

export function normalizeColor(value) {
  return String(value || '').trim().toLocaleLowerCase('tr-TR');
}

export function colorMeta(value, fallback = '#d8d3c8') {
  const raw = String(value || '').trim();
  const parts = raw.split('|').map(function (part) { return part.trim(); }).filter(Boolean);
  const hexMatch = raw.match(/#(?:[0-9a-f]{3}){1,2}\b/i);
  const label = parts.length >= 2 ? parts[0] : raw.replace(/#(?:[0-9a-f]{3}){1,2}\b/i, '').replace(/[()]/g, '').trim();
  const css = parts.length >= 2 ? parts[parts.length - 1] : (hexMatch ? hexMatch[0] : raw);
  return { label: label || css, css: css || fallback, value: raw };
}

export function resolveAssetUrl(value) {
  return window.SuveraAPI && window.SuveraAPI.assetUrl ? window.SuveraAPI.assetUrl(value) : String(value || '');
}
