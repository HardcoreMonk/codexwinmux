import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

export const DEFAULT_ANDROID_APP_ID = 'com.hardcoremonk.codexwinmux';
export const DEFAULT_ANDROID_ACTIVITY = `${DEFAULT_ANDROID_APP_ID}/.MainActivity`;
export const DEFAULT_ANDROID_SMOKE_URL = '';

const COMMAND_TIMEOUT_MS = 30_000;
const FETCH_TIMEOUT_MS = 5_000;
const CDP_TIMEOUT_MS = 8_000;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const isSmokeFlagEnabled = (value) =>
  ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

export const normalizeSmokeUrl = (raw) => {
  const value = String(raw || '').trim();
  if (!value) throw new Error('smoke url is required');
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withScheme);
  url.hash = '';
  return url.toString().replace(/\/$/, '');
};

export const resolveAndroidSmokeUrl = (raw, envName = 'CODEXMUX_ANDROID_SMOKE_URL') => {
  const value = String(raw || DEFAULT_ANDROID_SMOKE_URL || '').trim();
  if (!value) {
    throw new Error(`${envName} is required for codexwinmux Android smoke; set it to the codexwinmux server URL`);
  }
  return normalizeSmokeUrl(value);
};

export const buildAndroidRecoveryScenarioUrl = (scenario, targetUrl, env = process.env) => {
  if (scenario === 'network') return env.CODEXMUX_ANDROID_NETWORK_BAD_URL || 'http://127.0.0.1:1';
  if (scenario === 'http') return env.CODEXMUX_ANDROID_HTTP_BAD_URL || 'https://httpstat.us/404';
  if (scenario === 'ssl') return env.CODEXMUX_ANDROID_SSL_BAD_URL || 'https://expired.badssl.com/';
  throw new Error(`unsupported recovery scenario: ${scenario}`);
};

const safeUrl = (raw) => {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
};

export const extractDevtoolsSockets = (unixSocketTable) => {
  const sockets = new Set();
  const re = /(?:^|\s|@)(webview_devtools_remote_(\d+))/g;
  let match;
  while ((match = re.exec(unixSocketTable))) {
    sockets.add(match[1]);
  }
  return [...sockets].sort((a, b) => Number(b.match(/\d+$/)?.[0] ?? 0) - Number(a.match(/\d+$/)?.[0] ?? 0));
};

const hasDevtoolsUrl = (target) => typeof target?.webSocketDebuggerUrl === 'string' && target.webSocketDebuggerUrl.length > 0;

export const selectDevtoolsTarget = (targets, expectedUrl) => {
  const expected = safeUrl(normalizeSmokeUrl(expectedUrl));
  const candidates = targets.filter((target) => hasDevtoolsUrl(target) && (!target.type || target.type === 'page'));
  if (candidates.length === 0) return null;

  const expectedOrigin = expected?.origin;
  if (expectedOrigin) {
    const exact = candidates.find((target) => safeUrl(target.url)?.origin === expectedOrigin);
    if (exact) return exact;
  }

  const localLauncher = candidates.find((target) => {
    const url = safeUrl(target.url);
    return url && url.hostname === 'localhost';
  });
  return localLauncher ?? candidates[0];
};

export const DEFAULT_BLOCKING_CONSOLE_PATTERNS = [
  /Cannot read properties of undefined/i,
  /triggerEvent/i,
  /WebSocket connection to .*(?:\/api\/terminal|\/api\/v2\/terminal|\/api\/timeline|\/api\/status|\/api\/sync)/i,
];

const BLOCKING_WEBSOCKET_RE = /WebSocket connection to .*(?:\/api\/terminal|\/api\/v2\/terminal|\/api\/timeline|\/api\/status|\/api\/sync)/i;

const consoleEventText = (event) =>
  [event?.text, event?.message, event?.description, event?.url]
    .filter(Boolean)
    .join(' ');

const isNextDevHmrStaticIndicatorWarning = (event, text) =>
  event?.type === 'warning'
  && text.includes('[HMR] Invalid message:')
  && text.includes('handleStaticIndicator')
  && text.includes('/_next/static/chunks/');

