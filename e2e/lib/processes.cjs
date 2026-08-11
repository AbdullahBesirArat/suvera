'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { TEMP_DIR } = require('./state.cjs');

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runNpm(args, options = {}) {
  const npmExecPath = process.env.npm_execpath;
  const hasNpmExecPath = npmExecPath && fs.existsSync(npmExecPath);
  const command = hasNpmExecPath
    ? process.execPath
    : process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : npmCommand;
  const commandArgs = hasNpmExecPath
    ? [npmExecPath, ...args]
    : process.platform === 'win32' ? ['/d', '/s', '/c', [npmCommand, ...args].join(' ')] : args;
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd,
    env: options.env || process.env,
    stdio: options.stdio || 'inherit',
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm ${args.join(' ')} failed with exit code ${result.status}`);
}

function startProcess(name, command, args, { cwd, env }) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  const logFile = path.join(TEMP_DIR, `${name}.log`);
  const fd = fs.openSync(logFile, 'w');
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    windowsHide: true,
    stdio: ['ignore', fd, fd],
  });
  fs.closeSync(fd);
  child.unref();
  return { name, pid: child.pid, logFile };
}

function startNode(name, entry, args, options) {
  return startProcess(name, process.execPath, [entry, ...args], options);
}

async function waitForHttp(url, { timeoutMs = 120_000, ready } = {}) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) {
        if (!ready || await ready(response)) return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Service did not become ready at ${url}${lastError ? `: ${lastError.message}` : ''}`);
}

function stopProcess(service) {
  if (!service || !Number.isInteger(service.pid) || service.pid <= 0) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(service.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }
  try {
    process.kill(-service.pid, 'SIGTERM');
  } catch (_) {
    try { process.kill(service.pid, 'SIGTERM'); } catch (_) {}
  }
}

function tailLog(logFile, maxBytes = 12_000) {
  try {
    const data = fs.readFileSync(logFile);
    return data.subarray(Math.max(0, data.length - maxBytes)).toString('utf8');
  } catch (_) {
    return '';
  }
}

module.exports = { runNpm, startNode, stopProcess, tailLog, waitForHttp };
