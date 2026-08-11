'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const budget = JSON.parse(fs.readFileSync(path.join(root, 'performance-budget.json'), 'utf8'));
const featurePages = {
  'js/address-loader.js': new Set(['siparis.html', 'hesabim.html']),
  'js/coupon-ui.js': new Set(['sepet.html', 'siparis.html']),
  'js/recently-viewed.js': new Set(['urun.html', 'giris.html']),
  'js/comparison.js': new Set(['urun.html', 'giris.html', 'karsilastir.html']),
};

function invariant(condition, message) {
  if (!condition) throw new Error(`Performance budget: ${message}`);
}

function scriptSources(html) {
  return [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
    .map((match) => match[1].split(/[?#]/)[0].replace(/^\//, ''));
}

function fileSize(relative) {
  const target = path.join(dist, relative);
  invariant(fs.existsSync(target), `eksik built asset ${relative}`);
  return fs.statSync(target).size;
}

function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(target) : [target];
  });
}

function checkPerformanceBudget() {
  invariant(fs.existsSync(path.join(dist, 'asset-manifest.json')), 'önce npm run build çalıştırılmalı');
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'asset-manifest.json'), 'utf8'));
  const globalSet = new Set(budget.globalScripts);
  const globalBytes = budget.globalScripts.reduce((total, source) => total + fileSize(source), 0);
  invariant(globalBytes <= budget.globalJsMaxBytes, `global JS ${globalBytes} > ${budget.globalJsMaxBytes}`);

  let largestPage = { page: '', bytes: 0 };
  let largestSpecific = { page: '', bytes: 0 };
  for (const page of manifest.pages) {
    const html = fs.readFileSync(path.join(dist, page), 'utf8');
    const sources = scriptSources(html);
    const total = sources.reduce((sum, source) => sum + fileSize(source), 0);
    const specific = sources.filter((source) => !globalSet.has(source))
      .reduce((sum, source) => sum + fileSize(source), 0);
    if (total > largestPage.bytes) largestPage = { page, bytes: total };
    if (specific > largestSpecific.bytes) largestSpecific = { page, bytes: specific };
    invariant(total <= budget.pageTotalJsMaxBytes, `${page} total JS ${total} > ${budget.pageTotalJsMaxBytes}`);
    invariant(specific <= budget.pageSpecificJsMaxBytes, `${page} page JS ${specific} > ${budget.pageSpecificJsMaxBytes}`);
    for (const [feature, allowed] of Object.entries(featurePages)) {
      invariant(!sources.includes(feature) || allowed.has(page), `${feature} gereksiz olarak ${page} içinde`);
    }
    invariant(!sources.some((source) => source.includes('tr-address-data')), `${page} ham adres datası taşıyor`);
  }

  const assetFiles = walkFiles(path.join(dist, 'assets'));
  const largestImage = assetFiles.map((file) => ({
    file: path.relative(dist, file).replaceAll('\\', '/'),
    bytes: fs.statSync(file).size,
  })).sort((a, b) => b.bytes - a.bytes)[0];
  invariant(largestImage.bytes <= budget.staticImageMaxBytes, `${largestImage.file} ${largestImage.bytes} > ${budget.staticImageMaxBytes}`);
  invariant(!fs.existsSync(path.join(dist, 'assets', 'suvera-istanbul-editorial.png')), '2 MB kaynak hero deploy buildine girdi');
  const hero = fileSize('assets/suvera-istanbul-editorial-1200.avif');
  invariant(hero <= budget.heroImageMaxBytes, `LCP hero ${hero} > ${budget.heroImageMaxBytes}`);

  const index = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  invariant(/rel="preload"[^>]+suvera-istanbul-editorial-1200\.avif[^>]+fetchpriority="high"/i.test(index), 'homepage LCP preload/fetchpriority eksik');
  const productDetail = fs.readFileSync(path.join(dist, 'js', 'product-detail.js'), 'utf8');
  invariant(/priority: true, purpose: 'detail'/.test(productDetail), 'ürün LCP görseli öncelikli değil');
  invariant(/loading="' \+ \(settings\.priority \? 'eager' : 'lazy'\)/.test(productDetail), 'ürün görsel lazy/eager ayrımı eksik');

  return { globalBytes, largestPage, largestSpecific, largestImage, heroBytes: hero };
}

if (require.main === module) {
  const result = checkPerformanceBudget();
  process.stdout.write(`Performance budget PASS: global=${result.globalBytes}, max-page=${result.largestPage.page}:${result.largestPage.bytes}, max-image=${result.largestImage.bytes}\n`);
}

module.exports = { checkPerformanceBudget, scriptSources };
