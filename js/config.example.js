// Copy this file to config.js in the Suvera storefront deployment.
// In production the storefront keeps API traffic on same-origin /api via the local proxy route.
//
// COK MAGAZA: Her magaza deploy'u kendi degerlerini set eder. Ornek:
//   magaza-2 deploy'u:  window.SUVERA_ORGANIZATION_SLUG = 'magaza-2';
//                       window.SUVERA_STORE_DOMAIN = 'magaza2.com.tr';
// Asagidaki `|| 'suvera'` fallback'i sayesinde set edilmezse mevcut Suvera calismaya devam eder.
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
