const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'asset-manifest.json'), 'utf8'));
const shellPages = manifest.pages.filter((page) => !['siparis.html', 'suvera.html'].includes(page));

function read(base, file) {
  return fs.readFileSync(path.join(base, file), 'utf8');
}

function count(text, pattern) {
  return (text.match(pattern) || []).length;
}

test('all storefront templates build to static HTML with complete SEO metadata', () => {
  assert.equal(manifest.pages.length, 25);
  for (const page of manifest.pages) {
    const html = read(dist, page);
    assert.doesNotMatch(html, /\{\{[>#]/, page);
    assert.equal(count(html, /<title>[\s\S]*?<\/title>/gi), 1, `${page} title`);
    assert.equal(count(html, /<meta\s+name="description"/gi), 1, `${page} description`);
    assert.equal(count(html, /<link\s+rel="canonical"/gi), 1, `${page} canonical`);
    assert.equal(count(html, /<meta\s+property="og:title"/gi), 1, `${page} OG title`);
    assert.equal(count(html, /type="application\/ld\+json"/gi), 1, `${page} JSON-LD`);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>[\s\S]*?<\/script>/i, `${page} executable inline script`);
    assert.doesNotMatch(html, /<style[\s>]/i, `${page} inline <style> block`);
    assert.doesNotMatch(html, /\sstyle=/i, `${page} inline style attribute`);
  }
  assert.ok(manifest.styleBlockCount >= 1, 'style blocks externalized');
  assert.ok(manifest.inlineStyleCount >= 1, 'inline styles extracted to classes');
});

test('navigation and footer have one physical source and identical built output', () => {
  const navOutputs = new Set();
  const footerOutputs = new Set();
  for (const page of shellPages) {
    const source = read(root, page);
    const html = read(dist, page);
    assert.equal(count(source, /\{\{> navigation\}\}/g), 1, `${page} navigation token`);
    assert.equal(count(source, /\{\{> footer\}\}/g), 1, `${page} footer token`);
    assert.doesNotMatch(source, /<nav\b|<footer\b/i, `${page} duplicated source shell`);
    navOutputs.add(html.match(/<nav\b[\s\S]*?<\/nav>/i)?.[0]);
    footerOutputs.add(html.match(/<footer\b[\s\S]*?<\/footer>/i)?.[0]);
  }
  assert.equal(navOutputs.size, 1);
  assert.equal(footerOutputs.size, 1);
});

test('legal pages use the shared legal shell partial', () => {
  for (const page of ['iade.html', 'kargo.html', 'kvkk.html', 'sozlesme.html', 'uyelik-sozlesmesi.html']) {
    const source = read(root, page);
    assert.match(source, /\{\{> legal-open\}\}/);
    assert.match(source, /\{\{> legal-close\}\}/);
    assert.match(read(dist, page), /data-shared-partial="legal-shell"/);
  }
});

// The loader ships only on the pages that actually collect a TR address: checkout and
// (since A25) the account address book. What this test really guards is unchanged — the
// heavy tr-address-data bundle is never shipped and districts are fetched lazily per
// city — and every other page must still be free of both.
const ADDRESS_INPUT_PAGES = ['siparis.html', 'hesabim.html'];

test('address payload is limited to address-collecting pages and districts are fetched lazily per city', async () => {
  for (const page of ADDRESS_INPUT_PAGES) {
    assert.match(read(dist, page), /js\/address-loader\.js\?v=[a-f0-9]{12}/, page);
  }
  for (const page of manifest.pages.filter((page) => !ADDRESS_INPUT_PAGES.includes(page))) {
    assert.doesNotMatch(read(dist, page), /address-loader|tr-address-data/, page);
  }
  assert.equal(fs.existsSync(path.join(dist, 'js', 'tr-address-data.js')), false);

  const cityFile = path.join(dist, 'data', 'address', manifest.address.citiesFile);
  const cities = JSON.parse(fs.readFileSync(cityFile, 'utf8'));
  assert.equal(cities.length, 81);
  assert.ok(cities.every((city) => city.districts == null && city.districtsPath));

  const requests = [];
  const context = {
    window: {},
    fetch: async (url) => {
      requests.push(url);
      if (String(url).includes('cities.')) {
        return { ok: true, json: async () => [{ id: 76, name: 'IĞDIR', districtsPath: 'data/address/districts/76.test.json' }] };
      }
      return { ok: true, json: async () => [{ id: 1, name: 'MERKEZ' }] };
    },
    Map,
  };
  vm.runInNewContext(read(dist, 'js/address-loader.js'), context);
  const matches = await context.window.SuveraAddressData.searchCities('igdir');
  assert.equal(matches[0].name, 'IĞDIR');
  assert.equal(requests.length, 1, 'search only loads the small city manifest');
  const districts = await context.window.SuveraAddressData.loadDistricts(76);
  assert.equal(districts[0].name, 'MERKEZ');
  assert.equal(requests.length, 2, 'district data loads after city selection');
});

test('checkout consumes shared ES module helpers without duplicate implementations', () => {
  const source = read(root, 'siparis.html');
  const built = read(dist, 'siparis.html');
  assert.match(source, /type="module"/);
  assert.match(source, /storefront-utils\.js/);
  assert.doesNotMatch(source, /function (?:escapeHtml|money|safePaymentUrl)\s*\(/);
  assert.match(built, /<script type="module" src="js\/pages\/siparis\.\d+\.[a-f0-9]+\.js"><\/script>/);
});

test('asset versioning and Vercel clean routes remain configured', () => {
  const index = read(dist, 'index.html');
  assert.match(index, new RegExp(`shared\\.css\\?v=${manifest.assetVersion}`));
  assert.match(index, new RegExp(`shared\\.js\\?v=${manifest.assetVersion}`));
  assert.equal(manifest.sourceMaps, false);
  assert.ok(manifest.inlineScriptCount > 0);
  const vercel = JSON.parse(read(root, 'vercel.json'));
  assert.equal(vercel.buildCommand, 'npm run build');
  assert.equal(vercel.outputDirectory, 'dist');
  assert.ok(vercel.rewrites.some((entry) => entry.source === '/api/(.*)' && entry.destination === '/api/[...path].js'));
  assert.ok(vercel.rewrites.some((entry) => entry.source === '/anasayfa' && entry.destination === '/index.html'));
  const securityHeaders = vercel.headers.find((entry) => entry.source === '/(.*)').headers;
  const csp = securityHeaders.find((entry) => entry.key === 'Content-Security-Policy').value;
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /sha256-|unsafe-inline[^;]*script/i);
  assert.match(csp, /style-src 'self'/);
  assert.doesNotMatch(csp, /style-src[^;]*'unsafe-inline'/i);
});
