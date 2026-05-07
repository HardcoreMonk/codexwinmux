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
  buildElectronRuntimeV2EvalScript,
  buildElectronSmokeLaunchCommand,
  selectElectronLocalPageTarget,
} from './electron-smoke-lib.mjs';
import {
  buildWindowsAppProcessIdScript,
  parseWindowsPackagedLaunchHoldMs,
  parseWindowsProcessIds,
} from './windows-packaged-launch-smoke-lib.mjs';
import {
  collectPaneNodes,
  extractCookieHeader,
  resolveSmokeTerminalEndpoint,
} from './runtime-v2-phase2-smoke-lib.mjs';
import { writeSmokeArtifact } from './smoke-artifact-lib.mjs';
import { buildWindowsPackagedLaunchArtifactPayload } from './windows-package-smoke-artifact-lib.mjs';

const DEFAULT_TIMEOUT_MS = 45_000;
const PASSWORD = 'windows-packaged-runtime-v2-smoke';
const SMOKE_NAME = 'windows-packaged-launch';
const rootDir = process.cwd();
const startedAt = new Date().toISOString();

const resolveSmokeName = (payload) =>
  payload?.runtimeV2Terminal || payload?.runtimeV2TerminalRequested
    ? 'windows-packaged-runtime-v2'
    : SMOKE_NAME;

const writeArtifact = async (status, payload) =>
  writeSmokeArtifact({
    smokeName: resolveSmokeName(payload),
    status,
    startedAt,
    payload: buildWindowsPackagedLaunchArtifactPayload(payload),
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

const resolveAppPath = () =>
  path.resolve(process.env.CODEXMUX_WINDOWS_PACKAGED_APP_PATH || path.join(rootDir, 'release', 'win-unpacked', 'codexmux.exe'));

const buildIsolatedEnv = (homeDir) => ({
  ...process.env,
  HOME: homeDir,
  USERPROFILE: homeDir,
  APPDATA: path.join(homeDir, 'AppData', 'Roaming'),
  LOCALAPPDATA: path.join(homeDir, 'AppData', 'Local'),
  ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  NEXT_TELEMETRY_DISABLED: '1',
  NO_AT_BRIDGE: '1',
  CODEXMUX_RUNTIME_V2: '1',
  CODEXMUX_RUNTIME_TERMINAL_V2_MODE: 'new-tabs',
  CODEXMUX_RUNTIME_TERMINAL_ADAPTER: 'windows',
  CODEXMUX_PROCESS_INSPECTOR_ADAPTER: 'windows',
});

const prepareIsolatedEnvDirs = async (homeDir) => {
  await fs.mkdir(path.join(homeDir, 'AppData', 'Roaming'), { recursive: true });
  await fs.mkdir(path.join(homeDir, 'AppData', 'Local'), { recursive: true });
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

const setElectronCookie = async (cdp, baseUrl, cookie) => {
  const [pair] = cookie.split(';');
  const index = pair.indexOf('=');
  const name = pair.slice(0, index);
  const value = pair.slice(index + 1);
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

const verifyRuntimeV2Terminal = async ({ cdp, baseUrl, cookie, checks }) => {
  await setElectronCookie(cdp, baseUrl, cookie);
  checks.push('electron-cookie');

  const pageAuth = await evaluate(cdp, `fetch(${JSON.stringify(new URL('/api/v2/workspaces', baseUrl).toString())}, { credentials: 'include' }).then(async (res) => ({ ok: res.ok, status: res.status }))`);
  if (!pageAuth.ok) throw new Error(`Electron page cookie auth failed: ${JSON.stringify(pageAuth)}`);
  checks.push('electron-page-auth');

  let workspaceId = null;
  try {
    const workspace = await jsonRequest(baseUrl, '/api/v2/workspaces', cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'Windows Packaged Runtime v2 Smoke', defaultCwd: rootDir }),
    });
    workspaceId = workspace.id;
    checks.push('runtime-v2-workspace-create');

    const layout = await jsonRequest(baseUrl, `/api/v2/workspaces/${encodeURIComponent(workspaceId)}/layout`, cookie);
    const pane = collectPaneNodes(layout)[0];
    if (!pane) throw new Error('workspace layout did not include a pane');

    const runtimeTab = await jsonRequest(
      baseUrl,
      '/api/v2/tabs',
      cookie,
      {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          paneId: pane.id,
          cwd: rootDir,
        }),
      },
    );
    if (runtimeTab.runtimeVersion !== 2 || resolveSmokeTerminalEndpoint(runtimeTab) !== '/api/v2/terminal') {
      throw new Error(`new terminal tab did not route to runtime v2: ${JSON.stringify(runtimeTab)}`);
    }
    checks.push('runtime-v2-tab-create');

    const marker = `windows-packaged-runtime-v2-${Date.now()}`;
    const terminalResult = await evaluate(cdp, buildElectronRuntimeV2EvalScript({
      sessionName: runtimeTab.sessionName,
      marker,
      commandKind: 'windows',
      cols: 100,
      rows: 30,
      timeoutMs: 30_000,
    }));
    if (!terminalResult?.output?.includes(marker) || !String(terminalResult.url).includes('/api/v2/terminal')) {
      throw new Error(`Windows packaged runtime v2 marker missing: ${JSON.stringify(terminalResult)}`);
    }
    checks.push('runtime-v2-terminal-ws');

    await jsonRequest(baseUrl, `/api/v2/workspaces/${encodeURIComponent(workspaceId)}`, cookie, { method: 'DELETE' });
    workspaceId = null;
    checks.push('runtime-v2-workspace-delete');

    return {
      tabId: runtimeTab.id,
      sessionName: runtimeTab.sessionName,
      runtimeVersion: runtimeTab.runtimeVersion,
      marker,
    };
  } finally {
    if (workspaceId) {
      await jsonRequest(baseUrl, `/api/v2/workspaces/${encodeURIComponent(workspaceId)}`, cookie, { method: 'DELETE' }).catch(() => null);
    }
  }
};

