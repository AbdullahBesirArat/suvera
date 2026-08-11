'use strict';

const { cleanup } = require('./lib/lifecycle.cjs');
const { readState, stateFileExists } = require('./lib/state.cjs');

module.exports = async function globalTeardown() {
  cleanup(stateFileExists() ? readState() : null);
};
