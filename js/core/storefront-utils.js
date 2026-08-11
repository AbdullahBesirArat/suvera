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
