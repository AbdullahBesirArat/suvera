'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { API_DIR } = require('./state.cjs');

const panelyaRequire = createRequire(path.join(API_DIR, 'package.json'));
const { Client, Pool } = panelyaRequire('pg');
const bcrypt = panelyaRequire('bcryptjs');

function docker(args, options = {}) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function secret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function urlWithUser(base, username, password) {
  const url = new URL(base);
  url.username = username;
  url.password = password;
  return url.toString();
}

async function waitForPostgres(container) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      docker(['exec', container, 'pg_isready', '-U', 'postgres', '-d', 'panelya_e2e']);
      return;
    } catch (_) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error('Disposable PostgreSQL did not become ready');
}

async function waitForHostPostgres(adminUrl) {
  let consecutiveSuccesses = 0;
  let lastError;
  for (let attempt = 0; attempt < 60 && consecutiveSuccesses < 3; attempt += 1) {
    const client = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 2_000 });
    try {
      await client.connect();
      await client.query('select 1');
      consecutiveSuccesses += 1;
    } catch (error) {
      lastError = error;
      consecutiveSuccesses = 0;
    } finally {
      await client.end().catch(() => {});
    }
    if (consecutiveSuccesses < 3) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (consecutiveSuccesses < 3) {
    throw new Error(`Disposable PostgreSQL host port did not stabilize${lastError ? `: ${lastError.message}` : ''}`);
  }
}

async function provisionDatabase(adminUrl, passwords) {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query('create extension if not exists pgcrypto');
    await admin.query('create extension if not exists pg_trgm');
    await admin.query('create extension if not exists unaccent');
    await admin.query(`
      create role panelya_migrator login nosuperuser nobypassrls nocreatedb nocreaterole;
      create role panelya_runtime login nosuperuser nobypassrls nocreatedb nocreaterole;
      create role panelya_rls_bypass nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole;
      create role panelya_system_runtime login noinherit nosuperuser nobypassrls nocreatedb nocreaterole;
      grant panelya_rls_bypass to panelya_system_runtime;
      grant create, usage on schema public to panelya_migrator;
      alter default privileges for role panelya_migrator in schema public
        grant select, insert, update, delete on tables to panelya_runtime, panelya_system_runtime;
      alter default privileges for role panelya_migrator in schema public
        grant usage, select on sequences to panelya_runtime, panelya_system_runtime;
    `);
    for (const [role, password] of Object.entries({
      panelya_migrator: passwords.migrator,
      panelya_runtime: passwords.runtime,
      panelya_system_runtime: passwords.system,
    })) {
      await admin.query(`alter role ${admin.escapeIdentifier(role)} password ${admin.escapeLiteral(password)}`);
    }

    const migrationUrl = urlWithUser(adminUrl, 'panelya_migrator', passwords.migrator);
    const migrator = new Pool({ connectionString: migrationUrl, max: 1 });
    try {
      const schema = fs.readFileSync(path.join(API_DIR, 'db', 'schema.sql'), 'utf8')
        .replace(/create extension[^;]*;/gi, '');
      await migrator.query(schema);
      process.env.MIGRATION_DATABASE_URL = migrationUrl;
      const { runMigrations } = require(path.join(API_DIR, 'scripts', 'run-migrations.js'));
      await runMigrations({ pool: migrator, logger: { log() {}, warn() {} } });
      await runMigrations({ pool: migrator, logger: { log() {}, warn() {} } });
    } finally {
      await migrator.end();
    }

    await admin.query(`
      revoke create on schema public from public;
      grant usage on schema public to panelya_runtime, panelya_system_runtime;
      grant select, insert, update, delete on all tables in schema public to panelya_runtime, panelya_system_runtime;
      grant usage, select on all sequences in schema public to panelya_runtime, panelya_system_runtime;
    `);
  } finally {
    await admin.end();
  }
}

function generatedPassword() {
  return `E2E-${secret(18)}-Aa9!`;
}