const stopProcessTree = async (child) => {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.once('exit', resolve);
      killer.once('error', resolve);
    });
    return;
  }
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(5_000).then(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }),
  ]);
};

const waitForChildExit = async (child, timeoutMs = 3_000) => {
  if (!child || child.exitCode !== null) return;
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(timeoutMs),
  ]);
};

const requestElectronBrowserClose = async (cdp) => {
  if (!cdp) return;
  try {
    await cdp.send('Browser.close', {}, 1_500);
  } catch {
    // Browser.close can tear down the CDP socket before a response is sent.
  }
};

const listWindowsAppProcessIds = async (appPath) => {
  if (process.platform !== 'win32') return [];
  const script = buildWindowsAppProcessIdScript();

  const output = await new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', script], {
      env: {
        ...process.env,
        CODEXMUX_SMOKE_APP_PATH: appPath,
      },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.once('close', () => resolve(stdout));
    child.once('error', () => resolve(''));
  });

  return parseWindowsProcessIds(output);
};

const stopWindowsAppProcesses = async (appPath, excludePids = []) => {
  const exclude = new Set(excludePids);
  const pids = (await listWindowsAppProcessIds(appPath)).filter((pid) => !exclude.has(pid));
  await Promise.all(pids.map((pid) => new Promise((resolve) => {
    const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    child.once('exit', resolve);
    child.once('error', resolve);
  })));
};

