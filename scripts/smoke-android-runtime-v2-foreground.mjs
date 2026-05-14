#!/usr/bin/env node
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import {
  DEFAULT_ANDROID_ACTIVITY,
  DEFAULT_ANDROID_APP_ID,
  DEFAULT_ANDROID_SMOKE_URL,
  adbArgsFor,
  attachConsoleCollectors,
  backgroundAndroidApp,
  clearLogcat,
  collectBlockingConsoleEvents,
  collectBlockingLogcatLines,
  connectCdp,
  discoverDevtoolsTarget,
  dumpLogcat,
  enableCdpDomains,
  evaluate,
  findAdb,
  forceStopAndroidApp,
  getFreePort,
  isExpectedRemoteState,
  navigateCdp,
  normalizeSmokeUrl,
  readWebViewState,
  removeForward,
  selectAndroidSerial,
  sleep,
  startAndroidApp,
  waitFor,
  waitForExpectedRemoteState,
} from './android-webview-smoke-lib.mjs';
import {
  buildAndroidRuntimeV2Rounds,
  buildAndroidRuntimeV2TargetUrl,
  extractCookiePair,
  findTailscaleIpv4,
  normalizeAndroidForegroundRounds,
} from './android-runtime-v2-smoke-lib.mjs';
import {
  buildElectronRuntimeV2EvalScript,
  stopChildProcessTree,
} from './electron-smoke-lib.mjs';
import {
  collectPaneNodes,
  extractCookieHeader,
  resolveSmokeTerminalEndpoint,
} from './runtime-v2-phase2-smoke-lib.mjs';
import { buildEnvAlias, stripLegacyRuntimeEnv } from './env-alias-lib.mjs';
import { writeSmokeArtifact } from './smoke-artifact-lib.mjs';
import { buildTsxServerInvocation } from './server-smoke-process-lib.mjs';

const PASSWORD = 'android-runtime-v2-smoke';
const DEFAULT_TIMEOUT_MS = 35_000;
const SMOKE_NAME = 'android-runtime-v2';
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

