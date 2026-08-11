'use strict';

// A02: produce a clean, distributable source package from the current working
// tree. Git-tracked files plus a strict allowlist of intended untracked source
// files are included. Ignored artifacts (.env, node_modules, .next, dist,
// backups, SQL dumps, caches, .vercel) never leak into the archive. The package
// is verified against forbidden-path and forbidden-content rules before write.

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Paths that must never appear inside a clean source package. `.env.example`
// and `.env.*.example` are explicitly allowed; every other `.env*` is rejected.
const FORBIDDEN_PATH_PATTERNS = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.vercel(\/|$)/,
  /(^|\/)\.next(\/|$)/,
  /(^|\/)\.turbo(\/|$)/,
  /(^|\/)\.cache(\/|$)/,
  /(^|\/)coverage(\/|$)/,
  /(^|\/)test-results(\/|$)/,
  /(^|\/)playwright-report(\/|$)/,
  /(^|\/)dist(\/|$)/,
  /(^|\/)build(\/|$)/,
  /(^|\/)out(\/|$)/,
  /(^|\/)backups?(\/|$)/,
  /(^|\/)uploads(\/|$)/,
  // Dump-like artifacts only. Real migrations (db/migrations/*.sql) and seed.sql
  // are source and must remain in the package, so *.sql is not blanket-excluded.
  /\.(dump|bak|pem|key|pfx|p12)$/i,
  /\.sql\.gz$/i,
  /(dump|backup)[^/]*\.sql$/i,
  /(^|\/)id_rsa(\.|$)/,
];

function isAllowedEnvExample(relPath) {
  const base = relPath.split('/').pop() || '';
  return /^\.env(\..+)?\.example$/.test(base) || base === '.env.example';
}

function isForbiddenPath(relPath) {
  const normalized = String(relPath || '').replace(/\\/g, '/');
  if (/(^|\/)\.env/.test(normalized) && !isAllowedEnvExample(normalized)) {
    return true;
  }
  return FORBIDDEN_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

// Heuristic secret detectors for the content scan. Deliberately conservative so
// example placeholders (CHANGE_ME, your-token-here, xxxx) do not trip the gate.
const SECRET_CONTENT_PATTERNS = [
  { label: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { label: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { label: 'slack-token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { label: 'jwt-like', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
];

function isPlaceholderSecret(value) {
  return /change[_-]?me|your[_-]|example|placeholder|xxxx|<[^>]+>|\.\.\.|test[_-]?secret|dummy/i.test(value);
}

function scanContentForSecrets(text) {
  const findings = [];
  for (const { label, re } of SECRET_CONTENT_PATTERNS) {
    const match = re.exec(text);
    if (match && !isPlaceholderSecret(match[0])) findings.push(label);
  }
  return findings;
}

function gitTrackedFiles(cwd) {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd, maxBuffer: 64 * 1024 * 1024 });
  return out.toString('utf8').split('\0').filter(Boolean);
}

function gitUntrackedFiles(cwd) {
  const out = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.toString('utf8').split('\0').filter(Boolean);
}

function isIntendedUntrackedSource(repo, relPath) {
  const rel = String(relPath || '').replace(/\\/g, '/');
  if (isForbiddenPath(rel)) return false;

  if (repo === '.') {
    return /^(?:\.github\/workflows\/[^/]+\.ya?ml|\.vercelignore|package-lock\.json|performance-budget\.json|playwright\.config\.cjs)$/.test(rel)
      || /^(?:karsilastir|tercihler)\.html$/.test(rel)
      || /^js\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:js|json)$/.test(rel)
      || /^scripts\/[A-Za-z0-9._-]+\.js$/.test(rel)
      || /^templates\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.html$/.test(rel)
      || /^e2e\/(?:fixtures|global-setup|global-teardown)\.cjs$/.test(rel)
      || /^e2e\/(?:lib|specs)\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:cjs|js|json)$/.test(rel);
  }

  return /^\.github\/workflows\/[^/]+\.ya?ml$/.test(rel)
    || /^apps\/web\/(?:src|test)\/(?:[A-Za-z0-9._@\[\]-]+\/)*[A-Za-z0-9._@\[\]-]+\.(?:ts|tsx|js|jsx|css|json)$/.test(rel)
    || /^panelya-api\/db\/migrations\/[A-Za-z0-9._-]+\.sql$/.test(rel)
    || /^panelya-api\/(?:middleware|modules|routes|scripts|services|test)\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:js|cjs|json|sql)$/.test(rel);
}

