'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const STATE_FILE = path.join(__dirname, '..', '.state.json');
const TEMP_DIR = path.join(__dirname, '..', '.tmp');
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const PANELYA_DIR = path.join(PROJECT_ROOT, 'panelya');
const API_DIR = path.join(PANELYA_DIR, 'panelya-api');
const WEB_DIR = path.join(PANELYA_DIR, 'apps', 'web');

function readState() {
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function stateFileExists() {
  return fs.existsSync(STATE_FILE);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function getFreePorts(count) {
  const ports = new Set();
  while (ports.size < count) ports.add(await getFreePort());
  return Array.from(ports);
}

module.exports = {
  STATE_FILE,
  TEMP_DIR,
  PROJECT_ROOT,
  PANELYA_DIR,
  API_DIR,
  WEB_DIR,
  readState,
  writeState,
  stateFileExists,
  getFreePort,
  getFreePorts,
};
