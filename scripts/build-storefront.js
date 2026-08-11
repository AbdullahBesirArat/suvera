const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..');
const outputRoot = path.resolve(projectRoot, 'dist');
const partialRoot = path.join(projectRoot, 'templates', 'partials');
const pageFiles = [
  'index.html', 'urunler.html', 'urun.html', 'sepet.html', 'giris.html', 'siparis.html',
  'sifre-sifirla.html', 'siparis-takip.html', 'tesekkur.html', 'hakkimizda.html',
  'iade.html', 'iletisim.html', 'kargo.html', 'kvkk.html', 'sozlesme.html',
  'uyelik-sozlesmesi.html', 'favoriler.html', 'hesabim.html', 'blog-detay.html',
  'blog.html', 'arama.html', 'dogrula.html', 'tercihler.html', 'karsilastir.html', 'suvera.html',
];
const staticFiles = ['favicon.svg', 'og-cover.svg', 'robots.txt', 'site.webmanifest'];
const partialNames = [
  'head-defaults', 'announcement', 'navigation', 'footer', 'consent',
  'scripts', 'legal-open', 'legal-close',
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function hash(value, length = 12) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, length);
}

function escapeAttribute(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function readPartials() {
  return Object.fromEntries(partialNames.map((name) => [
    name,
    fs.readFileSync(path.join(partialRoot, `${name}.html`), 'utf8').trim(),
  ]));
}

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(target) : [target];
  });
}

function capture(html, pattern, fallback) {
  return html.match(pattern)?.[1]?.trim() || fallback;
}

