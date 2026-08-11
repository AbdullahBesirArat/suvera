'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  isForbiddenPath,
  isAllowedEnvExample,
  scanContentForSecrets,
  isPlaceholderSecret,
  collectTrackedFiles,
  collectSourceFiles,
  isIntendedUntrackedSource,
} = require('../scripts/package-source.js');

test('forbidden paths cover secrets, deps, build output and dumps', () => {
  for (const p of [
    '.env',
    '.env.local',
    'apps/web/.env.vercel.production',
    'node_modules/pg/index.js',
    '.git/config',
    '.vercel/project.json',
    '.next/build-manifest.json',
    'dist/index.html',
    'panelya-api/backups/prod.dump',
    'db/prod-dump.sql',
    'db/backup-2026.sql',
    'coverage/lcov.info',
    'test-results/.last-run.json',
    'playwright-report/index.html',
    'certs/server.key',
  ]) {
    assert.equal(isForbiddenPath(p), true, `${p} yasak olmali`);
  }
});

test('tracked source files and .env examples are allowed', () => {
  for (const p of [
    '.env.example',
    'panelya-api/.env.production.example',
    'index.html',
    'js/storefront.js',
    'panelya-api/db/migrations/038_tenant_composite_fk_rls.sql',
    'panelya-api/db/seed.sql',
    'panelya-api/scripts/cleanup-test-orgs.sql',
  ]) {
    assert.equal(isForbiddenPath(p), false, `${p} izinli olmali`);
  }
});

test('env example detection is precise', () => {
  assert.equal(isAllowedEnvExample('.env.example'), true);
  assert.equal(isAllowedEnvExample('panelya-api/.env.production.example'), true);
  assert.equal(isAllowedEnvExample('.env'), false);
  assert.equal(isAllowedEnvExample('.env.local'), false);
});

test('secret content scan flags real secrets but ignores placeholders', () => {
  assert.deepEqual(scanContentForSecrets('AKIAIOSFODNN7EXAMPLE key here'), []); // has EXAMPLE
  assert.deepEqual(scanContentForSecrets('AKIA1234567890ABCDEF'), ['aws-access-key-id']);
  assert.ok(scanContentForSecrets(`-----BEGIN RSA ${'PRIVATE'} KEY-----\nabc`).includes('private-key-block'));
  assert.deepEqual(scanContentForSecrets('JWT_SECRET=your-token-here'), []);
  assert.equal(isPlaceholderSecret('CHANGE_ME'), true);
  assert.equal(isPlaceholderSecret('AKIA1234567890ABCDEF'), false);
});

test('the real tracked working tree contains no forbidden package paths', () => {
  if (fs.existsSync(path.join(process.cwd(), '.git'))) {
    const entries = collectTrackedFiles(process.cwd());
    const bad = entries.filter((entry) => isForbiddenPath(entry.rel));
    assert.deepEqual(bad.map((entry) => entry.rel), [], 'tracked set yasak dosya icermemeli');
    assert.ok(entries.length > 10, 'tracked dosya listesi bos olmamali');
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.source-package-manifest.json'), 'utf8'));
  assert.equal(manifest.format, 'panelya-suvera-source-v1');
  assert.ok(manifest.files.length > 10, 'package manifest bos olmamali');
  assert.deepEqual(manifest.files.filter((entry) => isForbiddenPath(entry.path)), []);
});

test('intended untracked source allowlist includes code/tests/migrations but excludes reports and leftovers', () => {
  for (const p of [
    'e2e/specs/storefront.spec.cjs',
    'js/analytics.js',
    'scripts/check-performance-budget.js',
    'templates/partials/navigation.html',
    'performance-budget.json',
  ]) assert.equal(isIntendedUntrackedSource('.', p), true, `${p} root source olmali`);

  for (const p of [
    'apps/web/src/components/sections/security-section.tsx',
    'apps/web/test/security-a30.test.ts',
    'panelya-api/db/migrations/071_customer_search_query_indexes.sql',
    'panelya-api/modules/security/mfa.js',
    'panelya-api/test/integration/tenant-rls.test.js',
  ]) assert.equal(isIntendedUntrackedSource('panelya', p), true, `${p} submodule source olmali`);

  for (const p of [
    'DATABASE_ANALYSIS.md',
    'test-results/.last-run.json',
    'e2e/.state.json',
    'panelya-api/test-results/.last-run.json',
  ]) {
    assert.equal(isIntendedUntrackedSource('.', p), false, `${p} root package disinda kalmali`);
    assert.equal(isIntendedUntrackedSource('panelya', p), false, `${p} submodule package disinda kalmali`);
  }
});

test('current source package includes intended untracked migrations/tests without user reports', () => {
  const gitWorkspace = fs.existsSync(path.join(process.cwd(), '.git'));
  const entries = gitWorkspace
    ? collectSourceFiles(process.cwd()).map((entry) => ({ path: entry.rel }))
    : JSON.parse(fs.readFileSync(path.join(process.cwd(), '.source-package-manifest.json'), 'utf8')).files;
  const paths = new Set(entries.map((entry) => entry.path));
  assert.ok(paths.has('e2e/specs/storefront.spec.cjs'));
  assert.ok(paths.has('panelya/panelya-api/db/migrations/071_customer_search_query_indexes.sql'));
  assert.ok(paths.has('panelya/apps/web/test/performance-contract.test.ts'));
  assert.equal(paths.has('DATABASE_ANALYSIS.md'), false);
  assert.equal(paths.has('panelya/panelya-api/test-results/.last-run.json'), false);

  if (!gitWorkspace) {
    for (const entry of entries) {
      const buffer = fs.readFileSync(path.join(process.cwd(), entry.path));
      assert.equal(buffer.length, entry.bytes, `${entry.path} byte parity`);
      assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'), entry.sha256, `${entry.path} hash parity`);
    }
  }
});