export const collectBlockingConsoleEvents = (events, patterns = DEFAULT_BLOCKING_CONSOLE_PATTERNS) =>
  events.filter((event) => {
    const text = consoleEventText(event);
    if (isNextDevHmrStaticIndicatorWarning(event, text)) return false;
    if (BLOCKING_WEBSOCKET_RE.test(text) && event?.type !== 'error') return false;
    return patterns.some((pattern) => pattern.test(text));
  });

export const DEFAULT_BLOCKING_LOGCAT_RE = /(Cannot read properties of undefined|triggerEvent|FATAL EXCEPTION|\bE\/AndroidRuntime\b|\bE\s+AndroidRuntime\b|ERR_CLEARTEXT_NOT_PERMITTED)/i;

const isNextDevStaticIndicatorLogcatWarning = (line) =>
  /Cannot read properties of undefined \(reading ['"]components['"]\)/i.test(line);

export const collectBlockingLogcatLines = (logcat, pattern = DEFAULT_BLOCKING_LOGCAT_RE) =>
  String(logcat || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line && pattern.test(line) && !isNextDevStaticIndicatorLogcatWarning(line));

export const isExpectedRemoteState = (state, expectedUrl) => {
  const href = safeUrl(state?.href);
  const expected = safeUrl(normalizeSmokeUrl(expectedUrl));
  return !!href && !!expected && href.origin === expected.origin && state?.readyState === 'complete';
};

export const isLauncherState = (state) => {
  const href = safeUrl(state?.href);
  return !!href && href.hostname === 'localhost' && state?.hasLauncher === true;
};

export const runCommand = (command, args, options = {}) => {
  try {
    return execFileSync(command, args, {
      cwd: options.cwd ?? process.cwd(),
      encoding: 'utf8',
      maxBuffer: options.maxBuffer ?? 20 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
    }).trim();
  } catch (err) {
    if (options.allowFailure) {
      return err.stdout?.toString?.().trim?.() ?? '';
    }
    const stdout = err.stdout?.toString?.() ?? '';
    const stderr = err.stderr?.toString?.() ?? '';
    throw new Error(`${command} ${args.join(' ')} failed: ${stderr || stdout || err.message}`);
  }
};

export const resolveAdbPath = ({
  env = process.env,
  homeDir = os.homedir(),
  platform = process.platform,
  exists = existsSync,
} = {}) => {
  if (env.ADB) return env.ADB;
  const adbName = platform === 'win32' ? 'adb.exe' : 'adb';
  const candidates = [
    path.join(homeDir, 'Android', 'Sdk', 'platform-tools', adbName),
    ...(env.LOCALAPPDATA ? [
      path.join(
        env.LOCALAPPDATA,
        'Microsoft',
        'WinGet',
        'Packages',
        'Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe',
        'platform-tools',
        adbName,
      ),
    ] : []),
    ...(platform === 'win32' ? [
      path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Android', 'android-sdk', 'platform-tools', adbName),
      path.join(env.ProgramFiles || 'C:\\Program Files', 'Android', 'android-sdk', 'platform-tools', adbName),
    ] : []),
  ];

  return candidates.find((candidate) => exists(candidate)) ?? 'adb';
};

export const findAdb = () => resolveAdbPath();

export const selectAndroidSerial = (adb, requestedSerial = process.env.ANDROID_SERIAL) => {
  const devicesOutput = runCommand(adb, ['devices']);
  const devices = devicesOutput
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial);

  if (requestedSerial) {
    if (!devices.includes(requestedSerial)) {
      throw new Error(`ANDROID_SERIAL is not connected: ${requestedSerial}; connected=${devices.join(',') || '-'}`);
    }
    return requestedSerial;
  }
  if (devices.length !== 1) {
    throw new Error(`expected exactly one connected Android device or ANDROID_SERIAL; connected=${devices.join(',') || '-'}`);
  }
  return devices[0];
};

export const adbArgsFor = (serial) => (serial ? ['-s', serial] : []);

export const wakeAndroidDevice = ({ adb, adbArgs, run = runCommand }) => {
  run(adb, [...adbArgs, 'shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'], { allowFailure: true });
  run(adb, [...adbArgs, 'shell', 'wm', 'dismiss-keyguard'], { allowFailure: true });
  run(adb, [...adbArgs, 'shell', 'input', 'keyevent', 'KEYCODE_MENU'], { allowFailure: true });
};

export const getFreePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });

