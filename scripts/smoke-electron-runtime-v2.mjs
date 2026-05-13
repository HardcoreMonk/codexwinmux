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
  buildElectronRuntimeV2ReconnectRounds,
  buildElectronRuntimeV2EvalScript,
  buildElectronSmokeLaunchCommand,
  normalizeElectronSmokeUrl,
  normalizeElectronReconnectRounds,
  normalizeElectronWindowForegroundCycles,
  selectElectronPageTarget,
} from './electron-smoke-lib.mjs';
import {
  collectPaneNodes,
  extractCookieHeader,
  resolveSmokeTerminalEndpoint,
} from './runtime-v2-phase2-smoke-lib.mjs';
import { buildEnvAlias } from './env-alias-lib.mjs';
import { writeSmokeArtifact } from './smoke-artifact-lib.mjs';

const PASSWORD = 'electron-runtime-v2-smoke';
const DEFAULT_TIMEOUT_MS = 30_000;
const SMOKE_NAME = 'electron-runtime-v2';
const rootDir = process.cwd();
const startedAt = new Date().toISOString();

const writeArtifact = async (status, payload) =>
  writeSmokeArtifact({
    smokeName: SMOKE_NAME,
    status,
    startedAt,
    payload,
  }).catch((err) => {
    console.error(JSON.stringify({
      ok: false,
      code: 'smoke-artifact-write-failed',
      message: err instanceof Error ? err.message : String(err),
    }, null, 2));
  });

const fail = async (code, message, details = {}) => {
  const payload = { ok: false, code, message, ...details };
  await writeArtifact('failed', payload);
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
};

const jsonRequest = async (baseUrl, pathname, cookie, init = {}) => {
  const headers = {
    ...(cookie ? { Cookie: cookie } : {}),
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers ?? {}),
  };
  const res = await fetch(new URL(pathname, baseUrl), { ...init, headers });
  if (res.status === 204) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${pathname} failed: ${res.status} ${text}`);
  return data;
};

const startServer = async ({ homeDir, dbPath, port }) => {
  const env = {
    ...process.env,
    PATH: process.env.PATH || process.env.Path,
    HOME: homeDir,
    ...(process.platform === 'win32' ? {
      USERPROFILE: homeDir,
      APPDATA: path.join(homeDir, 'AppData', 'Roaming'),
      LOCALAPPDATA: path.join(homeDir, 'AppData', 'Local'),
    } : {}),
    NEXT_TELEMETRY_DISABLED: '1',
    SHELL: '/bin/sh',
    ...buildEnvAlias('CODEXMUX_RUNTIME_V2', '1'),
    ...buildEnvAlias('CODEXMUX_RUNTIME_TERMINAL_V2_MODE', 'new-tabs'),

    ...(process.platform === 'win32' ? buildEnvAlias('CODEXMUX_RUNTIME_TERMINAL_ADAPTER', 'windows') : {}),
    ...buildEnvAlias('CODEXMUX_RUNTIME_DB', dbPath),
    PORT: String(port),
  };
  delete env.__CMUX_PRISTINE_ENV;
  env.__CMUX_PRISTINE_ENV = JSON.stringify(env);

  const child = spawn(
    process.platform === 'win32' ? 'cmd.exe' : 'corepack',
    process.platform === 'win32'
      ? ['/d', '/s', '/c', 'corepack pnpm exec tsx server.ts']
      : ['pnpm', 'exec', 'tsx', 'server.ts'],
    {
    cwd: rootDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitFor('Electron runtime v2 server startup', async () => {
    if (child.exitCode !== null) throw new Error(`server exited early with ${child.exitCode}: ${output.slice(-1200)}`);
    const res = await fetch(new URL('/api/health', baseUrl)).catch(() => null);
    return res?.ok;
  }, DEFAULT_TIMEOUT_MS);

  return {
    baseUrl,
    getOutput: () => output,
    stop: async () => {
      if (child.exitCode !== null) return;
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        child.kill('SIGINT');
      }
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        sleep(10_000).then(() => {
          if (child.exitCode === null) child.kill('SIGTERM');
          return new Promise((resolve) => child.once('exit', resolve));
        }),
      ]);
    },
  };
};

const ensureLoggedIn = async (baseUrl) => {
  const setup = await jsonRequest(baseUrl, '/api/auth/setup', '');
  if (setup?.needsSetup) {
    await jsonRequest(baseUrl, '/api/auth/setup', '', {
      method: 'POST',
      body: JSON.stringify({
        authPassword: PASSWORD,
        locale: 'ko',
        appTheme: 'dark',
        dangerouslySkipPermissions: true,
        networkAccess: 'localhost',
      }),
    });
  }

  const res = await fetch(new URL('/api/auth/login', baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const cookie = extractCookieHeader(res);
  if (!cookie) throw new Error('login did not return a session cookie');
  return cookie;
};

const startElectron = async ({ targetUrl, homeDir, remoteDebuggingPort, timeoutMs, appPath }) => {
  const launch = buildElectronSmokeLaunchCommand({ remoteDebuggingPort, appPath });
  const electron = spawn(launch.command, launch.args, {
    cwd: rootDir,
    env: {
      ...process.env,
    PATH: process.env.PATH || process.env.Path,
      HOME: homeDir,
      ELECTRON_DEV_URL: targetUrl,
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      NO_AT_BRIDGE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  electron.stdout.on('data', (chunk) => { output += chunk.toString(); });
  electron.stderr.on('data', (chunk) => { output += chunk.toString(); });

  const target = await waitFor('Electron runtime v2 DevTools target', async () => {
    if (electron.exitCode !== null) {
      throw new Error(`Electron exited early with ${electron.exitCode}: ${output.slice(-1600)}`);
    }
    const targets = await fetchJson(`http://127.0.0.1:${remoteDebuggingPort}/json/list`).catch(() => null);
    return selectElectronPageTarget(Array.isArray(targets) ? targets : [], targetUrl);
  }, timeoutMs);
  const version = await fetchJson(`http://127.0.0.1:${remoteDebuggingPort}/json/version`).catch(() => null);

  return {
    electron,
    target,
    browserWebSocketDebuggerUrl: version?.webSocketDebuggerUrl,
    launch,
    getOutput: () => output,
  };
};

