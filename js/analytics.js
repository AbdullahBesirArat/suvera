const DEFAULT_SAMPLE_RATE = 0.1;
const METRIC_RANGES = Object.freeze({
  LCP: [0, 120000],
  CLS: [0, 10],
  INP: [0, 60000],
  TTFB: [0, 120000],
});
const ROUTES = new Set([
  'anasayfa', 'urunler', 'urun', 'sepet', 'giris', 'siparis', 'sifre-sifirla',
  'siparis-takip', 'tesekkur', 'hakkimizda', 'iade', 'iletisim', 'kargo', 'kvkk',
  'sozlesme', 'uyelik-sozlesmesi', 'favoriler', 'hesabim', 'blog-detay', 'blog',
  'arama', 'dogrula', 'tercihler', 'karsilastir', 'suvera', 'cerez-politikasi',
]);

let analyticsEnabled = false;
let collectionStarted = false;

function sampleRate(value, fallback = DEFAULT_SAMPLE_RATE) {
  const numeric = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric >= 0 && numeric <= 1) return numeric;
  if (numeric > 1 && numeric <= 100) return numeric / 100;
  return fallback;
}

function shouldSample(rate, random = Math.random) {
  const bounded = sampleRate(rate);
  return bounded > 0 && random() < bounded;
}

function normalizeRoute(pathname) {
  const raw = String(pathname || '/').split('?')[0].split('#')[0];
  const first = raw.replace(/^\/+|\/+$/g, '').split('/')[0].replace(/\.html$/i, '');
  if (!first || first === 'index') return '/anasayfa';
  return ROUTES.has(first) ? `/${first}` : '/diger';
}

function normalizeNavigationType(value) {
  return ['navigate', 'reload', 'back_forward', 'prerender'].includes(value) ? value : 'unknown';
}

function safeBuildVersion(value) {
  const build = String(value || 'unknown');
  return /^[a-z0-9._-]{1,32}$/i.test(build) ? build : 'unknown';
}

function metricPayload(name, value, context = {}) {
  const range = METRIC_RANGES[name];
  const numeric = Number(value);
  if (!range || !Number.isFinite(numeric) || numeric < range[0] || numeric > range[1]) return null;
  return {
    name,
    value: Math.round(numeric * 1000) / 1000,
    route: normalizeRoute(context.pathname ?? window.location.pathname),
    navigationType: normalizeNavigationType(context.navigationType),
    build: safeBuildVersion(context.build ?? window.SUVERA_BUILD_VERSION),
  };
}

function navigationType() {
  const entry = performance.getEntriesByType?.('navigation')?.[0];
  return normalizeNavigationType(entry?.type);
}

function sendMetric(name, value) {
  if (!analyticsEnabled) return false;
  const payload = metricPayload(name, value, { navigationType: navigationType() });
  if (!payload) return false;
  const body = JSON.stringify(payload);
  try {
    if (navigator.sendBeacon && navigator.sendBeacon('/api/web-vitals', new Blob([body], { type: 'application/json' }))) {
      return true;
    }
  } catch (_) { /* fall through to keepalive fetch */ }
  try {
    void fetch('/api/web-vitals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      credentials: 'same-origin',
      keepalive: true,
    }).catch(() => undefined);
    return true;
  } catch (_) {
    return false;
  }
}

function observe(type, callback, options = {}) {
  try {
    const observer = new PerformanceObserver((list) => callback(list.getEntries()));
    observer.observe({ type, buffered: true, ...options });
    return observer;
  } catch (_) {
    return null;
  }
}

function startWebVitalsCollection() {
  if (collectionStarted || !shouldSample(window.SUVERA_RUM_SAMPLE_RATE)) return false;
  collectionStarted = true;

  const navigation = performance.getEntriesByType?.('navigation')?.[0];
  if (navigation) sendMetric('TTFB', Math.max(0, navigation.responseStart - navigation.requestStart));

  let lcp = null;
  let cls = 0;
  let inp = null;
  const observers = [
    observe('largest-contentful-paint', (entries) => { lcp = entries.at(-1)?.startTime ?? lcp; }),
    observe('layout-shift', (entries) => {
      for (const entry of entries) if (!entry.hadRecentInput) cls += entry.value;
    }),
    observe('event', (entries) => {
      for (const entry of entries) {
        if (entry.interactionId > 0) inp = Math.max(inp ?? 0, entry.duration);
      }
    }, { durationThreshold: 40 }),
  ].filter(Boolean);

  let finalized = false;
  const finalize = () => {
    if (finalized) return;
    finalized = true;
    if (lcp != null) sendMetric('LCP', lcp);
    sendMetric('CLS', cls);
    if (inp != null) sendMetric('INP', inp);
    observers.forEach((observer) => observer.disconnect());
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') finalize();
  }, { once: true });
  window.addEventListener('pagehide', finalize, { once: true });
  return true;
}

function enableAnalytics() {
  if (analyticsEnabled) return;
  analyticsEnabled = true;
  document.documentElement.dataset.analytics = 'enabled';
  startWebVitalsCollection();
  // Any future third-party provider must remain behind this consent gate.
}

window.SuveraWebVitals = Object.freeze({
  metricPayload,
  normalizeRoute,
  sampleRate,
  shouldSample,
  start: startWebVitalsCollection,
});

window.addEventListener('suvera:consent', (event) => {
  if (event.detail?.analytics) enableAnalytics();
  else {
    analyticsEnabled = false;
    document.documentElement.dataset.analytics = 'disabled';
  }
});

try {
  const saved = JSON.parse(localStorage.getItem('suvera:privacy-consent:v1') || 'null');
  if (saved && saved.version === 1 && saved.analytics === true) enableAnalytics();
} catch (_) {
}