export const waitFor = async (label, fn, timeoutMs = 20_000, intervalMs = 250) => {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (err) {
      lastError = err;
    }
    await sleep(intervalMs);
  }
  throw new Error(`${label} timed out${lastError instanceof Error ? `: ${lastError.message}` : ''}`);
};

export const fetchJson = async (url, timeoutMs = FETCH_TIMEOUT_MS) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return await res.json();
};

export const discoverDevtoolsTarget = async ({
  adb,
  adbArgs,
  expectedUrl,
  requestedPort,
  timeoutMs = 20_000,
}) =>
  waitFor('Android WebView DevTools target', async () => {
    const unixTable = runCommand(adb, [...adbArgs, 'shell', 'cat', '/proc/net/unix']);
    const sockets = extractDevtoolsSockets(unixTable);
    for (const socket of sockets) {
      const port = requestedPort || await getFreePort();
      runCommand(adb, [...adbArgs, 'forward', '--remove', `tcp:${port}`], { allowFailure: true });
      runCommand(adb, [...adbArgs, 'forward', `tcp:${port}`, `localabstract:${socket}`]);
      try {
        const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
        const target = selectDevtoolsTarget(Array.isArray(targets) ? targets : [], expectedUrl);
        if (target) return { socket, port, target };
      } catch {
        runCommand(adb, [...adbArgs, 'forward', '--remove', `tcp:${port}`], { allowFailure: true });
      }
      if (requestedPort) break;
    }
    return null;
  }, timeoutMs);

export const connectCdp = (webSocketDebuggerUrl) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    let nextId = 1;
    const pending = new Map();
    const listeners = new Map();

    const cleanup = () => {
      for (const { reject: rejectPending, timer } of pending.values()) {
        clearTimeout(timer);
        rejectPending(new Error('CDP connection closed'));
      }
      pending.clear();
    };

    const send = (method, params = {}, timeoutMs = CDP_TIMEOUT_MS) =>
      new Promise((resolveSend, rejectSend) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          rejectSend(new Error(`CDP ${method} timed out`));
        }, timeoutMs);
        pending.set(id, { resolve: resolveSend, reject: rejectSend, timer });
        ws.send(JSON.stringify({ id, method, params }));
      });

    ws.on('open', () => {
      resolve({
        on: (method, cb) => {
          if (!listeners.has(method)) listeners.set(method, new Set());
          listeners.get(method).add(cb);
          return () => listeners.get(method)?.delete(cb);
        },
        send,
        close: () => {
          if (ws.readyState === WebSocket.CLOSED) return;
          ws.terminate();
        },
        get readyState() {
          return ws.readyState;
        },
      });
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.id && pending.has(msg.id)) {
        const entry = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.error) entry.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else entry.resolve(msg.result ?? null);
        return;
      }

      const callbacks = listeners.get(msg.method);
      if (callbacks) {
        for (const cb of callbacks) cb(msg.params ?? {});
      }
    });

    ws.on('error', reject);
    ws.on('close', cleanup);
  });

export const enableCdpDomains = async (cdp) => {
  await Promise.allSettled([
    cdp.send('Page.enable'),
    cdp.send('Runtime.enable'),
    cdp.send('Log.enable'),
  ]);
};

export const attachConsoleCollectors = (cdp, events) => {
  cdp.on('Runtime.consoleAPICalled', (params) => {
    const text = (params.args ?? [])
      .map((arg) => arg.value ?? arg.description ?? arg.unserializableValue ?? '')
      .filter(Boolean)
      .join(' ');
    events.push({
      source: 'console',
      type: params.type,
      text,
      url: params.stackTrace?.callFrames?.[0]?.url ?? '',
    });
  });
  cdp.on('Runtime.exceptionThrown', (params) => {
    events.push({
      source: 'exception',
      type: 'error',
      text: params.exceptionDetails?.text ?? params.exceptionDetails?.exception?.description ?? '',
      url: params.exceptionDetails?.url ?? '',
    });
  });
  cdp.on('Log.entryAdded', (params) => {
    const entry = params.entry ?? {};
    events.push({
      source: 'log',
      type: entry.level,
      text: entry.text ?? '',
      url: entry.url ?? '',
    });
  });
};