const envNumber = (name, fallback) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number`);
  return parsed;
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
    ...stripLegacyRuntimeEnv(process.env),
    PATH: process.env.PATH || process.env.Path,
    HOME: homeDir,
    ...(process.platform === 'win32' ? {
      USERPROFILE: homeDir,
      APPDATA: path.join(homeDir, 'AppData', 'Roaming'),
      LOCALAPPDATA: path.join(homeDir, 'AppData', 'Local'),
    } : {}),
    NEXT_TELEMETRY_DISABLED: '1',
    SHELL: '/bin/sh',
    HOST: process.env.CODEXMUX_ANDROID_RUNTIME_V2_HOST || 'localhost,tailscale',
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_V2', '1'),
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE', 'new-tabs'),

    ...(process.platform === 'win32' ? buildEnvAlias('CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER', 'windows') : {}),
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_DB', dbPath),
    PORT: String(port),
  };
  delete env.__CMUX_PRISTINE_ENV;
  env.__CMUX_PRISTINE_ENV = JSON.stringify(env);

  const invocation = buildTsxServerInvocation({ rootDir });
  const child = spawn(
    invocation.command,
    invocation.args,
    {
      cwd: rootDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitFor('Android runtime v2 server startup', async () => {
    if (child.exitCode !== null) throw new Error(`server exited early with ${child.exitCode}: ${output.slice(-1200)}`);
    const res = await fetch(new URL('/api/health', baseUrl)).catch(() => null);
    return res?.ok;
  }, DEFAULT_TIMEOUT_MS);

  return {
    baseUrl,
    getOutput: () => output,
    stop: async () => {
      if (child.exitCode !== null) return;
      await stopChildProcessTree(child, { timeoutMs: 10_000 });
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
        networkAccess: 'tailscale',
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

const setAndroidCookie = async (cdp, targetUrl, cookie) => {
  const { name, value } = extractCookiePair(cookie);
  await cdp.send('Network.enable');
  const result = await cdp.send('Network.setCookie', {
    url: targetUrl,
    name,
    value,
    path: '/',
  });
  if (result && result.success === false) throw new Error(`Network.setCookie failed: ${JSON.stringify(result)}`);
};

const getAndroidAppInfo = (cdp) =>
  evaluate(cdp, `(() => {
    const api = window.CodexmuxAndroid;
    if (!api) return null;
    return {
      versionName: api.getVersionName?.() || '-',
      versionCode: api.getVersionCode?.() || '-',
      packageName: api.getPackageName?.() || '-',
      deviceModel: api.getDeviceModel?.() || '-',
      androidVersion: api.getAndroidVersion?.() || '-'
    };
  })()`);

const waitForAndroidBridge = async (cdp, timeoutMs, label) => {
  try {
    return await waitFor(label, async () => {
      const state = await readWebViewState(cdp);
      const appInfo = await getAndroidAppInfo(cdp);
      return state.bridgeTriggerEventType === 'function' && appInfo
        ? { state, appInfo }
        : null;
    }, timeoutMs);
  } catch (err) {
    const state = await readWebViewState(cdp).catch(() => null);
    const appInfo = await getAndroidAppInfo(cdp).catch(() => null);
    throw new Error(`${label} missing: ${JSON.stringify({ state, appInfo, error: err instanceof Error ? err.message : String(err) })}`);
  }
};

const main = async () => {
  const homeDir = process.env.CODEXMUX_ANDROID_RUNTIME_V2_HOME
    || await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-android-runtime-v2-'));
  const dbPath = path.join(homeDir, 'runtime-v2', 'state.db');
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const serverPort = Number(process.env.CODEXMUX_ANDROID_RUNTIME_V2_PORT || await getFreePort());
  const timeoutMs = envNumber('CODEXMUX_ANDROID_RUNTIME_V2_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const backgroundMs = envNumber('CODEXMUX_ANDROID_RUNTIME_V2_BACKGROUND_MS', 8_000);
  const settleMs = envNumber('CODEXMUX_ANDROID_RUNTIME_V2_SETTLE_MS', 2_000);
  const foregroundRounds = normalizeAndroidForegroundRounds(process.env.CODEXMUX_ANDROID_RUNTIME_V2_FOREGROUND_ROUNDS);
  const requestedPort = process.env.CODEXMUX_ANDROID_DEVTOOLS_PORT
    ? Number(process.env.CODEXMUX_ANDROID_DEVTOOLS_PORT)
    : undefined;
  const appId = process.env.CODEXMUX_ANDROID_APP_ID || DEFAULT_ANDROID_APP_ID;
  const activity = process.env.CODEXMUX_ANDROID_ACTIVITY || DEFAULT_ANDROID_ACTIVITY;
  const restoreUrl = normalizeSmokeUrl(process.env.CODEXMUX_ANDROID_RESTORE_URL || DEFAULT_ANDROID_SMOKE_URL);

  const adb = findAdb();
  const serial = selectAndroidSerial(adb);
  const adbArgs = adbArgsFor(serial);
  const consoleEvents = [];
  const checks = [];
  let server = null;
  let cdp = null;
  let forward = null;
  let workspaceId = null;
  let targetUrl = null;

  const connectWebView = async () => {
    if (cdp) cdp.close();
    if (forward) removeForward({ adb, adbArgs, port: forward.port });
    forward = await discoverDevtoolsTarget({
      adb,
      adbArgs,
      expectedUrl: targetUrl || restoreUrl,
      requestedPort,
      timeoutMs,
    });
    cdp = await connectCdp(forward.target.webSocketDebuggerUrl);
    attachConsoleCollectors(cdp, consoleEvents);
    await enableCdpDomains(cdp);
    return cdp;
  };

  const ensureAndroidTarget = async (cookie) => {
    try {
      await setAndroidCookie(cdp, targetUrl, cookie);
      const state = await readWebViewState(cdp);
      if (!isExpectedRemoteState(state, targetUrl)) {
        await navigateCdp(cdp, targetUrl);
      }
      return await waitForExpectedRemoteState(cdp, targetUrl, timeoutMs);
    } catch {
      await connectWebView();
      await setAndroidCookie(cdp, targetUrl, cookie);
      await navigateCdp(cdp, targetUrl);
      return await waitForExpectedRemoteState(cdp, targetUrl, timeoutMs);
    }
  };

  try {
    clearLogcat({ adb, adbArgs });
    forceStopAndroidApp({ adb, adbArgs, appId });

    server = await startServer({ homeDir, dbPath, port: serverPort });
    const tailscaleIp = process.env.CODEXMUX_ANDROID_RUNTIME_V2_TAILSCALE_IP || findTailscaleIpv4();
    targetUrl = buildAndroidRuntimeV2TargetUrl({
      rawTargetUrl: process.env.CODEXMUX_ANDROID_RUNTIME_V2_URL,
      port: serverPort,
      tailscaleIp,
    });
    checks.push('target-url');

    const cookie = await ensureLoggedIn(server.baseUrl);
    checks.push('server-login');

    const workspace = await jsonRequest(server.baseUrl, '/api/workspace', cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'Android Runtime v2 Smoke', directory: rootDir }),
    });
    workspaceId = workspace.id;
    checks.push('workspace-create');

    const layout = await jsonRequest(server.baseUrl, `/api/layout?workspace=${encodeURIComponent(workspaceId)}`, cookie);
    const pane = collectPaneNodes(layout)[0];
    if (!pane) throw new Error('workspace layout did not include a pane');

    const runtimeTab = await jsonRequest(
      server.baseUrl,
      `/api/layout/pane/${encodeURIComponent(pane.id)}/tabs?workspace=${encodeURIComponent(workspaceId)}`,
      cookie,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Android v2',
          cwd: rootDir,
        }),
      },
    );
    if (runtimeTab.runtimeVersion !== 2 || resolveSmokeTerminalEndpoint(runtimeTab) !== '/api/v2/terminal') {
      throw new Error(`new terminal tab did not route to runtime v2: ${JSON.stringify(runtimeTab)}`);
    }
    checks.push('runtime-v2-tab-create');

    startAndroidApp({ adb, adbArgs, activity });
    await sleep(1_000);
    await connectWebView();
    let state = await ensureAndroidTarget(cookie);
    checks.push('android-target-initial');
    const bridge = await waitForAndroidBridge(cdp, timeoutMs, 'Android native bridge');
    state = bridge.state;
    const appInfo = bridge.appInfo;
    checks.push('android-bridge');

    const pageAuthUrl = new URL(`/api/layout?workspace=${encodeURIComponent(workspaceId)}`, targetUrl).toString();
    const pageAuth = await evaluate(cdp, `fetch(${JSON.stringify(pageAuthUrl)}, { credentials: 'include' }).then(async (res) => ({ ok: res.ok, status: res.status, hasRoot: !!(await res.json()).root }))`);
    if (!pageAuth.ok || !pageAuth.hasRoot) throw new Error(`Android page cookie auth failed: ${JSON.stringify(pageAuth)}`);
    checks.push('android-page-auth');

    const rounds = buildAndroidRuntimeV2Rounds({
      baseMarker: `android-runtime-v2-ok-${Date.now()}`,
      foregroundRounds,
    });
    const markers = [];
    for (const round of rounds) {
      if (round.foregroundBefore) {
        backgroundAndroidApp({ adb, adbArgs });
        await sleep(backgroundMs);
        startAndroidApp({ adb, adbArgs, activity });
        await sleep(settleMs);
        state = await ensureAndroidTarget(cookie);
        state = (await waitForAndroidBridge(cdp, timeoutMs, `Android native bridge after ${round.label}`)).state;
        checks.push(`android-foreground-${round.label}`);
      }

      const result = await evaluate(cdp, buildElectronRuntimeV2EvalScript({
        sessionName: runtimeTab.sessionName,
        marker: round.marker,
        cols: 100,
        rows: 30,
      }));
      if (!result?.output?.includes(round.marker) || !String(result.url).includes('/api/v2/terminal')) {
        throw new Error(`Android runtime v2 marker missing for ${round.label}: ${JSON.stringify(result)}`);
      }
      markers.push({ label: round.label, marker: round.marker });
      checks.push(`android-v2-terminal-ws-${round.label}`);
    }

    const blockingConsole = collectBlockingConsoleEvents(consoleEvents);
    const logcat = dumpLogcat({ adb, adbArgs });
    const blockingLogcat = collectBlockingLogcatLines(logcat);
    if (blockingConsole.length > 0 || blockingLogcat.length > 0) {
      await fail('android-runtime-v2-foreground-failed', 'Android runtime v2 foreground smoke produced blocking console or logcat errors', {
        targetUrl,
        serial,
        foregroundRounds,
        backgroundMs,
        blockingConsole,
        blockingLogcat: blockingLogcat.slice(0, 40),
      });
    }
    checks.push('console-logcat-clean');

    await jsonRequest(server.baseUrl, `/api/workspace/${encodeURIComponent(workspaceId)}`, cookie, { method: 'DELETE' });
    workspaceId = null;
    checks.push('workspace-delete');

    const payload = {
      ok: true,
      adb,
      serial,
      appId,
      activity,
      targetUrl,
      homeDir,
      serverPort,
      foregroundRounds,
      backgroundMs,
      settleMs,
      tabId: runtimeTab.id,
      sessionName: runtimeTab.sessionName,
      runtimeVersion: runtimeTab.runtimeVersion,
      checks,
      appInfo,
      markers,
      consoleEventCount: consoleEvents.length,
      blockingConsoleCount: blockingConsole.length,
      blockingLogcatCount: blockingLogcat.length,
      devtools: forward,
    };
    await writeArtifact('passed', payload);
    console.log(JSON.stringify(payload, null, 2));
  } catch (err) {
    if (server) console.error(server.getOutput().slice(-4000));
    await fail('android-runtime-v2-smoke-error', err instanceof Error ? err.message : String(err), {
      targetUrl,
      serial,
      checks,
      workspaceId,
      consoleEvents: consoleEvents.slice(-20),
    });
  } finally {
    if (workspaceId && server) {
      try {
        const cleanupCookie = await ensureLoggedIn(server.baseUrl);
        await jsonRequest(server.baseUrl, `/api/workspace/${encodeURIComponent(workspaceId)}`, cleanupCookie, { method: 'DELETE' });
      } catch {
        // best-effort cleanup
      }
    }
    if (cdp && process.env.CODEXMUX_ANDROID_RUNTIME_V2_RESTORE !== '0') {
      try {
        await navigateCdp(cdp, restoreUrl);
      } catch {
        // best-effort device restore
      }
    }
    if (cdp) cdp.close();
    if (forward) removeForward({ adb, adbArgs, port: forward.port });
    if (server) await server.stop();
  }
};

main();
