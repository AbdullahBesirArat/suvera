const loadProductExtras = () => Promise.all([
  import('./recently-viewed.js'),
  import('./comparison.js'),
]);

if ('requestIdleCallback' in window) {
  window.requestIdleCallback(loadProductExtras, { timeout: 1200 });
} else {
  window.setTimeout(loadProductExtras, 1);
}
