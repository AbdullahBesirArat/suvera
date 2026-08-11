'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { cleanupDatabase } = require('./database.cjs');
const { stopProcess } = require('./processes.cjs');
const { STATE_FILE, TEMP_DIR } = require('./state.cjs');

function cleanup(state) {
  const services = Object.values(state?.services || {}).reverse();
  for (const service of services) stopProcess(service);
  cleanupDatabase(state?.database);
  // Service logs are the only record of why a run failed, and teardown deletes them. When
  // E2E_KEEP_LOGS names a directory they are copied out first, so a failing run can be
  // diagnosed without re-running it blind.
  const keepLogs = String(process.env.E2E_KEEP_LOGS || '').trim();
  if (keepLogs) {
    try {
      fs.mkdirSync(keepLogs, { recursive: true });
      for (const entry of fs.readdirSync(TEMP_DIR)) {
        if (entry.endsWith('.log')) fs.copyFileSync(path.join(TEMP_DIR, entry), path.join(keepLogs, entry));
      }
    } catch (_) { /* diagnostics are best-effort and must never fail a teardown */ }
  }
  try { fs.rmSync(TEMP_DIR, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(STATE_FILE, { force: true }); } catch (_) {}
}

module.exports = { cleanup };
