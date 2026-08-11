'use strict';

const path = require('node:path');
const { createRequire } = require('node:module');
const { API_DIR, readState } = require('./state.cjs');

const panelyaRequire = createRequire(path.join(API_DIR, 'package.json'));
const { Client } = panelyaRequire('pg');
// The app's own token helpers, so E2E seeds a recovery token exactly as production
// would (raw token used once by the test; only its hash is stored in the DB).
const cartToken = require(path.join(API_DIR, 'modules', 'cart', 'token.js'));

// Superuser (RLS-bypassing) connection used only for E2E assertions on canonical
// server state (cart status, conversion, events). Never used by the app itself.
async function dbQuery(sql, params = [], state = readState()) {
  const client = new Client({ connectionString: state.database.urls.admin });
  await client.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    await client.end().catch(() => {});
  }
}

module.exports = { dbQuery, cartToken };