const main = async () => {
  if (process.platform !== 'win32') {
    await fail('windows-packaged-launch-platform-mismatch', 'Windows packaged launch smoke requires win32.', {
      platform: process.platform,
    });
  }

  const appPath = resolveAppPath();
  const timeoutMs = Number(process.env.CODEXMUX_WINDOWS_PACKAGED_LAUNCH_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const longRunHoldMs = parseWindowsPackagedLaunchHoldMs(process.env.CODEXMUX_WINDOWS_PACKAGED_LAUNCH_HOLD_MS);
  const remoteDebuggingPort = process.env.CODEXMUX_WINDOWS_PACKAGED_LAUNCH_PORT
    ? Number(process.env.CODEXMUX_WINDOWS_PACKAGED_LAUNCH_PORT)
    : await getFreePort();
  const homeDir = process.env.CODEXMUX_WINDOWS_PACKAGED_LAUNCH_HOME
    || await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-windows-packaged-launch-'));
  const checks = [];
  const consoleEvents = [];
  const runRuntimeV2Terminal = process.argv.includes('--runtime-v2-terminal')
    || process.env.CODEXMUX_WINDOWS_PACKAGED_RUNTIME_V2 === '1';
  let electron = null;
  let cdp = null;
  let launch = null;
  let output = '';
  let runtimeV2Terminal = null;
  const existingAppPids = await listWindowsAppProcessIds(appPath);

  try {
    await fs.access(appPath);
    checks.push('packaged-exe-present');
    await prepareIsolatedEnvDirs(homeDir);
    checks.push('isolated-user-dirs');

    launch = buildElectronSmokeLaunchCommand({
      remoteDebuggingPort,
      appPath,
      platform: process.platform,
    });
    electron = spawn(launch.command, launch.args, {
      cwd: path.dirname(appPath),
      env: buildIsolatedEnv(homeDir),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    checks.push(`packaged-launch-${launch.mode}`);

    electron.stdout.on('data', (chunk) => { output += chunk.toString(); });
    electron.stderr.on('data', (chunk) => { output += chunk.toString(); });

    const target = await waitFor('Windows packaged Electron local page target', async () => {
      if (electron.exitCode !== null && launch.mode !== 'windows-exe') {
        throw new Error(`packaged Electron exited early with ${electron.exitCode}: ${output.slice(-1800)}`);
      }
      const targets = await fetchJson(`http://127.0.0.1:${remoteDebuggingPort}/json/list`).catch(() => null);
      return selectElectronLocalPageTarget(Array.isArray(targets) ? targets : []);
    }, timeoutMs);
    checks.push('local-page-target');

    cdp = await connectCdp(target.webSocketDebuggerUrl);
    attachConsoleCollectors(cdp, consoleEvents);
    await enableCdpDomains(cdp);
    checks.push('cdp-connected');

    const state = await waitFor('Windows packaged Electron page ready', async () => {
      const current = await readPageState(cdp);
      return current.readyState === 'complete' && current.origin.startsWith('http://') ? current : null;
    }, timeoutMs);
    checks.push('page-ready');

    if (!state.hasElectronApi) {
      throw new Error(`Electron preload bridge is missing: ${JSON.stringify(state)}`);
    }
    checks.push('preload-bridge');

    const health = await fetchJson(new URL('/api/health', state.origin).toString());
    if (health?.app !== 'codexmux') throw new Error(`packaged local server health failed: ${JSON.stringify(health)}`);
    checks.push('local-server-health');

    if (runRuntimeV2Terminal) {
      const cookie = await ensureLoggedIn(state.origin);
      checks.push('server-login');
      runtimeV2Terminal = await verifyRuntimeV2Terminal({
        cdp,
        baseUrl: state.origin,
        cookie,
        checks,
      });
    }

    const blockingOutput = [
      /NODE_MODULE_VERSION/i,
      /Runtime v2 worker script is missing/i,
      /runtime v2 startup diagnostic failed/i,
    ].filter((pattern) => pattern.test(output));
    if (blockingOutput.length > 0) {
      throw new Error(`packaged runtime output contains blocking diagnostics: ${blockingOutput.map(String).join(', ')}`);
    }
    checks.push('runtime-output-clean');

    await sleep(1_000);
    const blockingConsole = collectBlockingConsoleEvents(consoleEvents);
    if (blockingConsole.length > 0) {
      throw new Error(`blocking console events: ${JSON.stringify(blockingConsole.slice(0, 20))}`);
    }
    checks.push('console-clean');

    let longRunHealth = null;
    if (longRunHoldMs > 0) {
      await sleep(longRunHoldMs);
      checks.push('long-run-hold');
      longRunHealth = await fetchJson(new URL('/api/health', state.origin).toString());
      if (longRunHealth?.app !== 'codexmux') {
        throw new Error(`long-running packaged local server health failed: ${JSON.stringify(longRunHealth)}`);
      }
      checks.push('long-run-health');
    }

    const successPayload = {
      ok: true,
      mutatesSystem: false,
      appPath,
      homeDir,
      launchMode: launch.mode,
      longRunHoldMs,
      remoteDebuggingPort,
      checks,
      state,
      health,
      longRunHealth,
      runtimeV2Terminal,
      consoleEventCount: consoleEvents.length,
      blockingConsoleCount: blockingConsole.length,
    };
    await writeArtifact('passed', successPayload);
    console.log(JSON.stringify(successPayload, null, 2));
  } catch (err) {
    await fail('windows-packaged-launch-smoke-failed', err instanceof Error ? err.message : String(err), {
      appPath,
      homeDir,
      launchMode: launch?.mode,
      remoteDebuggingPort,
      checks,
      runtimeV2TerminalRequested: runRuntimeV2Terminal,
      outputTail: output.slice(-2000),
      consoleEvents: consoleEvents.slice(-20),
    });
  } finally {
    await requestElectronBrowserClose(cdp);
    if (cdp) cdp.close();
    await waitForChildExit(electron);
    await stopProcessTree(electron);
    await stopWindowsAppProcesses(appPath, existingAppPids);
  }
};

main();