async function insertProduct(client, organizationId, categoryId, index, { race = false } = {}) {
  const name = index === 0 ? 'İpek Şal İstanbul' : race ? 'Son Stok Test Ürünü' : `Suvera E2E Ürün ${String(index + 1).padStart(2, '0')}`;
  const price = 150 + index * 25;
  const colors = race ? ['Lacivert'] : index % 2 ? ['Kırmızı', 'Siyah'] : ['Siyah', 'Kırmızı'];
  const sizes = race ? ['M'] : index % 3 ? ['M', 'L'] : ['S', 'M'];
  const perVariant = race ? 1 : 5;
  const totalStock = colors.length * perVariant;
  const product = await client.query(
    `insert into products
       (organization_id, name, category_id, price, sale_price, stock, status, colors, sizes,
        images, details, tags, description, emoji, product_story, featured_in_category)
     values ($1,$2,$3,$4,null,$5,'active',$6::jsonb,$7::jsonb,'[]'::jsonb,$8::jsonb,$9,$10,$11,$12,$13)
     returning id`,
    [organizationId, name, categoryId, price, totalStock, JSON.stringify(colors), JSON.stringify(sizes),
      JSON.stringify({ short_description: 'Sentetik E2E katalog ürünü', fabric_info: 'Test kumaşı' }),
      index === 0 ? 'ipek,şal,istanbul' : 'e2e,koleksiyon', 'Tamamen sentetik test ürünü.', index === 0 ? '🧣' : '👗',
      'E2E ürün hikayesi', index < 4]
  );
  const variantIds = [];
  for (let colorIndex = 0; colorIndex < colors.length; colorIndex += 1) {
    const variant = await client.query(
      `insert into product_variants
         (organization_id, product_id, color, size, sku, stock, status, is_active, is_default,
          on_hand, reserved, incoming, low_stock_threshold)
       values ($1,$2,$3,$4,$5,$6,'active',true,$7,$6,0,0,1)
       returning id`,
      [organizationId, product.rows[0].id, colors[colorIndex], sizes[colorIndex % sizes.length],
        `E2E-A-${index + 1}-${colorIndex + 1}`, perVariant, colorIndex === 0]
    );
    variantIds.push(variant.rows[0].id);
    await client.query(
      `insert into inventory_movements
         (organization_id, variant_id, movement_type, quantity_delta, on_hand_delta, reserved_delta,
          balance_after, on_hand_after, reserved_after, reference_type, reference_id,
          idempotency_key, reason, actor_type)
       values ($1,$2,'initial',$3,$3,0,$3,$3,0,'e2e','seed',$4,'E2E initial stock','system')`,
      [organizationId, variant.rows[0].id, perVariant, `e2e-seed:${variant.rows[0].id}`]
    );
  }
  return { id: product.rows[0].id, variantId: variantIds[0], name, price };
}