function collectTrackedFiles(cwd) {
  // Include submodule sources so the package is a complete, buildable tree.
  let submodules = [];
  try {
    const status = execFileSync('git', ['submodule', 'status'], { cwd }).toString('utf8');
    submodules = status.split('\n').map((line) => line.trim().split(/\s+/)[1]).filter(Boolean);
  } catch (_) {
    submodules = [];
  }
  // git ls-files reports each submodule root as a gitlink entry; drop those so we
  // do not try to read a directory. The submodule's own files are added below.
  const submoduleSet = new Set(submodules);
  const files = gitTrackedFiles(cwd)
    .filter((rel) => !submoduleSet.has(rel))
    .map((rel) => ({ repo: '.', rel }));
  for (const sub of submodules) {
    const subDir = path.join(cwd, sub);
    if (!fs.existsSync(path.join(subDir, '.git'))) continue;
    for (const rel of gitTrackedFiles(subDir)) {
      files.push({ repo: sub, rel: `${sub}/${rel}`, sourceRel: rel, sourceDir: subDir });
    }
  }
  return files;
}

function collectSourceFiles(cwd) {
  const entries = collectTrackedFiles(cwd);
  const submodules = [...new Set(entries.filter((entry) => entry.repo !== '.').map((entry) => entry.repo))];
  const candidates = gitUntrackedFiles(cwd)
    .filter((rel) => isIntendedUntrackedSource('.', rel))
    .map((rel) => ({ repo: '.', rel }));

  for (const sub of submodules) {
    const subDir = path.join(cwd, sub);
    for (const sourceRel of gitUntrackedFiles(subDir)) {
      if (!isIntendedUntrackedSource(sub, sourceRel)) continue;
      candidates.push({ repo: sub, rel: `${sub}/${sourceRel}`, sourceRel, sourceDir: subDir });
    }
  }

  const unique = new Map(entries.map((entry) => [entry.rel, entry]));
  for (const entry of candidates) unique.set(entry.rel, entry);
  return [...unique.values()].sort((a, b) => a.rel.localeCompare(b.rel));
}

function isProbablyText(buffer) {
  const sample = buffer.subarray(0, 4096);
  return !sample.includes(0);
}

function packageSource({ cwd = process.cwd(), outDir } = {}) {
  const stagingRoot = outDir || fs.mkdtempSync(path.join(os.tmpdir(), 'suvera-source-'));
  const entries = collectSourceFiles(cwd);

  const forbidden = entries.filter((entry) => isForbiddenPath(entry.rel));
  if (forbidden.length) {
    throw new Error(`Yasak dosya kaynak pakete girecekti: ${forbidden.map((f) => f.rel).join(', ')}`);
  }

  fs.rmSync(stagingRoot, { recursive: true, force: true });
  fs.mkdirSync(stagingRoot, { recursive: true });

  let totalBytes = 0;
  const secretHits = [];
  const manifestFiles = [];
  for (const entry of entries) {
    const absSource = entry.sourceDir
      ? path.join(entry.sourceDir, entry.sourceRel)
      : path.join(cwd, entry.rel);
    if (!fs.existsSync(absSource)) continue; // staged-deleted file still tracked
    if (fs.statSync(absSource).isDirectory()) continue; // defensive: gitlink/dir
    const buffer = fs.readFileSync(absSource);
    totalBytes += buffer.length;
    manifestFiles.push({
      path: entry.rel.replace(/\\/g, '/'),
      bytes: buffer.length,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    });
    if (isProbablyText(buffer)) {
      const hits = scanContentForSecrets(buffer.toString('utf8'));
      if (hits.length) secretHits.push(`${entry.rel}: ${hits.join(',')}`);
    }
    const dest = path.join(stagingRoot, entry.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buffer);
  }

  if (secretHits.length) {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    throw new Error(`Kaynak pakette olasi secret bulundu: ${secretHits.join(' | ')}`);
  }

  const manifest = {
    format: 'panelya-suvera-source-v1',
    sourceFileCount: manifestFiles.length,
    files: manifestFiles,
  };
  fs.writeFileSync(
    path.join(stagingRoot, '.source-package-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );

  return { stagingRoot, fileCount: entries.length + 1, totalBytes };
}

function main() {
  const outArg = process.argv[2];
  const result = packageSource({ outDir: outArg });
  const mb = (result.totalBytes / (1024 * 1024)).toFixed(2);
  console.log(`Temiz kaynak paketi hazir: ${result.fileCount} dosya, ${mb} MB`);
  console.log(`Konum: ${result.stagingRoot}`);
  console.log('Yasak path/secret taramasi: temiz.');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`package-source hatasi: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  isForbiddenPath,
  isAllowedEnvExample,
  scanContentForSecrets,
  isPlaceholderSecret,
  collectTrackedFiles,
  collectSourceFiles,
  isIntendedUntrackedSource,
  packageSource,
};
