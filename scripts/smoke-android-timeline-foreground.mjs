#!/usr/bin/env node
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFileSync, spawn } from 'child_process';
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
  buildAndroidRuntimeV2TargetUrl,
  extractCookiePair,
  findTailscaleIpv4,
  normalizeAndroidForegroundRounds,
} from './android-runtime-v2-smoke-lib.mjs';
import { extractCookieHeader } from './runtime-v2-phase2-smoke-lib.mjs';
import { buildEnvAlias, stripLegacyRuntimeEnv } from './env-alias-lib.mjs';
import { writeSmokeArtifact } from './smoke-artifact-lib.mjs';

const PASSWORD = 'android-timeline-foreground-smoke';
const DEFAULT_TIMEOUT_MS = 35_000;
const TMUX_SOCKET = 'codexwinmux';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const INITIAL_ENTRY_COUNT = 3;
const SMOKE_NAME = 'android-timeline-foreground';
const rootDir = process.cwd();
const startedAt = new Date().toISOString();

const buildFailurePayload = (code, message, details = {}) => ({ ok: false, code, message, ...details });

const throwSmokeFailure = (code, message, details = {}) => {
  const error = new Error(message);
  error.smokeFailure = buildFailurePayload(code, message, details);
  throw error;
};

const exitWithFailure = (payload) => {
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
};

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

