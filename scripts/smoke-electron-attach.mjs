#!/usr/bin/env node
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import {
  attachConsoleCollectors,
  collectBlockingConsoleEvents,
  connectCdp,
  enableCdpDomains,
  evaluate,
  fetchJson,
  getFreePort,
  sleep,
  waitFor,
} from './android-webview-smoke-lib.mjs';
import {
  buildElectronSmokeLaunchCommand,
  normalizeElectronSmokeUrl,
  selectElectronPageTarget,
} from './electron-smoke-lib.mjs';

const DEFAULT_TIMEOUT_MS = 30_000;
const rootDir = process.cwd();

const fail = (code, message, details = {}) => {
  console.error(JSON.stringify({ ok: false, code, message, ...details }, null, 2));
  process.exit(1);
};

const readPageState = (cdp) =>
  evaluate(cdp, `(() => ({
    href: location.href,
    origin: location.origin,
    title: document.title,
    readyState: document.readyState,
    hasElectronApi: !!window.electronAPI,
    electronApiKeys: Object.keys(window.electronAPI || {}).sort(),
    hasPasswordInput: !!document.querySelector('input[type="password"]'),
    userAgent: navigator.userAgent
  }))()`);

const waitForExpectedPage = (cdp, targetUrl, timeoutMs = DEFAULT_TIMEOUT_MS) =>
  waitFor('Electron expected page', async () => {
    const state = await readPageState(cdp);
    return state.readyState === 'complete' && state.origin === new URL(targetUrl).origin ? state : null;
  }, timeoutMs);

const main = async () => {
  const targetUrl = normalizeElectronSmokeUrl(
    process.env.CODEXMUX_ELECTRON_SMOKE_URL || process.env.ELECTRON_DEV_URL || 'http://127.0.0.1:8121',
  );
  const requestedPort = process.env.CODEXMUX_ELECTRON_DEVTOOLS_PORT
    ? Number(process.env.CODEXMUX_ELECTRON_DEVTOOLS_PORT)
    : undefined;
  const remoteDebuggingPort = requestedPort || await getFreePort();
  const timeoutMs = Number(process.env.CODEXMUX_ELECTRON_SMOKE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const homeDir = process.env.CODEXMUX_ELECTRON_SMOKE_HOME
    || await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-electron-smoke-'));
  const appPath = process.env.CODEXMUX_ELECTRON_APP_PATH || '.';
  const checks = [];
  const consoleEvents = [];
  let electron = null;
  let cdp = null;
  let launch = null;

  try {
    if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
      throw new Error('Electron smoke requires DISPLAY or WAYLAND_DISPLAY on Linux');
    }

    await fs.access(path.join(rootDir, 'dist-electron', 'main.js'));
    checks.push('electron-main-present');

    launch = buildElectronSmokeLaunchCommand({ remoteDebuggingPort, appPath });
    electron = spawn(launch.command, launch.args, {
      cwd: rootDir,
      env: {
        ...process.env,
        HOME: homeDir,
        ELECTRON_DEV_URL: targetUrl,
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
        NO_AT_BRIDGE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    checks.push(`electron-launch-${launch.mode}`);

    let output = '';
    electron.stdout.on('data', (chunk) => { output += chunk.toString(); });
    electron.stderr.on('data', (chunk) => { output += chunk.toString(); });

    const target = await waitFor('Electron DevTools target', async () => {
      if (electron.exitCode !== null) {
        throw new Error(`Electron exited early with ${electron.exitCode}: ${output.slice(-1600)}`);
      }
      const targets = await fetchJson(`http://127.0.0.1:${remoteDebuggingPort}/json/list`).catch(() => null);
      return selectElectronPageTarget(Array.isArray(targets) ? targets : [], targetUrl);
    }, timeoutMs);
    checks.push('devtools-target');

    cdp = await connectCdp(target.webSocketDebuggerUrl);
    attachConsoleCollectors(cdp, consoleEvents);
    await enableCdpDomains(cdp);
    checks.push('cdp-connected');

    await cdp.send('Page.reload', { ignoreCache: true });
    const state = await waitForExpectedPage(cdp, targetUrl, timeoutMs);
    checks.push('page-reload');

    if (!state.hasElectronApi) {
      throw new Error(`Electron preload bridge is missing: ${JSON.stringify(state)}`);
    }
    checks.push('preload-bridge');

    await sleep(1_000);
    const blockingConsole = collectBlockingConsoleEvents(consoleEvents);
    if (blockingConsole.length > 0) {
      throw new Error(`Electron smoke saw blocking console events: ${JSON.stringify(blockingConsole.slice(0, 20))}`);
    }
    checks.push('console-clean');

    console.log(JSON.stringify({
      ok: true,
      targetUrl,
      homeDir,
      appPath,
      launchMode: launch?.mode,
      remoteDebuggingPort,
      checks,
      state,
      consoleEventCount: consoleEvents.length,
      blockingConsoleCount: blockingConsole.length,
    }, null, 2));
  } catch (err) {
    fail('electron-attach-smoke-failed', err instanceof Error ? err.message : String(err), {
      targetUrl,
      homeDir,
      appPath,
      launchMode: launch?.mode,
      remoteDebuggingPort,
      checks,
      consoleEvents: consoleEvents.slice(-20),
    });
  } finally {
    if (cdp) cdp.close();
    if (electron && electron.exitCode === null && process.env.CODEXMUX_ELECTRON_KEEP_OPEN !== '1') {
      electron.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => electron.once('exit', resolve)),
        sleep(5_000).then(() => {
          if (electron.exitCode === null) electron.kill('SIGKILL');
        }),
      ]);
    }
  }
};

main();
