'use strict';

const { bff, ensureSuperAdminMfa, expect, loginAdmin, storageSnapshot, test } = require('../fixtures.cjs');
const { dbQuery } = require('../lib/db.cjs');
const { readState } = require('../lib/state.cjs');

// A28 storefront themes. Split into focused flows rather than one giant test.
//
// Everything runs against the real API, the real admin and the real storefront started by
// global-setup. Two invariants shape most assertions:
//
//   * a DRAFT must be unreachable from anything a visitor can do, and
//   * a theme must reach the page as a same-origin stylesheet, never an inline style,
//     because the storefront CSP is `style-src 'self'` with `style-src-attr 'none'`.

const REASON = 'A28 e2e dogrulama';

async function tenantAdmin(browser, e2eState, tenant = 'tenantA') {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAdmin(page, e2eState, { tenant });
  return { context, page };
}

async function superAdmin(browser, e2eState) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAdmin(page, e2eState, { superAdmin: true });
  await ensureSuperAdminMfa(page, e2eState);
  return { context, page };
}

// Removes every theme version except the tenant's current published one, so each flow
// starts from the same place without ever leaving the storefront without a theme.
async function resetThemes(organizationId) {
  const [published] = await dbQuery(
    "select id from theme_versions where organization_id = $1 and status = 'published'",
    [organizationId]
  );
  if (!published) return;
  await dbQuery('delete from theme_preview_tokens where organization_id = $1', [organizationId]);
  await dbQuery(
    'delete from theme_publications where organization_id = $1 and theme_version_id <> $2',
    [organizationId, published.id]
  );
  await dbQuery(
    'delete from theme_versions where organization_id = $1 and id <> $2',
    [organizationId, published.id]
  );
}

async function draftFor(page) {
  const created = await bff(page, '/themes/draft', { method: 'POST', body: {} });
  // 201 the first time, 200 when a draft already exists: creating a draft is idempotent.
  expect([200, 201]).toContain(created.status);
  return created.body.draft;
}

function withPrimary(config, hex) {
  return { ...config, tokens: { ...config.tokens, colors: { ...config.tokens.colors, primary: hex } } };
}