const setElectronCookie = async (cdp, baseUrl, cookie) => {
  const [name, value] = cookie.split('=');
  if (!name || !value) throw new Error(`invalid cookie: ${cookie}`);
  await cdp.send('Network.enable');
  const result = await cdp.send('Network.setCookie', {
    url: baseUrl,
    name,
    value,
    path: '/',
  });
  if (result && result.success === false) throw new Error(`Network.setCookie failed: ${JSON.stringify(result)}`);
};

const waitForElectronPage = (cdp, baseUrl, timeoutMs) =>
  waitFor('Electron runtime v2 page load', async () => {
    const state = await evaluate(cdp, `(() => ({
      href: location.href,
      origin: location.origin,
      readyState: document.readyState,
      title: document.title
    }))()`);
    return state.origin === new URL(baseUrl).origin && state.readyState === 'complete' ? state : null;
  }, timeoutMs);

const reloadElectronPageForReconnect = async (cdp, baseUrl, timeoutMs) => {
  await cdp.send('Page.bringToFront').catch(() => null);
  await cdp.send('Page.reload', { ignoreCache: true });
  const state = await waitForElectronPage(cdp, baseUrl, timeoutMs);
  await cdp.send('Page.bringToFront').catch(() => null);
  return state;
};

const isMissingCdpMethod = (err) => /wasn'?t found|method not found/i.test(String(err?.message || err));

const activateElectronTarget = async (browserCdp, pageCdp, target, baseUrl, timeoutMs) => {
  if (target?.id) {
    await browserCdp.send('Target.activateTarget', { targetId: target.id }).catch(() => null);
  }
  await pageCdp.send('Page.bringToFront').catch(() => null);
  await waitForElectronPage(pageCdp, baseUrl, timeoutMs);
  return { method: 'target-activate' };
};