async function seedFixtures(adminUrl) {
  const credentials = {
    tenantA: { email: 'owner.a@example.test', password: generatedPassword(), slug: 'suvera' },
    tenantB: { email: 'owner.b@example.test', password: generatedPassword(), slug: 'e2e-tenant-b' },
    customerA: { email: 'customer.a@example.test', password: generatedPassword() },
    customerB: { email: 'customer.b@example.test', password: generatedPassword() },
    superAdmin: { username: 'superadmin@example.test', password: generatedPassword() },
  };
  const publicAccessToken = secret(32);
  const ownerHashes = await Promise.all([
    // The BFF timeout probe is intentionally only 250 ms in this suite. Cost 4 keeps
    // disposable credentials deterministic on loaded CI hosts while exercising the same
    // bcrypt verification path; production hashing policy is untouched.
    bcrypt.hash(credentials.tenantA.password, 4),
    bcrypt.hash(credentials.tenantB.password, 4),
    bcrypt.hash(credentials.customerA.password, 4),
    bcrypt.hash(credentials.customerB.password, 4),
    bcrypt.hash(credentials.superAdmin.password, 4),
  ]);

  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query('begin');
    const orgA = await client.query(
      `update organizations
          set name='Suvera E2E', plan='growth', status='active', public_access_token=$1,
              store_settings=$2::jsonb, updated_at=now()
        where slug='suvera'
        returning id`,
      [publicAccessToken, JSON.stringify({
        paymentEnabled: true,
        shippingFee: 49.9,
        freeShippingThreshold: 1000,
        iban: 'TR120000000000000000000000',
        ibanHolderName: 'Suvera E2E',
        bankName: 'Test Bankası',
      })]
    );
    const orgB = await client.query(
      `insert into organizations (name, slug, plan, status, store_settings)
       values ('Tenant B E2E','e2e-tenant-b','growth','active','{}'::jsonb)
       returning id`
    );
    const orgAId = orgA.rows[0].id;
    const orgBId = orgB.rows[0].id;

    const ownerA = await client.query(
      `insert into app_users (email,name,password_hash,email_verified_at) values ($1,'Tenant A Owner',$2,now()) returning id`,
      [credentials.tenantA.email, ownerHashes[0]]
    );
    const ownerB = await client.query(
      `insert into app_users (email,name,password_hash,email_verified_at) values ($1,'Tenant B Owner',$2,now()) returning id`,
      [credentials.tenantB.email, ownerHashes[1]]
    );
    await client.query(
      `insert into memberships (organization_id,user_id,role,status)
       values ($1,$2,'owner','active'),($3,$4,'owner','active')`,
      [orgAId, ownerA.rows[0].id, orgBId, ownerB.rows[0].id]
    );
    await client.query('update organizations set owner_user_id=$1 where id=$2', [ownerA.rows[0].id, orgAId]);
    await client.query('update organizations set owner_user_id=$1 where id=$2', [ownerB.rows[0].id, orgBId]);
    await client.query(
      `insert into admins (username,password_hash,role) values ($1,$2,'super_admin')`,
      [credentials.superAdmin.username, ownerHashes[4]]
    );

    const categoryA = await client.query(
      `insert into categories (organization_id,name,slug) values ($1,'Yaz Koleksiyonu','yaz-koleksiyonu') returning id`,
      [orgAId]
    );
    const categoryB = await client.query(
      `insert into categories (organization_id,name,slug) values ($1,'Tenant B Kategori','tenant-b-kategori') returning id`,
      [orgBId]
    );

    // Migration 064 intentionally preserves the three-section legacy homepage. The
    // storefront regression below exercises the category-slider renderer, so make that
    // section explicit in this disposable tenant instead of relying on invented/static
    // category markup. Production theme snapshots are never rewritten by this fixture.
    const themeService = require(path.join(API_DIR, 'modules', 'themes', 'service.js'));
    const publishedTheme = await themeService.resolvePublishedTheme(client, orgAId);
    if (publishedTheme && !publishedTheme.config.sections.some((section) => section.type === 'category-slider')) {
      const draftTheme = await themeService.createDraft(client, { organizationId: orgAId });
      const config = draftTheme.config;
      const productSectionIndex = config.sections.findIndex((section) => section.type === 'product-grid');
      const insertAt = productSectionIndex >= 0 ? productSectionIndex + 1 : config.sections.length;
      config.sections.splice(insertAt, 0, {
        id: 'categories', type: 'category-slider', enabled: true, order: insertAt,
        settings: { categoryIds: [String(categoryA.rows[0].id)], limit: 8 },
      });
      config.sections.forEach((section, index) => { section.order = index; });
      const savedTheme = await themeService.saveDraft(client, {
        organizationId: orgAId, config, expectedHash: draftTheme.validation_hash,
      });
      await themeService.publishDraft(client, {
        organizationId: orgAId, expectedHash: savedTheme.validation_hash, reason: 'E2E category renderer fixture',
      });
    }

    const productsA = [];
    for (let index = 0; index < 26; index += 1) {
      productsA.push(await insertProduct(client, orgAId, categoryA.rows[0].id, index));
    }
    const raceProduct = await insertProduct(client, orgAId, categoryA.rows[0].id, 26, { race: true });

    // A31: the size-guide dialog is part of the accessibility acceptance, so the suite
    // seeds a real active guide and attaches it to tenant A's first product through the
    // ordinary product_size_guides override. Without this the dialog never renders and the
    // test could only skip itself, which would hide a regression rather than catch one.
    const sizeGuide = await client.query(
      `insert into size_guides
         (organization_id, name, description, measurement_unit, columns, rows, status)
       values ($1, 'E2E Beden Rehberi', 'Playwright erisilebilirlik testi icin olcu tablosu',
               'cm',
               '[{"key":"gogus","label":"Gogus"},{"key":"bel","label":"Bel"}]'::jsonb,
               '[{"label":"S","cells":{"gogus":"86","bel":"68"}},
                 {"label":"M","cells":{"gogus":"92","bel":"74"}}]'::jsonb,
               'active')
       returning id`,
      [orgAId]
    );
    await client.query(
      `insert into product_size_guides (organization_id, product_id, size_guide_id)
       values ($1, $2, $3)`,
      [orgAId, productsA[0].id, sizeGuide.rows[0].id]
    );
    const productB = await client.query(
      `insert into products
         (organization_id,name,category_id,price,stock,status,colors,sizes,images,details,tags,description,emoji)
       values ($1,'Tenant B Gizli Ürün',$2,999,3,'active','["Gri"]'::jsonb,'["M"]'::jsonb,
               '[]'::jsonb,'{}'::jsonb,'tenant-b','Tenant B sentetik ürün','🧥') returning id`,
      [orgBId, categoryB.rows[0].id]
    );
    const variantB = await client.query(
      `insert into product_variants
         (organization_id,product_id,color,size,sku,stock,status,is_active,is_default,on_hand,reserved,incoming,low_stock_threshold)
       values ($1,$2,'Gri','M','E2E-B-1',3,'active',true,true,3,0,0,1) returning id`,
      [orgBId, productB.rows[0].id]
    );

    const customerA = await client.query(
      `insert into customers (organization_id,name,email,phone,address)
       values ($1,'Tenant A Customer',$2,'05550000001','İstanbul Test Adresi') returning id`,
      [orgAId, credentials.customerA.email]
    );
    const customerB = await client.query(
      `insert into customers (organization_id,name,email,phone,address)
       values ($1,'Tenant B Customer',$2,'05550000002','Ankara Test Adresi') returning id`,
      [orgBId, credentials.customerB.email]
    );
    await client.query(
      `insert into customer_accounts
         (organization_id,customer_id,email,name,phone,password_hash,email_verified_at)
       values ($1,$2,$3,'Tenant A Customer','05550000001',$4,now()),
              ($5,$6,$7,'Tenant B Customer','05550000002',$8,now())`,
      [orgAId, customerA.rows[0].id, credentials.customerA.email, ownerHashes[2],
        orgBId, customerB.rows[0].id, credentials.customerB.email, ownerHashes[3]]
    );

    const orderA = await client.query(
      `insert into orders
         (organization_id,order_code,customer_id,total,status,payment_provider,payment_method,subtotal)
       values ($1,'E2E-A-ORDER',$2,150,'paid','mock','card',150) returning id`,
      [orgAId, customerA.rows[0].id]
    );
    await client.query(
      `insert into order_items
         (organization_id,order_id,product_id,variant_id,product_name,selected_color,selected_size,sku,quantity,unit_price)
       values ($1,$2,$3,$4,$5,'Siyah','S','E2E-A-1-1',1,150)`,
      [orgAId, orderA.rows[0].id, productsA[0].id, productsA[0].variantId, productsA[0].name]
    );
    const orderB = await client.query(
      `insert into orders
         (organization_id,order_code,customer_id,total,status,payment_provider,payment_method,subtotal)
       values ($1,'E2E-B-ORDER',$2,999,'paid','mock','card',999) returning id`,
      [orgBId, customerB.rows[0].id]
    );
    await client.query(
      `insert into order_items
         (organization_id,order_id,product_id,variant_id,product_name,selected_color,selected_size,sku,quantity,unit_price)
       values ($1,$2,$3,$4,'Tenant B Gizli Ürün','Gri','M','E2E-B-1',1,999)`,
      [orgBId, orderB.rows[0].id, productB.rows[0].id, variantB.rows[0].id]
    );
    const couponA = await client.query(
      `insert into coupons
         (organization_id,code,name,discount_type,value,minimum_subtotal,status,created_by)
       values ($1,'E2E20','E2E yüzde yirmi','percentage',20,100,'active',$2) returning id`,
      [orgAId, ownerA.rows[0].id]
    );
    await client.query(
      `insert into coupons
         (organization_id,code,name,discount_type,value,minimum_subtotal,status,created_by)
       values ($1,'BONLY','Tenant B kupon','fixed',50,100,'active',$2)`,
      [orgBId, ownerB.rows[0].id]
    );
    await client.query('commit');

    return {
      credentials,
      publicAccessToken,
      fixtures: {
        tenantA: { organizationId: orgAId, categoryId: categoryA.rows[0].id, productId: productsA[0].id,
          variantId: productsA[0].variantId, customerId: customerA.rows[0].id, orderId: orderA.rows[0].id,
          couponId: couponA.rows[0].id, productName: productsA[0].name, productPrice: productsA[0].price },
        tenantB: { organizationId: orgBId, categoryId: categoryB.rows[0].id, productId: productB.rows[0].id,
          variantId: variantB.rows[0].id, customerId: customerB.rows[0].id, orderId: orderB.rows[0].id,
          productName: 'Tenant B Gizli Ürün' },
        raceProduct,
      },
    };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

async function startDatabase() {
  const suffix = crypto.randomBytes(6).toString('hex');
  const container = `panelya-e2e-${suffix}`;
  const volume = `panelya-e2e-${suffix}-data`;
  const passwords = { admin: secret(), migrator: secret(), runtime: secret(), system: secret() };
  docker(['volume', 'create', volume]);
  try {
    docker([
      'run', '-d', '--name', container,
      '-v', `${volume}:/var/lib/postgresql/data`,
      '-e', 'POSTGRES_DB=panelya_e2e',
      '-e', 'POSTGRES_USER=postgres',
      '-e', `POSTGRES_PASSWORD=${passwords.admin}`,
      '-p', '127.0.0.1::5432',
      'postgres:15-alpine',
    ]);
    await waitForPostgres(container);
    const portOutput = docker(['port', container, '5432/tcp']);
    const match = portOutput.match(/127\.0\.0\.1:(\d+)/);
    if (!match) throw new Error('Disposable PostgreSQL port could not be resolved');
    const adminUrl = `postgresql://postgres:${passwords.admin}@127.0.0.1:${match[1]}/panelya_e2e`;
    // Docker Desktop can report the mapped port a fraction before its host NAT
    // path is stable. Require several real host queries before running DDL.
    await waitForHostPostgres(adminUrl);
    await provisionDatabase(adminUrl, passwords);
    const seeded = await seedFixtures(adminUrl);
    return {
      container,
      volume,
      urls: {
        admin: adminUrl,
        migration: urlWithUser(adminUrl, 'panelya_migrator', passwords.migrator),
        runtime: urlWithUser(adminUrl, 'panelya_runtime', passwords.runtime),
        system: urlWithUser(adminUrl, 'panelya_system_runtime', passwords.system),
      },
      ...seeded,
    };
  } catch (error) {
    cleanupDatabase({ container, volume });
    throw error;
  }
}

function cleanupDatabase(database) {
  if (!database) return;
  const container = String(database.container || '');
  const volume = String(database.volume || '');
  if (/^panelya-e2e-[0-9a-f]{12}$/.test(container)) {
    try { docker(['rm', '-f', container]); } catch (_) {}
  }
  if (/^panelya-e2e-[0-9a-f]{12}-data$/.test(volume)) {
    try { docker(['volume', 'rm', '-f', volume]); } catch (_) {}
  }
}

module.exports = { cleanupDatabase, startDatabase };
