'use strict';

// A29 local webhook receiver, for the E2E suite only.
//
// It runs in the test process on loopback. Nothing about the platform's SSRF policy is
// relaxed to make it reachable beyond the single, explicitly-gated loopback exception the
// API opts into with WEBHOOK_ALLOW_LOCAL_DELIVERY — every other private range stays
// refused, so what the suite exercises is the production policy.
//
// The receiver verifies signatures with the SAME module the sender uses, which is the
// point: if the two ever disagreed about what gets signed, every delivery would fail for
// reasons nobody could reproduce.

const http = require('http');
const path = require('node:path');
const { createRequire } = require('node:module');
const { API_DIR } = require('./state.cjs');

const panelyaRequire = createRequire(path.join(API_DIR, 'package.json'));
const signature = panelyaRequire(path.join(API_DIR, 'modules', 'integrations', 'signature.js'));
// The suite decrypts a stored signing secret to prove it round-trips; the key comes from
// the run state, exactly like the DB superuser credentials it already holds.
const secretCrypto = panelyaRequire(path.join(API_DIR, 'modules', 'integrations', 'secretCrypto.js'));

/**
 * @param behaviour per-path response plan, so one receiver can model a healthy endpoint, a
 *        failing one and a redirecting one at the same time.
 */
function startReceiver({ behaviour = {} } = {}) {
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      // The RAW bytes, exactly as they arrived. Re-serializing here would test nothing.
      const rawBody = Buffer.concat(chunks);
      const plan = behaviour[req.url] || behaviour.default || { status: 200 };
      const secrets = [].concat(plan.secrets || plan.secret || []).filter(Boolean);
      const verified = secrets.length
        ? signature.verifySignature({
          secrets,
          timestamp: req.headers[signature.HEADERS.timestamp],
          rawBody,
          signature: req.headers[signature.HEADERS.signature],
        })
        : { valid: false, reason: 'NO_SECRET' };

      received.push({
        url: req.url,
        method: req.method,
        headers: { ...req.headers },
        rawBody: rawBody.toString('utf8'),
        body: (() => {
          try { return JSON.parse(rawBody.toString('utf8')); } catch (_) { return null; }
        })(),
        verified,
        receivedAt: Date.now(),
      });

      if (plan.status >= 300 && plan.status < 400) {
        // The platform must NOT follow this. Pointing it at loopback makes a followed
        // redirect an obvious SSRF failure rather than a subtle one.
        res.writeHead(plan.status, { Location: plan.location || 'http://127.0.0.1:1/internal' });
        return res.end();
      }
      res.writeHead(plan.status || 200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: (plan.status || 200) < 300 }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        origin: `http://127.0.0.1:${port}`,
        received,
        behaviour,
        /** Replaces the plan for a path, so a test can make an endpoint start failing. */
        setBehaviour(url, plan) { behaviour[url] = plan; },
        clear() { received.length = 0; },
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

module.exports = { secretCrypto, signature, startReceiver };