function renderHead(html, partial, pageFile) {
  const route = pageFile === 'index.html' ? 'anasayfa' : pageFile.replace(/\.html$/, '');
  const title = capture(html, /<title>([\s\S]*?)<\/title>/i, 'Suvera | Modern Tesettür Giyim');
  const description = capture(html, /<meta\s+name=["']description["']\s+content=["']([^"']*)["'][^>]*>/i,
    'Suvera modern tesettür giyim koleksiyonları.');
  const canonical = capture(html, /<link\s+rel=["']canonical["']\s+href=["']([^"']*)["'][^>]*>/i,
    `https://suvera.com.tr/${route}`);
  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    description,
    url: canonical,
    isPartOf: { '@type': 'WebSite', name: 'Suvera', url: 'https://suvera.com.tr/anasayfa' },
  }).replace(/<\//g, '<\\/');
  const descriptionDefault = /<meta\s+name=["']description["']/i.test(html)
    ? ''
    : `<meta name="description" content="${escapeAttribute(description)}" />`;
  const canonicalDefault = /<link\s+rel=["']canonical["']/i.test(html)
    ? ''
    : `<link rel="canonical" href="${escapeAttribute(canonical)}" />`;

  return partial
    .replace('{{DESCRIPTION_DEFAULT}}', descriptionDefault)
    .replace('{{CANONICAL_DEFAULT}}', canonicalDefault)
    .replaceAll('{{PAGE_TITLE}}', escapeAttribute(title))
    .replaceAll('{{PAGE_DESCRIPTION}}', escapeAttribute(description))
    .replaceAll('{{PAGE_CANONICAL}}', escapeAttribute(canonical))
    .replace('{{STRUCTURED_DATA}}', structuredData);
}

function versionLocalAssets(html, version) {
  return html.replace(
    /\b(src|href)=(['"])((?:js|css)\/[^'"?#]+\.(?:js|css)|shared\.(?:js|css))\2/g,
    (_match, attribute, quote, assetPath) => `${attribute}=${quote}${assetPath}?v=${version}${quote}`
  );
}

function renderPage(source, pageFile, partials, assetVersion) {
  const replacements = {
    ...partials,
    'head-defaults': renderHead(source, partials['head-defaults'], pageFile),
  };
  let output = source.replace(/\{\{>\s*([a-z-]+)\s*\}\}/g, (_match, name) => {
    invariant(Object.prototype.hasOwnProperty.call(replacements, name), `${pageFile}: bilinmeyen partial ${name}`);
    return replacements[name];
  });
  invariant(!/\{\{[>#]/.test(output), `${pageFile}: islenmemis template belirteci kaldi`);
  assertAccessibleDocument(output, pageFile);
  output = versionLocalAssets(output, assetVersion);
  return output.endsWith('\n') ? output : `${output}\n`;
}

// A31. Landmarks, a single H1 and a working skip-link target are structural guarantees, so
// they are enforced at build time rather than only observed by a browser test. A page that
// loses its <main id="main"> now fails the build instead of silently shipping.
function assertAccessibleDocument(html, pageFile) {
  invariant(/<html[^>]*\blang="tr"/i.test(html), `${pageFile}: <html lang="tr"> eksik`);

  const mainOpen = html.match(/<main\b[^>]*>/gi) || [];
  invariant(mainOpen.length === 1, `${pageFile}: tam olarak bir <main> olmali (bulunan: ${mainOpen.length})`);
  invariant(/\bid="main"/.test(mainOpen[0]), `${pageFile}: <main> icin id="main" zorunlu (skip link hedefi)`);

  const h1Count = (html.match(/<h1\b/gi) || []).length;
  invariant(h1Count === 1, `${pageFile}: tam olarak bir <h1> olmali (bulunan: ${h1Count})`);

  // Only pages that render the shared chrome carry the skip link; the redirect stub has
  // no navigation to skip past.
  if (/data-shared-partial="navigation"/.test(html)) {
    invariant(/class="skip-link" href="#main"/.test(html), `${pageFile}: skip link eksik`);
    invariant(/<header\b/i.test(html), `${pageFile}: <header> landmark eksik`);
    invariant(/<footer\b/i.test(html), `${pageFile}: <footer> landmark eksik`);
  }
}

function externalizeInlineScripts(html, pageFile) {
  const pageName = pageFile.replace(/\.html$/, '');
  let scriptIndex = 0;
  let scriptCount = 0;
  const output = html.replace(/<script([^>]*)>([\s\S]*?)<\/script>/gi, (match, attributes, content) => {
    if (/\bsrc\s*=/i.test(attributes) || /\btype\s*=\s*["']application\/ld\+json["']/i.test(attributes)) {
      return match;
    }
    if (!content.trim()) return '';
    scriptIndex += 1;
    scriptCount += 1;
    const file = `${pageName}.${scriptIndex}.${hash(content)}.js`;
    const directory = path.join(outputRoot, 'js', 'pages');
    fs.mkdirSync(directory, { recursive: true });
    const scriptContent = content.trimStart();
    // Classic page scripts are syntax-checked here. Module scripts can contain
    // static imports, which vm.Script intentionally does not parse; their
    // syntax is checked by the regular source check/build and browser E2E.
    if (!/\btype\s*=\s*["']module["']/i.test(attributes)) {
      new vm.Script(scriptContent, { filename: file });
    }
    fs.writeFileSync(path.join(directory, file), scriptContent);
    return `<script${attributes} src="js/pages/${file}"></script>`;
  });
  return { html: output, scriptCount };
}

// Move each page-level <style> block into an external stylesheet so the served
// HTML needs no style-src 'unsafe-inline'. Blocks stay page-scoped (linked only
// where they appeared) to avoid cross-page selector bleed.
function externalizeStyleBlocks(html, pageFile) {
  const pageName = pageFile.replace(/\.html$/, '');
  let blockCount = 0;
  const output = html.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_match, css) => {
    const content = css.trim();
    if (!content) return '';
    blockCount += 1;
    const file = `${pageName}.${blockCount}.${hash(content)}.css`;
    const directory = path.join(outputRoot, 'css', 'pages');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, file), `${content}\n`);
    return `<link rel="stylesheet" href="css/pages/${file}">`;
  });
  return { html: output, blockCount };
}

// Inline styles carry inline specificity (they beat selector rules), so the
// generated utility declarations are marked !important to preserve that
// precedence after the attribute is replaced with a class.
function importantify(declaration) {
  return declaration
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (/!important/i.test(part) ? part : `${part} !important`))
    .join(';');
}

// Replace every static inline style="..." attribute with a deterministic, hashed
// utility class, collecting the declarations into `rules` for a shared stylesheet.
// Runs after script externalization so style= inside inline JS is never matched.
function extractInlineStyles(html, rules) {
  const tagPattern = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)\sstyle=("([^"]*)"|'([^']*)')((?:"[^"]*"|'[^']*'|[^>"'])*?)>/g;
  return html.replace(tagPattern, (_match, tag, pre, _quoted, dq, sq, post) => {
    const declaration = String(dq !== undefined ? dq : sq).trim().replace(/;\s*$/, '');
    if (!declaration) return `<${tag}${pre}${post}>`;
    const cls = `si-${hash(declaration, 8)}`;
    rules.set(cls, declaration);
    let attrs = `${pre}${post}`;
    const classMatch = attrs.match(/\sclass=("([^"]*)"|'([^']*)')/);
    if (classMatch) {
      const existing = classMatch[2] !== undefined ? classMatch[2] : classMatch[3];
      attrs = attrs.replace(classMatch[0], ` class="${existing} ${cls}"`);
    } else {
      attrs = ` class="${cls}"${attrs}`;
    }
    return `<${tag}${attrs}>`;
  });
}

function copyDirectory(sourceName, filter) {
  const source = path.join(projectRoot, sourceName);
  const destination = path.join(outputRoot, sourceName);
  fs.cpSync(source, destination, {
    recursive: true,
    filter: (entry) => !filter || filter(entry),
  });
}

function parseAddressSource() {
  const source = fs.readFileSync(path.join(projectRoot, 'js', 'tr-address-data.js'), 'utf8');
  const match = source.match(/window\.TR_ADDRESS_DATA\s*=\s*(\[[\s\S]*\]);\s*$/);
  invariant(match, 'tr-address-data.js beklenen veri atamasini icermiyor');
  return JSON.parse(match[1]);
}

function buildAddressData() {
  const data = parseAddressSource();
  const addressRoot = path.join(outputRoot, 'data', 'address');
  const districtRoot = path.join(addressRoot, 'districts');
  fs.mkdirSync(districtRoot, { recursive: true });

  const cities = data.map((city) => {
    const districts = JSON.stringify(city.districts || []);
    const file = `${city.id}.${hash(districts)}.json`;
    fs.writeFileSync(path.join(districtRoot, file), districts);
    return { id: city.id, name: city.name, districtsPath: `data/address/districts/${file}` };
  });
  const cityJson = JSON.stringify(cities);
  const citiesFile = `cities.${hash(cityJson)}.json`;
  fs.writeFileSync(path.join(addressRoot, citiesFile), cityJson);
  return { citiesFile, cityCount: cities.length };
}

function build() {
  invariant(outputRoot.startsWith(`${projectRoot}${path.sep}`), 'Guvensiz output dizini');
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });

  const partials = readPartials();
  const versionedFiles = [
    ...collectFiles(path.join(projectRoot, 'css')),
    ...collectFiles(path.join(projectRoot, 'js')).filter((file) => !file.endsWith('.test.js') && !file.endsWith('tr-address-data.js')),
    path.join(projectRoot, 'shared.css'),
    path.join(projectRoot, 'shared.js'),
  ];
  const versionInput = [...Object.values(partials), ...versionedFiles.map((file) => fs.readFileSync(file))];
  const assetVersion = hash(Buffer.concat(versionInput.map((value) => Buffer.from(value))));

  const inlineStyleRules = new Map();
  let inlineScriptCount = 0;
  let styleBlockCount = 0;
  const renderedPages = [];
  for (const pageFile of pageFiles) {
    const sourcePath = path.join(projectRoot, pageFile);
    invariant(fs.existsSync(sourcePath), `Eksik storefront sayfasi: ${pageFile}`);
    const source = fs.readFileSync(sourcePath, 'utf8');
    const rendered = renderPage(source, pageFile, partials, assetVersion);
    const blocks = externalizeStyleBlocks(rendered, pageFile);
    styleBlockCount += blocks.blockCount;
    const externalized = externalizeInlineScripts(blocks.html, pageFile);
    inlineScriptCount += externalized.scriptCount;
    const inlined = extractInlineStyles(externalized.html, inlineStyleRules);
    renderedPages.push({ pageFile, html: inlined });
  }

  // One shared, content-hashed stylesheet holds every extracted inline style.
  let inlineCssHref = '';
  const inlineCssBody = [...inlineStyleRules.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([cls, declaration]) => `.${cls}{${importantify(declaration)}}`)
    .join('\n');
  if (inlineCssBody) {
    fs.mkdirSync(path.join(outputRoot, 'css'), { recursive: true });
    const inlineCssFile = `inline.${hash(inlineCssBody)}.css`;
    fs.writeFileSync(path.join(outputRoot, 'css', inlineCssFile), `${inlineCssBody}\n`);
    inlineCssHref = `css/${inlineCssFile}`;
  }

  for (const { pageFile, html } of renderedPages) {
    const finalHtml = inlineCssHref
      ? html.replace(/<\/head>/i, `  <link rel="stylesheet" href="${inlineCssHref}">\n</head>`)
      : html;
    fs.writeFileSync(path.join(outputRoot, pageFile), finalHtml);
  }

  for (const file of staticFiles) fs.copyFileSync(path.join(projectRoot, file), path.join(outputRoot, file));
  // The 2 MB editorial source is retained for design work, but the deployed build
  // ships only its measured AVIF/WebP variants. Keeping the source out also makes an
  // accidental regression visible to the deterministic image budget.
  copyDirectory('assets', (entry) => path.basename(entry) !== 'suvera-istanbul-editorial.png');
  copyDirectory('css');
  copyDirectory('js', (entry) => !entry.endsWith('tr-address-data.js') && !entry.endsWith('.test.js'));
  fs.copyFileSync(path.join(projectRoot, 'shared.css'), path.join(outputRoot, 'shared.css'));
  fs.copyFileSync(path.join(projectRoot, 'shared.js'), path.join(outputRoot, 'shared.js'));

  const address = buildAddressData();
  const addressLoaderPath = path.join(outputRoot, 'js', 'address-loader.js');
  const addressLoader = fs.readFileSync(addressLoaderPath, 'utf8').replace('__CITIES_FILE__', address.citiesFile);
  invariant(!addressLoader.includes('__CITIES_FILE__'), 'Adres manifest belirteci islenemedi');
  fs.writeFileSync(addressLoaderPath, addressLoader);

  const manifest = {
    assetVersion,
    pages: pageFiles,
    address: { cityCount: address.cityCount, citiesFile: address.citiesFile },
    sourceMaps: false,
    inlineScriptCount,
    styleBlockCount,
    inlineStyleCount: inlineStyleRules.size,
  };
  fs.writeFileSync(path.join(outputRoot, 'asset-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`Storefront build tamamlandi: ${pageFiles.length} sayfa, ${address.cityCount} il, v${assetVersion}\n`);
}

build();