const cycleElectronWindowForeground = async (browserCdp, pageCdp, target, baseUrl, timeoutMs) => {
  const targetId = target?.id;
  let windowInfo;
  try {
    windowInfo = await browserCdp.send('Browser.getWindowForTarget', targetId ? { targetId } : {});
  } catch (err) {
    if (isMissingCdpMethod(err)) {
      return activateElectronTarget(browserCdp, pageCdp, target, baseUrl, timeoutMs);
    }
    throw err;
  }
  const windowId = windowInfo?.windowId;
  if (!windowId) throw new Error(`Electron window id not found: ${JSON.stringify(windowInfo)}`);

  try {
    await browserCdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
    await sleep(750);
    await browserCdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  } catch (err) {
    if (isMissingCdpMethod(err)) {
      return activateElectronTarget(browserCdp, pageCdp, target, baseUrl, timeoutMs);
    }
    throw err;
  }
  await pageCdp.send('Page.bringToFront').catch(() => null);
  await waitForElectronPage(pageCdp, baseUrl, timeoutMs);
  return { method: 'browser-window-bounds' };
};

const main = async () => {
  const homeDir = process.env.CODEXMUX_ELECTRON_RUNTIME_V2_HOME
    || await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-electron-runtime-v2-'));
  const dbPath = path.join(homeDir, 'runtime-v2', 'state.db');
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const serverPort = Number(process.env.CODEXMUX_ELECTRON_RUNTIME_V2_PORT || await getFreePort());
  const remoteDebuggingPort = Number(process.env.CODEXMUX_ELECTRON_DEVTOOLS_PORT || await getFreePort());
  const timeoutMs = Number(process.env.CODEXMUX_ELECTRON_SMOKE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const reconnectRounds = normalizeElectronReconnectRounds(process.env.CODEXMUX_ELECTRON_RUNTIME_V2_RECONNECT_ROUNDS);
  const foregroundCycles = normalizeElectronWindowForegroundCycles(process.env.CODEXMUX_ELECTRON_WINDOW_FOREGROUND_CYCLES);
  const appPath = process.env.CODEXMUX_ELECTRON_RUNTIME_V2_APP_PATH || process.env.CODEXMUX_ELECTRON_APP_PATH || '.';
  const checks = [];
  let server = null;
  let electron = null;
  let cdp = null;
  let browserCdp = null;
  let launch = null;
  let workspaceId = null;

  try {
    if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
      throw new Error('Electron runtime v2 smoke requires DISPLAY or WAYLAND_DISPLAY on Linux');
    }

    await fs.access(path.join(rootDir, 'dist-electron', 'main.js'));
    checks.push('electron-main-present');

    server = await startServer({ homeDir, dbPath, port: serverPort });
    const baseUrl = normalizeElectronSmokeUrl(server.baseUrl);
    const cookie = await ensureLoggedIn(baseUrl);
    checks.push('server-login');

    const workspace = await jsonRequest(baseUrl, '/api/workspace', cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'Electron Runtime v2 Smoke', directory: rootDir }),
    });
    workspaceId = workspace.id;
    checks.push('workspace-create');

    const layout = await jsonRequest(baseUrl, `/api/layout?workspace=${encodeURIComponent(workspaceId)}`, cookie);
    const pane = collectPaneNodes(layout)[0];
    if (!pane) throw new Error('workspace layout did not include a pane');

    const runtimeTab = await jsonRequest(
      baseUrl,
      `/api/layout/pane/${encodeURIComponent(pane.id)}/tabs?workspace=${encodeURIComponent(workspaceId)}`,
      cookie,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Electron v2',
          cwd: rootDir,
        }),
      },
    );
    if (runtimeTab.runtimeVersion !== 2 || resolveSmokeTerminalEndpoint(runtimeTab) !== '/api/v2/terminal') {
      throw new Error(`new terminal tab did not route to runtime v2: ${JSON.stringify(runtimeTab)}`);
    }
    checks.push('runtime-v2-tab-create');

    const startedElectron = await startElectron({
      targetUrl: baseUrl,
      homeDir,
      remoteDebuggingPort,
      timeoutMs,
      appPath,
    });
    electron = startedElectron.electron;
    launch = startedElectron.launch;
    checks.push(`electron-launch-${launch.mode}`);
    cdp = await connectCdp(startedElectron.target.webSocketDebuggerUrl);
    if (foregroundCycles > 0) {
      if (!startedElectron.browserWebSocketDebuggerUrl) {
        throw new Error('Electron browser DevTools target is missing; cannot run window foreground cycles');
      }
      browserCdp = await connectCdp(startedElectron.browserWebSocketDebuggerUrl);
      checks.push('electron-browser-cdp-connected');
    }
    const consoleEvents = [];
    attachConsoleCollectors(cdp, consoleEvents);
    await enableCdpDomains(cdp);
    await waitForElectronPage(cdp, baseUrl, timeoutMs);
    await setElectronCookie(cdp, baseUrl, cookie);
    checks.push('electron-cookie');

    const layoutPath = `/api/layout?workspace=${encodeURIComponent(workspaceId)}`;
    const pageAuthUrl = new URL(layoutPath, baseUrl).toString();
    const pageAuth = await evaluate(cdp, `fetch(${JSON.stringify(pageAuthUrl)}, { credentials: 'include' }).then(async (res) => ({ ok: res.ok, status: res.status, hasRoot: !!(await res.json()).root }))`);
    if (!pageAuth.ok || !pageAuth.hasRoot) throw new Error(`Electron page cookie auth failed: ${JSON.stringify(pageAuth)}`);
    checks.push('electron-page-auth');

    const rounds = buildElectronRuntimeV2ReconnectRounds({
      baseMarker: `electron-runtime-v2-ok-${Date.now()}`,
      reconnectRounds,
    });
    const markers = [];

    const assertRuntimeV2Marker = async (label, marker) => {
      const result = await evaluate(cdp, buildElectronRuntimeV2EvalScript({
        sessionName: runtimeTab.sessionName,
        marker,
        cols: 100,
        rows: 30,
      }));
      if (!result?.output?.includes(marker) || !String(result.url).includes('/api/v2/terminal')) {
        throw new Error(`Electron runtime v2 marker missing for ${label}: ${JSON.stringify(result)}`);
      }
      markers.push({ label, marker });
      checks.push(`electron-v2-terminal-ws-${label}`);
    };

    for (const round of rounds) {
      if (round.reloadBefore) {
        await reloadElectronPageForReconnect(cdp, baseUrl, timeoutMs);
        checks.push(`electron-page-reload-${round.label}`);
      }
      await assertRuntimeV2Marker(round.label, round.marker);
    }

    for (let i = 1; i <= foregroundCycles; i += 1) {
      const foreground = await cycleElectronWindowForeground(browserCdp, cdp, startedElectron.target, baseUrl, timeoutMs);
      const label = `foreground-${i}`;
      checks.push(`electron-window-foreground-${i}-${foreground.method}`);
      await assertRuntimeV2Marker(label, `electron-runtime-v2-foreground-${Date.now()}-${i}`);
    }

    await sleep(1_000);
    const blockingConsole = collectBlockingConsoleEvents(consoleEvents);
    if (blockingConsole.length > 0) throw new Error(`blocking Electron console events: ${JSON.stringify(blockingConsole.slice(0, 20))}`);
    checks.push('console-clean');

    await jsonRequest(baseUrl, `/api/workspace/${encodeURIComponent(workspaceId)}`, cookie, { method: 'DELETE' });
    workspaceId = null;
    checks.push('workspace-delete');

    const payload = {
      ok: true,
      baseUrl,
      homeDir,
      appPath,
      launchMode: launch?.mode,
      remoteDebuggingPort,
      tabId: runtimeTab.id,
      sessionName: runtimeTab.sessionName,
      runtimeVersion: runtimeTab.runtimeVersion,
      reconnectRounds,
      foregroundCycles,
      checks,
      markers,
    };
    await writeArtifact('passed', payload);
    console.log(JSON.stringify(payload, null, 2));
  } catch (err) {
    if (server) console.error(server.getOutput().slice(-4000));
    await fail('electron-runtime-v2-smoke-failed', err instanceof Error ? err.message : String(err), {
      homeDir,
      appPath,
      launchMode: launch?.mode,
      serverPort,
      remoteDebuggingPort,
      workspaceId,
      checks,
    });
  } finally {
    if (browserCdp) browserCdp.close();
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
    if (workspaceId && server) {
      try {
        const baseUrl = `http://127.0.0.1:${serverPort}`;
        const cookie = await ensureLoggedIn(baseUrl);
        await jsonRequest(baseUrl, `/api/workspace/${encodeURIComponent(workspaceId)}`, cookie, { method: 'DELETE' });
      } catch {
        // best-effort cleanup
      }
    }
    if (server) await server.stop();
  }
};

main();