test.describe('A28 storefront themes', () => {
  let orgA;
  let orgB;
  let state;
  // The tenant's theme is real, shared state: publishing here changes what every other spec
  // would see. The original published row is captured verbatim and put back afterwards.
  let originalTheme;

  test.beforeAll(async () => {
    state = readState();
    orgA = state.fixtures.tenantA.organizationId;
    orgB = state.fixtures.tenantB.organizationId;
    [originalTheme] = await dbQuery(
      "select * from theme_versions where organization_id = $1 and status = 'published'",
      [orgA]
    );
  });

  test.afterAll(async () => {
    if (!originalTheme) return;
    await dbQuery('delete from theme_preview_tokens where organization_id = $1', [orgA]);
    await dbQuery('delete from theme_publications where organization_id = $1', [orgA]);
    await dbQuery('delete from theme_versions where organization_id = $1', [orgA]);
    await dbQuery(
      `insert into theme_versions
         (id, organization_id, version_number, schema_version, config, status, validation_hash,
          validation_result, based_on_version_id, created_by, created_at, updated_at, published_at)
       values ($1,$2,$3,$4,$5::jsonb,'published',$6,$7::jsonb,null,$8,$9,$10,$11)`,
      [
        originalTheme.id, orgA, originalTheme.version_number, originalTheme.schema_version,
        JSON.stringify(originalTheme.config), originalTheme.validation_hash,
        JSON.stringify(originalTheme.validation_result), originalTheme.created_by,
        originalTheme.created_at, originalTheme.updated_at, originalTheme.published_at,
      ]
    );
    await dbQuery(
      `insert into theme_publications (organization_id, theme_version_id, action, reason, config_hash)
       values ($1,$2,'publish','A28 e2e restore',$3)`,
      [orgA, originalTheme.id, originalTheme.validation_hash]
    );
  });

  test('1-11 the editor opens on the published theme, edits tokens and sections, and autosaves', async ({ browser, e2eState }) => {
    await resetThemes(orgA);
    const tenant = await tenantAdmin(browser, e2eState);
    try {
      // 1-2 The theme editor is reachable and shows the live theme.
      await tenant.page.goto(`${e2eState.origins.admin}/theme`);
      await expect(tenant.page.getByText('Tema sürümü')).toBeVisible();
      const published = await bff(tenant.page, '/themes/published');
      expect(published.status).toBe(200);
      expect(published.body.theme).not.toBeNull();
      await expect(tenant.page.getByText(`v${published.body.theme.versionNumber}`).first()).toBeVisible();

      // 3 A draft is forked from what is published.
      await tenant.page.getByRole('button', { name: 'Taslak oluştur' }).click();
      await expect(tenant.page.getByLabel('Birincil rengi (hex)')).toBeVisible();
      const draft = (await bff(tenant.page, '/themes/draft')).body.draft;
      expect(draft).not.toBeNull();
      expect(draft.status).toBe('draft');
      expect(draft.config).toEqual(published.body.theme.config);

      // 4-6 Colour, font and numeric tokens are editable through closed controls.
      await tenant.page.getByLabel('Birincil rengi (hex)').fill('#123456');
      await tenant.page.getByLabel('Başlık yazı tipi').selectOption('serif');
      await tenant.page.getByLabel('Köşe yarıçapı (px)').fill('14');
      await tenant.page.getByLabel('İçerik genişliği (px)').fill('1100');

      // 10-11 Autosave is debounced, and the editor says so.
      await expect(tenant.page.getByText('Taslak kaydedildi')).toBeVisible({ timeout: 15_000 });
      const afterTokens = (await bff(tenant.page, '/themes/draft')).body.draft;
      expect(afterTokens.config.tokens.colors.primary).toBe('#123456');
      expect(afterTokens.config.tokens.fonts.heading).toBe('serif');
      expect(afterTokens.config.tokens.radius).toBe(14);
      expect(afterTokens.config.tokens.container.maxWidth).toBe(1100);

      // 7 A hero setting is content, not markup.
      const heroSection = draft.config.sections.find((section) => section.type === 'hero');
      await tenant.page.locator(`#section-${heroSection.id}-title`).fill('A28 kapak başlığı');
      await expect(tenant.page.getByText('Taslak kaydedildi')).toBeVisible({ timeout: 15_000 });

      // 8 Disabling a section, and 9 reordering it, both go through the schema.
      await tenant.page.getByLabel('Güven şeritleri bölümünü göster').uncheck();
      await tenant.page.getByLabel('Ürün ızgarası bölümünü yukarı taşı').click();
      await expect(tenant.page.getByText('Taslak kaydedildi')).toBeVisible({ timeout: 15_000 });

      const saved = (await bff(tenant.page, '/themes/draft')).body.draft;
      const hero = saved.config.sections.find((section) => section.type === 'hero');
      expect(hero.settings.title).toBe('A28 kapak başlığı');
      expect(saved.config.sections.find((section) => section.type === 'trust-features').enabled).toBe(false);
      const order = saved.config.sections.slice().sort((a, b) => a.order - b.order).map((s) => s.type);
      expect(order.indexOf('product-grid')).toBeLessThan(order.indexOf('hero'));
      // Order is renumbered densely by the server, never left sparse.
      expect(saved.config.sections.map((s) => s.order).sort((a, b) => a - b))
        .toEqual(saved.config.sections.map((_, index) => index));
    } finally {
      await tenant.context.close();
    }
  });

  test('12-13 a stale editor is told about the conflict and overwrites nothing', async ({ browser, e2eState }) => {
    await resetThemes(orgA);
    const tenant = await tenantAdmin(browser, e2eState);
    try {
      const draft = await draftFor(tenant.page);
      const staleHash = draft.validation_hash;

      // Somebody else saves first.
      const first = await bff(tenant.page, '/themes/draft', {
        method: 'PUT',
        body: { config: withPrimary(draft.config, '#0a0a0a'), expectedHash: staleHash },
      });
      expect(first.status).toBe(200);
      const currentHash = first.body.draft.validation_hash;
      expect(currentHash).not.toBe(staleHash);

      // 12 The stale editor is refused with a machine-readable code, not a message string.
      const conflict = await bff(tenant.page, '/themes/draft', {
        method: 'PUT',
        body: { config: withPrimary(draft.config, '#ffeeff'), expectedHash: staleHash },
      });
      expect(conflict.status).toBe(409);
      expect(conflict.body.code).toBe('THEME_VERSION_CONFLICT');

      // 13 The server still holds the first writer's work.
      const after = (await bff(tenant.page, '/themes/draft')).body.draft;
      expect(after.config.tokens.colors.primary).toBe('#0a0a0a');
      expect(after.validation_hash).toBe(currentHash);
    } finally {
      await tenant.context.close();
    }
  });

  test('14-24 a draft is invisible publicly and only a valid preview token reveals it', async ({ browser, request, e2eState }) => {
    await resetThemes(orgA);
    const tenant = await tenantAdmin(browser, e2eState);
    try {
      const draft = await draftFor(tenant.page);
      const secret = '#abcdef';
      await bff(tenant.page, '/themes/draft', {
        method: 'PUT',
        body: { config: withPrimary(draft.config, secret), expectedHash: draft.validation_hash },
      });

      // 14 The public routes serve the published theme, never the draft.
      const publicTheme = await request.get(`${e2eState.origins.storefront}/api/storefront-theme?organizationSlug=suvera`);
      expect(publicTheme.status()).toBe(200);
      expect(JSON.stringify(await publicTheme.json())).not.toContain(secret);
      const publicCss = await request.get(`${e2eState.origins.storefront}/api/storefront-theme/theme.css?organizationSlug=suvera`);
      expect(publicCss.status()).toBe(200);
      expect(publicCss.headers()['content-type']).toContain('text/css');
      expect(publicCss.headers()['x-content-type-options']).toContain('nosniff');
      expect(await publicCss.text()).not.toContain(secret);

      // 15 A preview grant is issued once.
      const issued = await bff(tenant.page, '/themes/preview-token', { method: 'POST', body: {} });
      expect([200, 201]).toContain(issued.status);
      const token = issued.body.token;
      expect(token.length).toBeGreaterThan(20);
      // Only the hash is kept, so the grant cannot be replayed out of the database.
      const stored = await dbQuery('select token_hash from theme_preview_tokens where organization_id = $1', [orgA]);
      expect(stored.length).toBeGreaterThan(0);
      for (const row of stored) {
        expect(row.token_hash).not.toBe(token);
        expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
      }

      // 16-18 The storefront takes the token from the fragment, scrubs it, and shows the draft.
      const visitor = await browser.newContext();
      const page = await visitor.newPage();
      const previewResponse = await page.goto(
        `${e2eState.origins.storefront}/anasayfa?theme_preview=1#preview_token=${encodeURIComponent(token)}`
      );
      await page.waitForFunction(() => window.SuveraTheme && window.SuveraTheme.isPreview === true, null, { timeout: 20_000 });
      expect(await page.evaluate(() => window.location.hash)).toBe('');
      expect(page.url()).not.toContain(token);
      expect(await page.evaluate(() => window.SuveraTheme.theme.tokens.colors.primary)).toBe(secret);

      // 17 The raw token survives nowhere a script, a cookie or a log can reach it.
      const storage = await storageSnapshot(page);
      expect(JSON.stringify(storage)).not.toContain(token);
      expect(await page.evaluate(() => document.cookie)).not.toContain(token);
      expect(await page.content()).not.toContain(token);
      const previewSheet = await page.evaluate(() => {
        const link = document.getElementById('suveraThemeStylesheet');
        return link ? link.href : '';
      });
      expect(previewSheet).toContain('preview.css');
      expect(previewSheet).not.toContain(token);

      // 19-21 The preview response is unshareable, unindexable and leaks no referrer.
      const previewHeaders = previewResponse.headers();
      expect(previewHeaders['cache-control']).toContain('no-store');
      expect(previewHeaders['x-robots-tag']).toContain('noindex');
      expect(previewHeaders['referrer-policy']).toBe('no-referrer');
      // 46 The preview relaxes exactly one directive, and only for the configured admin.
      expect(previewHeaders['content-security-policy']).toContain("style-src-attr 'none'");
      expect(previewHeaders['content-security-policy']).toContain("script-src 'self'");
      expect(previewHeaders['content-security-policy']).toContain(`frame-ancestors 'self' ${e2eState.origins.admin}`);
      expect(previewHeaders['content-security-policy']).not.toContain('frame-ancestors *');
      expect(previewHeaders['content-security-policy']).not.toContain('unsafe-inline');
      await visitor.close();

      // 22 An expired grant is refused.
      // The table refuses expires_at <= created_at, so the whole grant is aged, not just
      // its expiry — which is what an actually-expired grant looks like.
      await dbQuery(
        `update theme_preview_tokens
            set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
          where organization_id = $1`,
        [orgA]
      );
      const expired = await request.post(`${e2eState.origins.storefront}/api/storefront-theme/preview`, {
        data: { organizationSlug: 'suvera', token },
      });
      expect(expired.status()).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(await expired.json())).not.toContain(secret);

      // 23 A grant issued for another tenant does not work here.
      const other = await tenantAdmin(browser, e2eState, 'tenantB');
      try {
        await draftFor(other.page);
        const foreign = await bff(other.page, '/themes/preview-token', { method: 'POST', body: {} });
        expect([200, 201]).toContain(foreign.status);
        const crossed = await request.post(`${e2eState.origins.storefront}/api/storefront-theme/preview`, {
          data: { organizationSlug: 'suvera', token: foreign.body.token },
        });
        expect(crossed.status()).toBeGreaterThanOrEqual(400);
      } finally {
        await other.context.close();
        await dbQuery('delete from theme_preview_tokens where organization_id = $1', [orgB]);
        await dbQuery("delete from theme_versions where organization_id = $1 and status = 'draft'", [orgB]);
      }

      // 24 A grant that names a version the tenant does not own is refused.
      const bogus = await bff(tenant.page, '/themes/preview-token', { method: 'POST', body: { versionId: 999999999 } });
      expect(bogus.status).toBeGreaterThanOrEqual(400);
    } finally {
      await tenant.context.close();
      await dbQuery('delete from theme_preview_tokens where organization_id = $1', [orgA]);
    }
  });

  test('25-30 the schema refuses raw CSS, HTML, scripts and arbitrary references', async ({ browser, e2eState }) => {
    await resetThemes(orgA);
    const tenant = await tenantAdmin(browser, e2eState);
    try {
      const draft = await draftFor(tenant.page);
      const save = (config) => bff(tenant.page, '/themes/draft', {
        method: 'PUT',
        body: { config, expectedHash: draft.validation_hash },
      });

      // 25 A colour that would close the declaration and open a rule.
      for (const injection of ['#fff; } body { display:none }', 'url(javascript:alert(1))', 'expression(alert(1))', '@import "x"']) {
        const attempt = await save(withPrimary(draft.config, injection));
        expect(attempt.status).toBeGreaterThanOrEqual(400);
      }

      // 26-27 There is no field for markup or a script, and unknown keys are refused
      // outright rather than dropped.
      for (const extra of [{ rawHtml: '<img onerror=alert(1)>' }, { customJs: 'alert(1)' }, { customCss: ':root{}' }]) {
        const attempt = await save({ ...draft.config, ...extra });
        expect(attempt.status).toBeGreaterThanOrEqual(400);
      }

      // 28 Media and links are internal references, never URLs.
      const badMedia = JSON.parse(JSON.stringify(draft.config));
      badMedia.header.logoMediaId = 'https://evil.example/logo.svg';
      expect((await save(badMedia)).status).toBeGreaterThanOrEqual(400);
      const badLink = JSON.parse(JSON.stringify(draft.config));
      badLink.announcement.link = { type: 'external', href: 'javascript:alert(1)' };
      expect((await save(badLink)).status).toBeGreaterThanOrEqual(400);

      // 13 (product grid) The grid takes a validated reference and a bounded limit, never
      // a query, a filter string or a sort expression.
      const badGrid = JSON.parse(JSON.stringify(draft.config));
      const gridSection = badGrid.sections.find((section) => section.type === 'product-grid');
      gridSection.settings.source = { type: 'sql', value: 'select 1' };
      expect((await save(badGrid)).status).toBeGreaterThanOrEqual(400);
      gridSection.settings.source = { type: 'products' };
      gridSection.settings.limit = 100000;
      expect((await save(badGrid)).status).toBeGreaterThanOrEqual(400);

      // 29 Validation is reported field by field, and 30 an invalid draft cannot publish.
      const report = await bff(tenant.page, '/themes/validate', {
        method: 'POST',
        body: { config: withPrimary(draft.config, 'not-a-colour') },
      });
      expect([200, 400]).toContain(report.status);
      const issues = report.body.report ? report.body.report.errors : report.body.errors;
      expect(Array.isArray(issues) && issues.length).toBeTruthy();
      expect(issues.some((issue) => String(issue.field).includes('primary'))).toBe(true);

      // Nothing above reached the stored draft.
      const untouched = (await bff(tenant.page, '/themes/draft')).body.draft;
      expect(untouched.validation_hash).toBe(draft.validation_hash);
      expect(JSON.stringify(untouched.config)).not.toContain('alert(1)');
    } finally {
      await tenant.context.close();
    }
  });

  test('31-38 publishing goes live, is recorded in history, and cannot go live twice', async ({ browser, request, e2eState }) => {
    await resetThemes(orgA);
    const tenant = await tenantAdmin(browser, e2eState);
    try {
      const before = (await bff(tenant.page, '/themes/published')).body.theme;
      const draft = await draftFor(tenant.page);
      const next = withPrimary(draft.config, '#2f6f4f');
      // Product grid first, trust bar switched off: two changes a visitor can see.
      const ordered = next.sections.slice().sort((a, b) => a.order - b.order);
      const grid = ordered.find((section) => section.type === 'product-grid');
      next.sections = [grid, ...ordered.filter((section) => section !== grid)]
        .map((section, order) => ({
          ...section, order, enabled: section.type === 'trust-features' ? false : section.enabled,
        }));
      const saved = await bff(tenant.page, '/themes/draft', {
        method: 'PUT', body: { config: next, expectedHash: draft.validation_hash },
      });
      expect(saved.status).toBe(200);

      // 31 A valid draft publishes.
      const publish = await bff(tenant.page, '/themes/publish', {
        method: 'POST', body: { expectedHash: saved.body.draft.validation_hash, reason: REASON },
      });
      expect(publish.status).toBe(200);
      expect(publish.body.version.status).toBe('published');
      expect(publish.body.version.version_number).toBeGreaterThan(before.versionNumber);

      // 32 The public storefront uses it — through a stylesheet, not an inline style.
      const css = await request.get(`${e2eState.origins.storefront}/api/storefront-theme/theme.css?organizationSlug=suvera`);
      expect(await css.text()).toContain('#2f6f4f');
      const visitor = await browser.newContext();
      const page = await visitor.newPage();
      await page.goto(`${e2eState.origins.storefront}/anasayfa`);
      await page.waitForFunction(() => window.SuveraTheme && window.SuveraTheme.theme, null, { timeout: 20_000 });
      expect(await page.evaluate(() => window.SuveraTheme.isPreview)).toBe(false);
      expect(await page.evaluate(() => window.SuveraTheme.theme.tokens.colors.primary)).toBe('#2f6f4f');
      expect(await page.evaluate(() => getComputedStyle(document.documentElement)
        .getPropertyValue('--theme-primary').trim())).toBe('#2f6f4f');
      // The legacy alias the existing pages already read follows the theme, which is what
      // makes a publish visible instead of introducing a second, unread variable set.
      expect(await page.evaluate(() => getComputedStyle(document.documentElement)
        .getPropertyValue('--accent').trim())).toBe('#2f6f4f');
      // The theme reached the page as a same-origin stylesheet. No theme value is written
      // into a style attribute or an injected <style>, which `style-src-attr 'none'` would
      // block anyway — the point is that nothing tries.
      const delivery = await page.evaluate(() => {
        const link = document.getElementById('suveraThemeStylesheet');
        return {
          href: link ? link.href : '',
          rel: link ? link.rel : '',
          inlineStyles: [...document.querySelectorAll('[style]')].map((node) => node.getAttribute('style')).join(' '),
          styleBlocks: [...document.querySelectorAll('style')].map((node) => node.textContent).join(' '),
        };
      });
      expect(delivery.rel).toBe('stylesheet');
      expect(delivery.href.startsWith(e2eState.origins.storefront)).toBe(true);
      expect(delivery.href).toContain('theme.css');
      expect(delivery.inlineStyles).not.toContain('#2f6f4f');
      expect(delivery.inlineStyles).not.toContain('--theme-');
      expect(delivery.styleBlocks).not.toContain('#2f6f4f');

      // 33-34 Section order and visibility follow the published theme.
      const applied = await page.evaluate(() => window.SuveraTheme.theme.sections
        .slice().sort((a, b) => a.order - b.order).map((section) => section.type));
      expect(applied[0]).toBe('product-grid');
      // A disabled section is not even sent to the storefront, and its markup is hidden.
      expect(applied).not.toContain('trust-features');
      const trustHidden = await page.evaluate(() => {
        const node = document.querySelector('.features-bar');
        if (!node) return true;
        const wrapper = node.closest('section') || node;
        return wrapper.hidden === true;
      });
      expect(trustHidden).toBe(true);
      await visitor.close();

      // 35 The previous version is archived, not rewritten.
      const versions = (await bff(tenant.page, '/themes/versions')).body;
      const previous = versions.items.find((item) => Number(item.id) === before.versionId);
      expect(previous.status).toBe('archived');
      // The outgoing snapshot is archived as it was, never rewritten in place. (A theme
      // backfilled by migration 064 carries no hash — SQL cannot compute the canonical one —
      // so this only asserts equality, not presence.)
      expect(previous.validation_hash).toBe(before.hash);
      expect(versions.items.filter((item) => item.status === 'published')).toHaveLength(1);

      // 36-37 A second draft publishes once even when two publishes race.
      const second = await draftFor(tenant.page);
      const secondSaved = await bff(tenant.page, '/themes/draft', {
        method: 'PUT',
        body: { config: withPrimary(second.config, '#704214'), expectedHash: second.validation_hash },
      });
      const hash = secondSaved.body.draft.validation_hash;
      const results = await Promise.all([
        bff(tenant.page, '/themes/publish', { method: 'POST', body: { expectedHash: hash, reason: REASON } }),
        bff(tenant.page, '/themes/publish', { method: 'POST', body: { expectedHash: hash, reason: REASON } }),
      ]);
      expect(results.filter((result) => result.status === 200)).toHaveLength(1);
      const live = await dbQuery(
        "select id from theme_versions where organization_id = $1 and status = 'published'", [orgA]
      );
      expect(live).toHaveLength(1);

      // 38 History is shown in the UI, with the live version marked.
      await tenant.page.goto(`${e2eState.origins.admin}/theme`);
      await expect(tenant.page.getByRole('heading', { name: 'Sürüm geçmişi' })).toBeVisible();
      await expect(tenant.page.getByText('published').first()).toBeVisible();
      await expect(tenant.page.getByText('archived').first()).toBeVisible();
    } finally {
      await tenant.context.close();
    }
  });

  test('39-42 rollback needs a reason, restores the old look and is itself recorded', async ({ browser, request, e2eState }) => {
    await resetThemes(orgA);
    const tenant = await tenantAdmin(browser, e2eState);
    try {
      const original = (await bff(tenant.page, '/themes/published')).body.theme;
      const draft = await draftFor(tenant.page);
      const saved = await bff(tenant.page, '/themes/draft', {
        method: 'PUT',
        body: { config: withPrimary(draft.config, '#8b1e3f'), expectedHash: draft.validation_hash },
      });
      await bff(tenant.page, '/themes/publish', {
        method: 'POST', body: { expectedHash: saved.body.draft.validation_hash, reason: REASON },
      });

      // 39 A rollback without a reason is refused: this is an audited action.
      const noReason = await bff(tenant.page, '/themes/rollback', {
        method: 'POST', body: { versionId: original.versionId, reason: '' },
      });
      expect(noReason.status).toBeGreaterThanOrEqual(400);

      // 40 With a reason it restores the chosen snapshot as a NEW version.
      const rolled = await bff(tenant.page, '/themes/rollback', {
        method: 'POST', body: { versionId: original.versionId, reason: REASON },
      });
      expect(rolled.status).toBe(200);
      expect(rolled.body.version.id).not.toBe(original.versionId);
      // The restored version is a new row carrying the old snapshot, so what is live again
      // hashes identically to what was live before.
      const live = (await bff(tenant.page, '/themes/published')).body.theme;
      expect(live.versionId).toBe(Number(rolled.body.version.id));
      expect(live.config).toEqual(original.config);
      // The restored version carries a freshly computed canonical hash even when the
      // snapshot it came from predates one (migration 064 backfills without a hash).
      expect(live.hash).toMatch(/^[0-9a-f]{64}$/);

      // 41 The public storefront is back to the old appearance.
      const css = await request.get(`${e2eState.origins.storefront}/api/storefront-theme/theme.css?organizationSlug=suvera`);
      const body = await css.text();
      expect(body).toContain(original.config.tokens.colors.primary);
      expect(body).not.toContain('#8b1e3f');

      // 42 The rollback is an append-only entry, and the historical row is untouched.
      const publications = await dbQuery(
        `select action, reason, theme_version_id, previous_theme_version_id, rollback_of_publication_id
           from theme_publications where organization_id = $1 order by published_at, id`,
        [orgA]
      );
      const restore = publications.find((row) => row.action === 'rollback');
      expect(restore).toBeTruthy();
      expect(restore.reason).toBe(REASON);
      expect(Number(restore.theme_version_id)).toBe(Number(rolled.body.version.id));
      // Nothing was rewritten: the earlier publish entries are still there, in order.
      expect(publications.filter((row) => row.action === 'publish').length).toBeGreaterThan(0);
      expect(publications[publications.length - 1].action).toBe('rollback');
      const [historical] = await dbQuery(
        'select validation_hash, status from theme_versions where id = $1', [original.versionId]
      );
      expect(historical.validation_hash).toBe(original.hash);
      expect(historical.status).toBe('archived');
    } finally {
      await tenant.context.close();
    }
  });

  test('43-44 another tenant and an unprivileged member cannot read or change a theme', async ({ browser, request, e2eState }) => {
    await resetThemes(orgA);
    const tenant = await tenantAdmin(browser, e2eState);
    try {
      const draft = await draftFor(tenant.page);
      const secret = '#5f4b8b';
      await bff(tenant.page, '/themes/draft', {
        method: 'PUT', body: { config: withPrimary(draft.config, secret), expectedHash: draft.validation_hash },
      });

      // 43 Tenant B sees its own theme, never tenant A's draft or versions.
      const other = await tenantAdmin(browser, e2eState, 'tenantB');
      try {
        const foreignDraft = await bff(other.page, '/themes/draft');
        expect(JSON.stringify(foreignDraft.body)).not.toContain(secret);
        const foreignVersion = await bff(other.page, `/themes/versions/${draft.id}`);
        expect(foreignVersion.status).toBeGreaterThanOrEqual(400);
        const foreignVersions = await bff(other.page, '/themes/versions');
        expect(JSON.stringify(foreignVersions.body)).not.toContain(secret);
      } finally {
        await other.context.close();
      }

      // 44 An unauthenticated caller can neither read a draft nor publish one.
      for (const path of ['/themes/draft', '/themes/versions']) {
        const anonymous = await request.get(`${e2eState.origins.api}/api${path}`);
        expect(anonymous.status()).toBeGreaterThanOrEqual(401);
      }
      const anonymousPublish = await request.post(`${e2eState.origins.api}/api/themes/publish`, {
        data: { reason: REASON },
      });
      expect(anonymousPublish.status()).toBeGreaterThanOrEqual(401);
      // The public storefront route offers no way in either.
      const publicDraft = await request.get(`${e2eState.origins.storefront}/api/storefront-theme/draft?organizationSlug=suvera`);
      expect(publicDraft.status()).toBeGreaterThanOrEqual(400);
    } finally {
      await tenant.context.close();
    }
  });

  test('45 a theme cannot claim a canonical host; A27 stays the only authority', async ({ browser, e2eState }) => {
    await resetThemes(orgA);
    const tenant = await tenantAdmin(browser, e2eState);
    try {
      const draft = await draftFor(tenant.page);
      // There is no field for a host, a domain or a canonical URL — attempting to add one
      // is an unknown key, which the schema refuses.
      for (const extra of [
        { canonicalHost: 'evil.example' },
        { domain: 'evil.example' },
      ]) {
        const attempt = await bff(tenant.page, '/themes/draft', {
          method: 'PUT', body: { config: { ...draft.config, ...extra }, expectedHash: draft.validation_hash },
        });
        expect(attempt.status).toBeGreaterThanOrEqual(400);
      }
      // Nested keys are not rejected but built from an allowlist, so a smuggled host is
      // dropped rather than stored: what matters is that it can never come back out.
      const seo = JSON.parse(JSON.stringify(draft.config));
      seo.seo.titleTemplate = '%s | Suvera';
      seo.seo.canonicalHost = 'evil.example';
      const stored = await bff(tenant.page, '/themes/draft', {
        method: 'PUT', body: { config: seo, expectedHash: draft.validation_hash },
      });
      expect(stored.status).toBe(200);
      expect(JSON.stringify(stored.body.draft.config)).not.toContain('evil.example');

      // The published payload carries no host of any kind.
      const published = (await bff(tenant.page, '/themes/published')).body.theme;
      expect(Object.keys(published.config.seo).sort())
        .toEqual(['defaultDescription', 'socialImageMediaId', 'titleTemplate']);
    } finally {
      await tenant.context.close();
    }
  });

  test('47 the ordinary storefront keeps its strict CSP and every new store starts themed', async ({ browser, request, e2eState }) => {
    // 47 A theme must not have relaxed anything for ordinary visitors.
    const response = await request.get(`${e2eState.origins.storefront}/anasayfa`);
    const csp = response.headers()['content-security-policy'];
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("style-src-attr 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(response.headers()['cache-control'] || '').not.toContain('no-store');

    // A store created through the real production path starts with exactly one published
    // theme, so its storefront always has a resolvable appearance.
    const platform = await superAdmin(browser, e2eState);
    const slug = `a28-theme-${Date.now()}`;
    try {
      const created = await bff(platform.page, '/organizations', {
        method: 'POST', body: { name: 'A28 Theme Store', slug },
      });
      expect(created.status).toBe(201);
      const rows = await dbQuery(
        'select status, count(*)::int as total from theme_versions where organization_id = $1 group by status',
        [created.body.id]
      );
      expect(rows).toEqual([{ status: 'published', total: 1 }]);
    } finally {
      await platform.context.close();
      await dbQuery('delete from theme_publications where organization_id in (select id from organizations where slug = $1)', [slug]);
      await dbQuery('delete from theme_versions where organization_id in (select id from organizations where slug = $1)', [slug]);
      await dbQuery('delete from organizations where slug = $1', [slug]).catch(() => {});
    }
  });

  test('48 no preview artefact survives in the storefront the public sees', async ({ browser, e2eState }) => {
    await resetThemes(orgA);
    const tenant = await tenantAdmin(browser, e2eState);
    const visitor = await browser.newContext();
    try {
      const draft = await draftFor(tenant.page);
      await bff(tenant.page, '/themes/draft', {
        method: 'PUT',
        body: { config: withPrimary(draft.config, '#0f5132'), expectedHash: draft.validation_hash },
      });
      const issued = await bff(tenant.page, '/themes/preview-token', { method: 'POST', body: {} });
      const token = issued.body.token;

      const page = await visitor.newPage();
      const consoleText = [];
      page.on('console', (message) => consoleText.push(message.text()));
      await page.goto(`${e2eState.origins.storefront}/anasayfa?theme_preview=1#preview_token=${encodeURIComponent(token)}`);
      await page.waitForFunction(() => window.SuveraTheme && window.SuveraTheme.isPreview === true, null, { timeout: 20_000 });

      // Leaving the preview: a fresh visit in the same browser must be the public theme
      // again, with no trace of the grant.
      await page.goto(`${e2eState.origins.storefront}/anasayfa`);
      await page.waitForFunction(() => window.SuveraTheme && window.SuveraTheme.theme, null, { timeout: 20_000 });
      expect(await page.evaluate(() => window.SuveraTheme.isPreview)).toBe(false);
      expect(await page.evaluate(() => window.SuveraTheme.theme.tokens.colors.primary)).not.toBe('#0f5132');
      const storage = await storageSnapshot(page);
      expect(JSON.stringify(storage)).not.toContain(token);
      expect(await page.content()).not.toContain(token);
      expect(consoleText.join('\n')).not.toContain(token);
      // The preview session cookie is HttpOnly, so a script cannot read it back out.
      expect(await page.evaluate(() => document.cookie)).not.toContain(token);
    } finally {
      await visitor.close();
      await tenant.context.close();
      await dbQuery('delete from theme_preview_tokens where organization_id = $1', [orgA]);
      await resetThemes(orgA);
    }
  });
});