export const evaluate = async (cdp, expression, timeoutMs) => {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, timeoutMs);
  if (result?.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || result.exceptionDetails.exception?.description || 'Runtime.evaluate failed');
  }
  return result?.result?.value;
};

export const readWebViewState = async (cdp) =>
  evaluate(cdp, `(() => ({
    href: location.href,
    origin: location.origin,
    readyState: document.readyState,
    title: document.title,
    bodyText: document.body ? document.body.innerText.slice(0, 1000) : '',
    hasLauncher: !!document.getElementById('connect-current'),
    hasLoginForm: !!document.querySelector('form[action], input[type="password"], [data-testid="login-form"]'),
    bridgeTriggerEventType: typeof window.Capacitor?.triggerEvent,
    hasCodexmuxAndroid: !!window.CodexmuxAndroid
  }))()`);

export const waitForExpectedRemoteState = (cdp, expectedUrl, timeoutMs = 30_000) =>
  waitFor('remote codexmux page', async () => {
    const state = await readWebViewState(cdp);
    return isExpectedRemoteState(state, expectedUrl) ? state : null;
  }, timeoutMs);

export const waitForLauncherState = (cdp, timeoutMs = 30_000) =>
  waitFor('Android launcher page', async () => {
    const state = await readWebViewState(cdp);
    return isLauncherState(state) ? state : null;
  }, timeoutMs);

export const navigateCdp = async (cdp, url) => {
  await cdp.send('Page.navigate', { url });
};

export const reconnectLauncherToServer = async (cdp, targetUrl) => {
  const normalized = normalizeSmokeUrl(targetUrl);
  await evaluate(cdp, `(() => {
    localStorage.removeItem('codexmux:server-url');
    localStorage.removeItem('codexmux:recent-server-urls');
    localStorage.setItem('codexwinmux:server-url', ${JSON.stringify(normalized)});
    localStorage.setItem('codexwinmux:recent-server-urls', JSON.stringify([${JSON.stringify(normalized)}]));
    const button = document.getElementById('connect-current');
    if (button && !button.disabled) {
      button.click();
      return true;
    }
    window.location.href = ${JSON.stringify(normalized)};
    return false;
  })()`);
};

export const startAndroidApp = ({ adb, adbArgs, activity = DEFAULT_ANDROID_ACTIVITY }) =>
  runCommand(adb, [...adbArgs, 'shell', 'am', 'start', '-n', activity]);

export const forceStopAndroidApp = ({ adb, adbArgs, appId = DEFAULT_ANDROID_APP_ID }) =>
  runCommand(adb, [...adbArgs, 'shell', 'am', 'force-stop', appId], { allowFailure: true });

export const clearAndroidAppData = ({ adb, adbArgs, appId = DEFAULT_ANDROID_APP_ID }) =>
  runCommand(adb, [...adbArgs, 'shell', 'pm', 'clear', appId]);

export const backgroundAndroidApp = ({ adb, adbArgs }) =>
  runCommand(adb, [...adbArgs, 'shell', 'input', 'keyevent', 'KEYCODE_HOME'], { allowFailure: true });

export const clearLogcat = ({ adb, adbArgs }) =>
  runCommand(adb, [...adbArgs, 'logcat', '-c'], { allowFailure: true });

export const dumpLogcat = ({ adb, adbArgs }) =>
  runCommand(adb, [...adbArgs, 'logcat', '-d'], { allowFailure: true, maxBuffer: 40 * 1024 * 1024 });

export const removeForward = ({ adb, adbArgs, port }) => {
  if (port) runCommand(adb, [...adbArgs, 'forward', '--remove', `tcp:${port}`], { allowFailure: true });
};
