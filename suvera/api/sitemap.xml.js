const UPSTREAM_API = process.env.UPSTREAM_API || 'https://panelya-api-production.up.railway.app/api';
const PUBLIC_ACCESS_TOKEN = process.env.SUVERA_PUBLIC_ACCESS_TOKEN || '';
const SITE_ORIGIN = (process.env.SUVERA_SITE_ORIGIN || 'https://suvera.com.tr').replace(/\/$/, '');
const ORGANIZATION_SLUG = process.env.SUVERA_ORGANIZATION_SLUG || 'suvera';

const STATIC_PATHS = [
  'anasayfa',
  'urunler',
  'sepet',
  'siparis',
  'giris',
  'tesekkur',
  'hesabim',
  'favoriler',
  'sifre-sifirla',
  'siparis-takip',
  'kvkk',
  'sozlesme',
  'uyelik-sozlesmesi',
  'kargo',
  'iade',
  'hakkimizda',
  'iletisim',
  'arama',
  'blog',
];

function escapeXml(value) {
  return String(value || '').replace(/[<>&'"]/g, (char) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  })[char]);
}

async function api(path) {
  const url = new URL(`${UPSTREAM_API.replace(/\/$/, '')}${path}`);
  url.searchParams.set('organizationSlug', ORGANIZATION_SLUG);
  const headers = {};
  if (PUBLIC_ACCESS_TOKEN) headers['x-public-access-token'] = PUBLIC_ACCESS_TOKEN;
  const response = await fetch(url, { headers });
  if (!response.ok) return [];
  return response.json().catch(() => []);
}

function urlEntry(loc, priority = '0.7') {
  return `  <url><loc>${escapeXml(loc)}</loc><priority>${priority}</priority></url>`;
}

module.exports = async function handler(_req, res) {
  const urls = new Set(STATIC_PATHS.map((path) => `${SITE_ORIGIN}/${path}`));

  const [products, categories, blogPosts] = await Promise.all([
    api('/products?status=active&limit=200'),
    api('/categories'),
    api('/blog'),
  ]);

  (products || []).forEach((product) => {
    if (product && product.id) urls.add(`${SITE_ORIGIN}/urun?id=${encodeURIComponent(product.id)}`);
  });
  (categories || []).forEach((category) => {
    if (category && category.id) urls.add(`${SITE_ORIGIN}/urunler?category_id=${encodeURIComponent(category.id)}`);
  });
  (blogPosts || []).forEach((post) => {
    const idOrSlug = post.slug || post.id;
    if (idOrSlug) urls.add(`${SITE_ORIGIN}/blog-detay?id=${encodeURIComponent(idOrSlug)}`);
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...Array.from(urls).map((loc) => urlEntry(loc, loc === `${SITE_ORIGIN}/anasayfa` ? '1.0' : '0.7')),
    '</urlset>',
    '',
  ].join('\n');

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.statusCode = 200;
  res.end(xml);
};