const envNumber = (name, fallback) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number`);
  return parsed;
};

const line = (value) => JSON.stringify(value);

const runTmux = (args, options = {}) => {
  try {
    return execFileSync('tmux', ['-L', TMUX_SOCKET, ...args], {
      cwd: options.cwd ?? rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    }).trim();
  } catch (err) {
    if (options.allowFailure) return '';
    throw new Error(`tmux command failed: ${err instanceof Error ? err.message : String(err)}`);
  }
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
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${pathname} failed: ${res.status}`);
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
    HOST: process.env.CODEXMUX_ANDROID_TIMELINE_FOREGROUND_HOST || 'localhost,tailscale',
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_V2', '1'),
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_STORAGE_V2_MODE', 'off'),
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE', 'off'),

    ...(process.platform === 'win32' ? buildEnvAlias('CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER', 'windows') : {}),
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE', 'default'),
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_STATUS_V2_MODE', 'off'),
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_DB', dbPath),
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
  await waitFor('Android timeline foreground server startup', async () => {
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

const waitForAndroidBridge = async (cdp, timeoutMs, label) =>
  waitFor(label, async () => {
    const state = await readWebViewState(cdp);
    const appInfo = await getAndroidAppInfo(cdp);
    return state.bridgeTriggerEventType === 'function' && appInfo
      ? { state, appInfo }
      : null;
  }, timeoutMs);

const prepareTimelineFixture = async (homeDir) => {
  const dir = path.join(homeDir, '.codex', 'sessions', '2026', '05', '05');
  await fs.mkdir(dir, { recursive: true });
  const jsonlPath = path.join(dir, 'android-timeline-foreground.jsonl');
  const startedAt = new Date().toISOString();
  const rows = [
    line({
      type: 'session_meta',
      timestamp: startedAt,
      payload: {
        id: SESSION_ID,
        cwd: homeDir,
        timestamp: startedAt,
      },
    }),
    line({
      type: 'event_msg',
      timestamp: '2026-05-05T01:00:00.000Z',
      payload: { type: 'user_message', message: 'secret-android-timeline-initial-user' },
    }),
    line({
      type: 'event_msg',
      timestamp: '2026-05-05T01:00:01.000Z',
      payload: { type: 'agent_message', message: 'secret-android-timeline-initial-assistant' },
    }),
    line({
      type: 'response_item',
      timestamp: '2026-05-05T01:00:02.000Z',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        call_id: 'call-android-timeline-foreground',
        arguments: JSON.stringify({ cmd: 'secret-android-timeline-command' }),
      },
    }),
  ];
  await fs.writeFile(jsonlPath, `${rows.join('\n')}\n`, 'utf-8');
  return jsonlPath;
};

const appendTimelinePair = async (jsonlPath, round) => {
  const second = String(round + 3).padStart(2, '0');
  await fs.appendFile(jsonlPath, [
    line({
      type: 'event_msg',
      timestamp: `2026-05-05T01:00:${second}.000Z`,
      payload: { type: 'user_message', message: `secret-android-timeline-user-${round}` },
    }),
    line({
      type: 'event_msg',
      timestamp: `2026-05-05T01:01:${second}.000Z`,
      payload: { type: 'agent_message', message: `secret-android-timeline-assistant-${round}` },
    }),
  ].join('\n') + '\n', 'utf-8');
};

const createTmuxSession = (sessionName, cwd) => {
  runTmux(['kill-session', '-t', sessionName], { allowFailure: true });
  runTmux([
    'new-session',
    '-d',
    '-s',
    sessionName,
    '-c',
    cwd,
    'bash -lc \'bash -c "exec -a codex sleep 300" & wait\'',
  ], { cwd });
};

const sanitizeOutput = (value, { homeDir, jsonlPath }) =>
  String(value || '')
    .split(homeDir).join('[home]')
    .split(jsonlPath || '__no_jsonl_path__').join('[jsonl]')
    .replace(/secret-android-timeline-[a-z0-9-]+/g, '[content]');

const buildTimelineEvalScript = ({ sessionName, minEntries }) => `(() => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    try { ws.close(); } catch {}
    reject(new Error('timeline websocket init timed out'));
  }, 12000);
  const url = new URL('/api/timeline', location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('session', ${JSON.stringify(sessionName)});
  url.searchParams.set('panelType', 'codex');
  const messages = [];
  const ws = new WebSocket(url.toString());
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    messages.push({
      type: message.type,
      totalEntries: message.totalEntries,
      hasJsonlPath: Boolean(message.jsonlPath),
      entryCount: Array.isArray(message.entries) ? message.entries.length : undefined
    });
    if (message.type === 'timeline:init' && message.totalEntries >= ${JSON.stringify(minEntries)} && message.jsonlPath) {
      clearTimeout(timeout);
      const result = {
        urlPath: url.pathname,
        totalEntries: message.totalEntries,
        hasJsonlPath: true,
        messageTypes: messages.map((item) => item.type),
        closeCode: null
      };
      ws.onclose = (closeEvent) => {
        result.closeCode = closeEvent.code;
        resolve(result);
      };
      ws.close();
      setTimeout(() => resolve(result), 1000);
    }
  };
  ws.onerror = () => {
    clearTimeout(timeout);
    reject(new Error('timeline websocket error'));
  };
  ws.onclose = (event) => {
    if (!messages.some((message) => message.type === 'timeline:init' && message.totalEntries >= ${JSON.stringify(minEntries)} && message.hasJsonlPath)) {
      clearTimeout(timeout);
      reject(new Error('timeline websocket closed before expected init: ' + event.code));
    }
  };
}))()`;

const main = async () => {
  const homeDir = process.env.CODEXMUX_ANDROID_TIMELINE_FOREGROUND_HOME
    || await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-android-timeline-foreground-'));
  const dbPath = path.join(homeDir, 'runtime-v2', 'state.db');
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const serverPort = Number(process.env.CODEXMUX_ANDROID_TIMELINE_FOREGROUND_PORT || await getFreePort());
  const timeoutMs = envNumber('CODEXMUX_ANDROID_TIMELINE_FOREGROUND_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const backgroundMs = envNumber('CODEXMUX_ANDROID_TIMELINE_FOREGROUND_BACKGROUND_MS', 8_000);
  const settleMs = envNumber('CODEXMUX_ANDROID_TIMELINE_FOREGROUND_SETTLE_MS', 2_000);
  const foregroundRounds = normalizeAndroidForegroundRounds(process.env.CODEXMUX_ANDROID_TIMELINE_FOREGROUND_ROUNDS);
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
  const sessionName = `pt-android-timeline-${process.pid}`;
  let server = null;
  let cdp = null;
  let forward = null;
  let targetUrl = null;
  let jsonlPath = null;
  let successPayload = null;
  let failurePayload = null;
  let restoreState = null;

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
    checks.push('server-start');

    const tailscaleIp = process.env.CODEXMUX_ANDROID_TIMELINE_FOREGROUND_TAILSCALE_IP || findTailscaleIpv4();
    targetUrl = buildAndroidRuntimeV2TargetUrl({
      rawTargetUrl: process.env.CODEXMUX_ANDROID_TIMELINE_FOREGROUND_URL,
      port: serverPort,
      tailscaleIp,
    });
    checks.push('target-url');

    const cookie = await ensureLoggedIn(server.baseUrl);
    checks.push('server-login');

    jsonlPath = await prepareTimelineFixture(homeDir);
    createTmuxSession(sessionName, homeDir);
    checks.push('tmux-codex-session');

    startAndroidApp({ adb, adbArgs, activity });
    await sleep(1_000);
    await connectWebView();
    await ensureAndroidTarget(cookie);
    const bridge = await waitForAndroidBridge(cdp, timeoutMs, 'Android native bridge');
    const appInfo = bridge.appInfo;
    checks.push('android-bridge');

    const runtimeHealth = await jsonRequest(server.baseUrl, '/api/v2/runtime/health', cookie);
    if (runtimeHealth.timelineV2Mode !== 'default' || runtimeHealth.timeline?.ok !== true) {
      throw new Error('runtime health did not report timeline default mode');
    }
    checks.push('runtime-health-default');

    const roundResults = [];
    let expectedEntries = INITIAL_ENTRY_COUNT;
    const initial = await evaluate(cdp, buildTimelineEvalScript({ sessionName, minEntries: expectedEntries }));
    roundResults.push({ label: 'initial', totalEntries: initial.totalEntries, hasJsonlPath: initial.hasJsonlPath });
    checks.push('timeline-initial-init');

    for (let round = 1; round <= foregroundRounds; round += 1) {
      backgroundAndroidApp({ adb, adbArgs });
      await appendTimelinePair(jsonlPath, round);
      expectedEntries += 2;
      await sleep(backgroundMs);
      startAndroidApp({ adb, adbArgs, activity });
      await sleep(settleMs);
      await ensureAndroidTarget(cookie);
      await waitForAndroidBridge(cdp, timeoutMs, `Android native bridge after foreground-${round}`);
      const result = await evaluate(cdp, buildTimelineEvalScript({ sessionName, minEntries: expectedEntries }));
      roundResults.push({ label: `foreground-${round}`, totalEntries: result.totalEntries, hasJsonlPath: result.hasJsonlPath });
      checks.push(`timeline-foreground-${round}`);
    }

    const blockingConsole = collectBlockingConsoleEvents(consoleEvents);
    const logcat = dumpLogcat({ adb, adbArgs });
    const blockingLogcat = collectBlockingLogcatLines(logcat);
    if (blockingConsole.length > 0 || blockingLogcat.length > 0) {
      throwSmokeFailure('android-timeline-foreground-failed', 'Android timeline foreground smoke produced blocking console or logcat errors', {
        targetUrl,
        serial,
        foregroundRounds,
        backgroundMs,
        checks,
        blockingConsole,
        blockingLogcat: blockingLogcat.slice(0, 40),
      });
    }
    checks.push('console-logcat-clean');

    successPayload = {
      ok: true,
      adb,
      serial,
      appId,
      activity,
      targetUrl,
      serverPort,
      foregroundRounds,
      backgroundMs,
      settleMs,
      runtime: {
        timelineV2Mode: runtimeHealth.timelineV2Mode,
        timelineOk: runtimeHealth.timeline?.ok === true,
      },
      checks,
      appInfo,
      roundResults,
      consoleEventCount: consoleEvents.length,
      blockingConsoleCount: blockingConsole.length,
      blockingLogcatCount: blockingLogcat.length,
      devtools: forward,
    };
  } catch (err) {
    const smokeFailure = err && typeof err === 'object' ? err.smokeFailure : null;
    if (smokeFailure) {
      failurePayload = smokeFailure;
    } else {
      if (server) console.error(sanitizeOutput(String(server.getOutput()).slice(-4000), { homeDir, jsonlPath }));
      failurePayload = buildFailurePayload('android-timeline-foreground-smoke-error', sanitizeOutput(err instanceof Error ? err.message : String(err), { homeDir, jsonlPath }), {
        targetUrl,
        serial,
        checks,
        consoleEvents: consoleEvents.slice(-20),
      });
    }
  } finally {
    runTmux(['kill-session', '-t', sessionName], { allowFailure: true });
    if (cdp && process.env.CODEXMUX_ANDROID_TIMELINE_FOREGROUND_RESTORE !== '0') {
      try {
        await navigateCdp(cdp, restoreUrl);
        restoreState = await waitForExpectedRemoteState(cdp, restoreUrl, timeoutMs);
        checks.push('android-restore');
      } catch {
        const restoreFailure = buildFailurePayload('android-timeline-foreground-restore-error', 'Android WebView did not settle on the restore URL after timeline foreground smoke', {
          restoreUrl,
          targetUrl,
          serial,
          checks,
        });
        if (failurePayload) {
          failurePayload.restoreError = {
            code: restoreFailure.code,
            message: restoreFailure.message,
            restoreUrl,
          };
        } else {
          failurePayload = restoreFailure;
        }
      }
    }
    if (cdp) cdp.close();
    if (forward) removeForward({ adb, adbArgs, port: forward.port });
    if (server) await server.stop();
  }

  if (failurePayload) {
    await writeArtifact('failed', failurePayload);
    exitWithFailure(failurePayload);
  }

  if (successPayload) {
    if (restoreState) {
      successPayload.restoreState = {
        href: restoreState.href,
        readyState: restoreState.readyState,
        title: restoreState.title,
      };
    }
    await writeArtifact('passed', successPayload);
    console.log(JSON.stringify(successPayload, null, 2));
  }
};

main();
