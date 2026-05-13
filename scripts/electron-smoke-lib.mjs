import fs from 'fs';
import path from 'path';

const safeUrl = (raw) => {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
};

export const normalizeElectronSmokeUrl = (raw) => {
  const value = String(raw || '').trim();
  if (!value) throw new Error('Electron smoke URL is required');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;
  const url = new URL(withScheme);
  url.hash = '';
  return url.toString().replace(/\/$/, '');
};

const buildElectronChromeArgs = ({ remoteDebuggingPort }) => [
  `--remote-debugging-port=${remoteDebuggingPort}`,
  '--disable-gpu',
  '--no-sandbox',
];

export const buildElectronSmokeArgs = ({ remoteDebuggingPort, appPath = '.' }) => [
  ...buildElectronChromeArgs({ remoteDebuggingPort }),
  appPath,
];

const isMacAppBundlePath = (appPath) => /\.app\/?$/i.test(String(appPath || ''));

const isWindowsExecutablePath = (appPath) => /\.exe$/i.test(String(appPath || ''));

const resolveMacAppExecutable = (appPath) => {
  const macOsDir = path.join(appPath, 'Contents', 'MacOS');
  const baseName = path.basename(appPath).replace(/\.app$/i, '');
  const entries = fs.readdirSync(macOsDir, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile() || entry.isSymbolicLink())
    .map((entry) => path.join(macOsDir, entry.name))
    .filter((candidate) => {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  const preferred = candidates.find((candidate) => path.basename(candidate) === baseName);
  if (preferred) return preferred;
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    throw new Error(`Multiple Electron .app executables found in ${macOsDir}: ${candidates.map(path.basename).join(', ')}`);
  }
  throw new Error(`No executable found in Electron .app bundle: ${macOsDir}`);
};

export const buildElectronSmokeLaunchCommand = ({
  remoteDebuggingPort,
  appPath = '.',
  platform = process.platform,
}) => {
  const normalizedAppPath = String(appPath || '').trim() || '.';
  const chromeArgs = buildElectronChromeArgs({ remoteDebuggingPort });

  if (isMacAppBundlePath(normalizedAppPath)) {
    if (platform !== 'darwin') {
      throw new Error(`Electron .app smoke requires macOS; current platform is ${platform}`);
    }
    return {
      command: resolveMacAppExecutable(normalizedAppPath),
      args: chromeArgs,
      mode: 'mac-app',
    };
  }

  if (isWindowsExecutablePath(normalizedAppPath)) {
    if (platform !== 'win32') {
      throw new Error(`Electron .exe smoke requires Windows; current platform is ${platform}`);
    }
    return {
      command: normalizedAppPath,
      args: chromeArgs,
      mode: 'windows-exe',
    };
  }

  const cliArgs = ['pnpm', 'exec', 'electron', ...buildElectronSmokeArgs({
    remoteDebuggingPort,
    appPath: normalizedAppPath,
  })];

  if (platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', ['corepack', ...cliArgs].join(' ')],
      mode: 'electron-cli',
    };
  }

  return {
    command: 'corepack',
    args: cliArgs,
    mode: 'electron-cli',
  };
};

const hasDevtoolsUrl = (target) =>
  typeof target?.webSocketDebuggerUrl === 'string' && target.webSocketDebuggerUrl.length > 0;

export const selectElectronPageTarget = (targets, expectedUrl) => {
  const expected = safeUrl(normalizeElectronSmokeUrl(expectedUrl));
  const candidates = targets.filter((target) => target?.type === 'page' && hasDevtoolsUrl(target));
  if (candidates.length === 0) return null;

  const exact = candidates.find((target) => safeUrl(target.url)?.origin === expected?.origin);
  return exact ?? candidates[0];
};

export const selectElectronLocalPageTarget = (targets) => {
  const candidates = targets.filter((target) => target?.type === 'page' && hasDevtoolsUrl(target));
  return candidates.find((target) => {
    const url = safeUrl(target.url);
    return url?.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  }) ?? null;
};

