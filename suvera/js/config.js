// Magaza bazli override: her storefront deploy'u kendi degerini onceden set edebilir
// (or. <script>window.SUVERA_ORGANIZATION_SLUG='magaza-2'</script> veya build-time inject).
// Set edilmezse mevcut 'suvera' davranisi korunur (geriye donuk uyumlu).
window.SUVERA_ORGANIZATION_SLUG = window.SUVERA_ORGANIZATION_SLUG || 'suvera';
window.SUVERA_STORE_DOMAIN = window.SUVERA_STORE_DOMAIN || '';
window.SUVERA_PUBLIC_ACCESS_TOKEN = window.SUVERA_PUBLIC_ACCESS_TOKEN || '';
window.SUVERA_SITE_ORIGIN = window.SUVERA_SITE_ORIGIN || location.origin;
window.SUVERA_IBAN_INFO = window.SUVERA_IBAN_INFO || {
  accountName: 'Suvera',
  bankName: '',
  iban: '',
};
window.PANELYA_API_BASE = window.PANELYA_API_BASE || "/api";
window.SUVERA_API_BASE = window.PANELYA_API_BASE;
window.PANELYA_ASSET_BASE = window.PANELYA_ASSET_BASE || "https://panelya-api-production.up.railway.app";