const quoteShellArg = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

export const normalizeElectronReconnectRounds = (raw, fallback = 2) => {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(10, Math.floor(parsed)));
};

export const normalizeElectronWindowForegroundCycles = (raw, fallback = 0) => {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(5, Math.floor(parsed)));
};

export const buildElectronRuntimeV2ReconnectRounds = ({
  baseMarker,
  reconnectRounds = 2,
}) => {
  const markerPrefix = String(baseMarker || 'electron-runtime-v2');
  const rounds = [
    {
      label: 'initial',
      marker: `${markerPrefix}-initial`,
      reloadBefore: false,
    },
  ];

  for (let i = 1; i <= normalizeElectronReconnectRounds(reconnectRounds); i += 1) {
    rounds.push({
      label: `reconnect-${i}`,
      marker: `${markerPrefix}-reconnect-${i}`,
      reloadBefore: true,
    });
  }

  return rounds;
};

export const buildElectronRuntimeV2EvalScript = ({
  sessionName,
  marker,
  commandKind = 'posix',
  cols = 100,
  rows = 30,
  timeoutMs = 20_000,
}) => {
  const markerCommand = commandKind === 'windows'
    ? `echo ${String(marker).replace(/[&|<>^]/g, '')}\r`
    : `printf '%s\\n' ${quoteShellArg(marker)}\r`;
  const safeCols = Number(cols) || 100;
  const safeRows = Number(rows) || 30;
  const safeTimeoutMs = Number(timeoutMs) || 20_000;

  return `(() => new Promise((resolve, reject) => {
  const sessionName = ${JSON.stringify(sessionName)};
  const marker = ${JSON.stringify(marker)};
  const command = ${JSON.stringify(markerCommand)};
  const cols = ${safeCols};
  const rows = ${safeRows};
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = new URL('/api/v2/terminal', proto + '//' + location.host);
  url.searchParams.set('session', sessionName);
  url.searchParams.set('clientId', 'electron-runtime-v2-smoke');
  url.searchParams.set('cols', String(cols));
  url.searchParams.set('rows', String(rows));
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let output = '';
  let settled = false;
  let ws = null;
  let timer = null;
  const frame = (type, value) => {
    const payload = encoder.encode(value);
    const bytes = new Uint8Array(1 + payload.length);
    bytes[0] = type;
    bytes.set(payload, 1);
    return bytes;
  };
  const resize = () => {
    const buffer = new ArrayBuffer(5);
    const view = new DataView(buffer);
    view.setUint8(0, 2);
    view.setUint16(1, cols);
    view.setUint16(3, rows);
    return buffer;
  };
  const fail = (error) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    if (ws) ws.close();
    reject(error);
  };
  const finish = (ws, result) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    ws.close();
    resolve(result);
  };
  ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  timer = setTimeout(() => {
    fail(new Error('runtime v2 Electron WebSocket timed out: ' + JSON.stringify(output.slice(-200))));
  }, ${safeTimeoutMs});
  ws.onopen = () => {
    ws.send(resize());
    ws.send(frame(0, command));
  };
  ws.onerror = () => {
    fail(new Error('runtime v2 Electron WebSocket error'));
  };
  ws.onclose = (event) => {
    if (!settled && !output.includes(marker)) {
      fail(new Error('runtime v2 Electron WebSocket closed before marker: ' + event.code + ' ' + event.reason + ' output=' + JSON.stringify(output.slice(-200))));
    }
  };
  ws.onmessage = (event) => {
    const append = (buffer) => {
      const bytes = new Uint8Array(buffer);
      if (bytes[0] === 1) output += decoder.decode(bytes.slice(1));
      if (output.includes(marker)) finish(ws, { marker, output, url: url.toString() });
    };
    if (event.data instanceof Blob) {
      event.data.arrayBuffer().then(append).catch(reject);
    } else {
      append(event.data);
    }
  };
}))()`;
};
