import { capturePristineEnv } from './pristine-env';
import { applyResolvedShellEnv } from './shell-env';
import { buildEngineUrl, createEngineController, probeEngineHealth } from './engine-controller';
import {
  applyElectronBootstrapEnv,
  applyPackagedServerEnv,
  buildFileImportSpecifier,
  buildPackagedNodePath,
} from './runtime-env';
import { appendUpdaterSmokeStatus, readUpdaterSmokeConfig } from './updater-smoke';
import { applyAutoUpdaterRuntimeDefaults } from './updater-config';
import { resolveTrayIconPath } from './tray-icon';
import { bootstrapCoreOnly, shutdownCoreOnly } from './core-process';
import { buildEngineProcessArgs, resolveElectronProcessRole } from './engine-process';
import { app, BrowserWindow, shell, Menu, ipcMain, session, screen, Notification, nativeTheme, dialog, Tray, nativeImage } from 'electron';
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { pickTaglines } from './splash-taglines';
import { initBrowserBridge } from './browser-bridge';

const isDev = process.env.NODE_ENV === 'development';
const devUrl = process.env.ELECTRON_DEV_URL;
const APP_DISPLAY_NAME = 'codexwinmux';
const APP_PROCESS_NAME = 'codexwinmux';
const electronProcessRole = resolveElectronProcessRole(process.argv, process.env);
const isEngineProcess = electronProcessRole === 'engine';
const isCoreProcess = electronProcessRole === 'core';

const writeCoreBootstrapTrace = (stage: string, details?: Record<string, unknown>): void => {
  if (process.env.CODEXWINMUX_CORE_BOOTSTRAP_TRACE !== '1') return;
  try {
    const target = process.env.CODEXWINMUX_CORE_BOOTSTRAP_TRACE_FILE
      || path.join(os.tmpdir(), 'codexwinmux-core-bootstrap-trace.log');
    fs.appendFileSync(target, `${new Date().toISOString()} ${stage} ${JSON.stringify(details ?? {})}\n`);
  } catch {
    // Diagnostic-only path.
  }
};

writeCoreBootstrapTrace('main:role', {
  argv: process.argv,
  role: electronProcessRole,
  envCore: process.env.CODEXWINMUX_ELECTRON_CORE_PROCESS,
});

const readCodexwinmuxAlias = (legacyKey: string): string | undefined =>
  process.env[legacyKey.replace(/^CODEXMUX_/, 'CODEXWINMUX_')] || process.env[legacyKey];

const isRuntimeLegacyKey = (legacyKey: string): boolean =>
  legacyKey.startsWith('CODEXMUX_RUNTIME_');

const buildCodexwinmuxAliasEnv = (legacyKey: string, fallback: string): Record<string, string> => {
  const preferredKey = legacyKey.replace(/^CODEXMUX_/, 'CODEXWINMUX_');
  const value = (isRuntimeLegacyKey(legacyKey) ? process.env[preferredKey] : readCodexwinmuxAlias(legacyKey)) || fallback;
  return isRuntimeLegacyKey(legacyKey)
    ? { [preferredKey]: value }
    : { [preferredKey]: value, [legacyKey]: value };
};

const fixEnv = () => {
  applyElectronBootstrapEnv(process.env, process.platform);
};

// --- Server Config (~/.codexwinmux/config.json) ---

interface IServerConfig {
  mode: 'local' | 'remote';
  remoteUrl?: string;
}

interface IWindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized?: boolean;
  isFullScreen?: boolean;
  displayId?: number;
}

interface IAppConfig {
  server?: IServerConfig;
  windowState?: IWindowState;
  appTheme?: string;
}

const CONFIG_DIR = path.join(os.homedir(), '.codexwinmux');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const readAppConfig = (): IAppConfig => {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
};

const writeAppConfig = (config: IAppConfig) => {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const tmp = CONFIG_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
    fs.renameSync(tmp, CONFIG_FILE);
  } catch (err) {
    console.error('[electron] Failed to save config.json:', err);
  }
};

const readServerConfig = (): IServerConfig => {
  const cfg = readAppConfig();
  if (cfg.server?.mode === 'remote' && cfg.server?.remoteUrl) {
    return { mode: 'remote', remoteUrl: cfg.server.remoteUrl };
  }
  return { mode: 'local' };
};

const writeServerConfig = (server: IServerConfig) => {
  const cfg = readAppConfig();
  cfg.server = server;
  writeAppConfig(cfg);
};

// --- Window State ---

const DEFAULT_WINDOW_STATE: IWindowState = { width: 1280, height: 800 };

const readWindowState = (): IWindowState => {
  const cfg = readAppConfig();
  return cfg.windowState || DEFAULT_WINDOW_STATE;
};

const writeWindowState = (state: IWindowState) => {
  const cfg = readAppConfig();
  cfg.windowState = state;
  writeAppConfig(cfg);
};

const isVisibleOnAnyDisplay = (bounds: { x: number; y: number; width: number; height: number }): boolean => {
  const displays = screen.getAllDisplays();
  const MIN_OVERLAP = 50;
  return displays.some((display) => {
    const { x, y, width, height } = display.workArea;
    const overlapX = Math.max(0, Math.min(bounds.x + bounds.width, x + width) - Math.max(bounds.x, x));
    const overlapY = Math.max(0, Math.min(bounds.y + bounds.height, y + height) - Math.max(bounds.y, y));
    return overlapX >= MIN_OVERLAP && overlapY >= MIN_OVERLAP;
  });
};

// --- Prompt Window ---

const showServerPrompt = (parent: BrowserWindow, currentUrl?: string): Promise<string | null> =>
  new Promise((resolve) => {
    const prompt = new BrowserWindow({
      width: 420,
      height: 180,
      parent,
      modal: true,
      resizable: false,
      show: false,
      minimizable: false,
      maximizable: false,
      backgroundColor: '#09090b',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    const escaped = (currentUrl || 'http://').replace(/"/g, '&quot;');
    const m = mt();
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${m.serverConnection}</title><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#09090b;color:#fafafa;font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:24px}
label{display:block;margin-bottom:8px;font-size:13px;color:#a1a1aa}
input{width:100%;padding:8px 12px;border:1px solid #27272a;border-radius:6px;background:#18181b;color:#fafafa;font-size:14px;outline:none}
input:focus{border-color:#7c3aed}
.buttons{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
button{padding:6px 16px;border-radius:6px;border:1px solid #27272a;font-size:13px;cursor:pointer}
.cancel{background:#27272a;color:#fafafa}.cancel:hover{background:#3f3f46}
.connect{background:#7c3aed;color:#fff;border-color:#7c3aed}.connect:hover{background:#6d28d9}
</style></head><body>
<label>${m.serverAddress}</label>
<input id="url" value="${escaped}" placeholder="http://192.168.1.100:8121"/>
<div class="buttons">
<button class="cancel" id="cancelBtn">${m.cancel}</button>
<button class="connect" id="connectBtn">${m.connect}</button>
</div>
<script>
var input=document.getElementById('url');
input.focus();input.select();
document.getElementById('cancelBtn').onclick=function(){window.close()};
document.getElementById('connectBtn').onclick=function(){
  var v=input.value.trim();
  if(v){document.title='CONNECT:'+v;window.close()}
};
input.onkeydown=function(e){
  if(e.key==='Enter')document.getElementById('connectBtn').click();
  if(e.key==='Escape')window.close();
};
</script></body></html>`;

    let result: string | null = null;

    prompt.webContents.on('page-title-updated', (_e, title) => {
      if (title.startsWith('CONNECT:')) {
        result = title.slice('CONNECT:'.length);
      }
    });

    prompt.on('closed', () => resolve(result));
    prompt.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    prompt.once('ready-to-show', () => prompt.show());
  });

// --- i18n ---

interface IMenuMessages {
  server: string;
  useLocalServer: string;
  connectRemoteServer: string;
  edit: string;
  view: string;
  window: string;
  newWindow: string;
  serverConnection: string;
  serverAddress: string;
  cancel: string;
  connect: string;
  checkForUpdates: string;
  updateAvailableMessage: string;
  updateAvailableDetail: string;
  download: string;
  later: string;
  updateReadyMessage: string;
  updateReadyDetail: string;
  restartNow: string;
  upToDateMessage: string;
  upToDateDetail: string;
  updateErrorMessage: string;
  openWindow: string;
  restartEngine: string;
  stopEngine: string;
  quitUi: string;
  quitUiAndStopEngine: string;
  engineNotOwnedMessage: string;
  engineStartErrorMessage: string;
}

const menuMessages: Record<string, IMenuMessages> = {
  en: { server: 'Server', useLocalServer: 'Use Local Server', connectRemoteServer: 'Connect to Remote Server…', edit: 'Edit', view: 'View', window: 'Window', newWindow: 'New Window', serverConnection: 'Server Connection', serverAddress: 'Server Address', cancel: 'Cancel', connect: 'Connect', checkForUpdates: 'Check for Updates…', updateAvailableMessage: 'A new version ({version}) is available', updateAvailableDetail: 'Would you like to download it now?', download: 'Download', later: 'Later', updateReadyMessage: 'Version {version} is ready to install', updateReadyDetail: 'Restart codexwinmux to apply the update.', restartNow: 'Restart Now', upToDateMessage: "You're up to date", upToDateDetail: 'codexwinmux {version} is the latest version.', updateErrorMessage: 'Failed to check for updates', openWindow: 'Open Window', restartEngine: 'Restart Engine', stopEngine: 'Stop Engine', quitUi: 'Quit UI', quitUiAndStopEngine: 'Quit UI and Stop Engine', engineNotOwnedMessage: 'This UI did not start the current engine, so it will not stop an unrelated process.', engineStartErrorMessage: 'The local engine could not be started.' },
  ko: { server: '서버', useLocalServer: '로컬 서버 사용', connectRemoteServer: '원격 서버 연결…', edit: '편집', view: '보기', window: '창', newWindow: '새 창', serverConnection: '서버 연결', serverAddress: '서버 주소', cancel: '취소', connect: '연결', checkForUpdates: '업데이트 확인…', updateAvailableMessage: '새 버전({version})이 있습니다', updateAvailableDetail: '지금 다운로드할까요?', download: '다운로드', later: '나중에', updateReadyMessage: '{version} 버전 설치 준비 완료', updateReadyDetail: 'codexwinmux를 재시작하면 업데이트가 적용됩니다.', restartNow: '지금 재시작', upToDateMessage: '최신 버전입니다', upToDateDetail: 'codexwinmux {version}을 사용 중입니다.', updateErrorMessage: '업데이트 확인에 실패했습니다', openWindow: '창 열기', restartEngine: '엔진 재시작', stopEngine: '엔진 중지', quitUi: 'UI 종료', quitUiAndStopEngine: 'UI와 엔진 종료', engineNotOwnedMessage: '현재 엔진은 이 UI가 시작한 프로세스가 아니므로 관련 없는 프로세스를 중지하지 않습니다.', engineStartErrorMessage: '로컬 엔진을 시작할 수 없습니다.' },
};

let currentLocale = 'en';

const mt = (): IMenuMessages => menuMessages[currentLocale] || menuMessages.en;

const readLocaleFromConfig = (): string => {
  const cfg = readAppConfig();
  return (cfg as Record<string, unknown>).locale === 'ko' ? 'ko' : 'en';
};

// --- State ---

const windows = new Set<BrowserWindow>();
let lastFocusedWindow: BrowserWindow | null = null;
let serverShutdown: (() => Promise<void>) | null = null;
let isQuitting = false;
let stopEngineOnQuit = false;
let serverConfig: IServerConfig = { mode: 'local' };
let localPort: number | null = null;
let cachedStart: ((opts: { port: number }) => Promise<{ port: number; shutdown: () => Promise<void> }>) | null = null;
let tray: Tray | null = null;
let engineController: ReturnType<typeof createEngineController> | null = null;

const getPrimaryWindow = (): BrowserWindow | null => {
  if (lastFocusedWindow && !lastFocusedWindow.isDestroyed() && windows.has(lastFocusedWindow)) {
    return lastFocusedWindow;
  }
  for (const w of windows) {
    if (!w.isDestroyed()) return w;
  }
  return null;
};

const resolveCurrentUrl = (): string | null => {
  const primary = getPrimaryWindow();
  const url = primary?.webContents.getURL();
  if (url && url !== 'about:blank' && !url.startsWith('data:')) return url;
  if (serverConfig.mode === 'remote' && serverConfig.remoteUrl) return serverConfig.remoteUrl;
  if (localPort) return `http://localhost:${localPort}`;
  return null;
};

// --- Auto Updater ---

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 3000;
const UPDATER_SMOKE_FIRST_CHECK_DELAY_MS = 500;

let updaterInitialized = false;
let updateCheckTimer: ReturnType<typeof setInterval> | null = null;
let pendingUpdateVersion: string | null = null;
let isUpdateDialogOpen = false;
const updaterSmokeConfig = readUpdaterSmokeConfig();

const formatMsg = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');

const canRunUpdater = (): boolean =>
  process.env.CODEXMUX_ELECTRON_UPDATER_DISABLED !== '1'
  && !isDev
  && !devUrl
  && app.isPackaged;

const showUpdateDialog = (options: Electron.MessageBoxOptions) => {
  const primary = getPrimaryWindow();
  return primary
    ? dialog.showMessageBox(primary, options)
    : dialog.showMessageBox(options);
};

const runExclusiveDialog = async (fn: () => Promise<void>) => {
  if (isUpdateDialogOpen) return;
  isUpdateDialogOpen = true;
  try {
    await fn();
  } catch (err) {
    console.error('[updater] dialog error:', err);
  } finally {
    isUpdateDialogOpen = false;
  }
};

const setupAutoUpdater = () => {
  if (updaterInitialized || !canRunUpdater()) return;
  updaterInitialized = true;

  if (updaterSmokeConfig.feedUrl) {
    autoUpdater.setFeedURL({ provider: 'generic', url: updaterSmokeConfig.feedUrl });
    appendUpdaterSmokeStatus(updaterSmokeConfig, 'configured', {
      feedProvider: 'generic',
      feedUrl: updaterSmokeConfig.feedUrl,
    });
  }
  if (updaterSmokeConfig.disableDifferentialDownload) {
    autoUpdater.disableDifferentialDownload = true;
  }
  if (updaterSmokeConfig.installDir) {
    (autoUpdater as unknown as { installDirectory?: string }).installDirectory = updaterSmokeConfig.installDir;
  }

  applyAutoUpdaterRuntimeDefaults(autoUpdater);

  autoUpdater.on('checking-for-update', () => {
    appendUpdaterSmokeStatus(updaterSmokeConfig, 'checking-for-update');
  });

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    appendUpdaterSmokeStatus(updaterSmokeConfig, 'update-not-available', { version: info.version });
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    appendUpdaterSmokeStatus(updaterSmokeConfig, 'update-available', { version: info.version });
    if (pendingUpdateVersion === info.version) return;
    pendingUpdateVersion = info.version;

    if (updaterSmokeConfig.autoDownload) {
      appendUpdaterSmokeStatus(updaterSmokeConfig, 'download-started', { version: info.version });
      getPrimaryWindow()?.setProgressBar(0.05);
      autoUpdater.downloadUpdate().catch((err) => {
        appendUpdaterSmokeStatus(updaterSmokeConfig, 'error', { error: err });
        console.error('[updater] downloadUpdate failed:', err);
      });
      return;
    }

    runExclusiveDialog(async () => {
      const m = mt();
      const result = await showUpdateDialog({
        type: 'info',
        buttons: [m.download, m.later],
        defaultId: 0,
        cancelId: 1,
        message: formatMsg(m.updateAvailableMessage, { version: info.version }),
        detail: m.updateAvailableDetail,
      });
      if (result.response === 0) {
        getPrimaryWindow()?.setProgressBar(0.05);
        appendUpdaterSmokeStatus(updaterSmokeConfig, 'download-started', { version: info.version });
        autoUpdater.downloadUpdate().catch((err) => {
          appendUpdaterSmokeStatus(updaterSmokeConfig, 'error', { error: err });
          console.error('[updater] downloadUpdate failed:', err);
        });
      }
    });
  });

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    appendUpdaterSmokeStatus(updaterSmokeConfig, 'download-progress', { percent: progress.percent });
    getPrimaryWindow()?.setProgressBar(progress.percent / 100);
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    getPrimaryWindow()?.setProgressBar(-1);
    appendUpdaterSmokeStatus(updaterSmokeConfig, 'update-downloaded', {
      version: info.version,
      downloadedFile: (info as UpdateInfo & { downloadedFile?: string }).downloadedFile,
    });

    if (updaterSmokeConfig.autoInstall) {
      isQuitting = true;
      setTimeout(() => {
        appendUpdaterSmokeStatus(updaterSmokeConfig, 'process-exit-for-install', { version: info.version });
        process.exit(0);
      }, 5000);
      appendUpdaterSmokeStatus(updaterSmokeConfig, 'quit-and-install-started', { version: info.version });
      autoUpdater.quitAndInstall(true, false);
      return;
    }

    runExclusiveDialog(async () => {
      const m = mt();
      const result = await showUpdateDialog({
        type: 'info',
        buttons: [m.restartNow, m.later],
        defaultId: 0,
        cancelId: 1,
        message: formatMsg(m.updateReadyMessage, { version: info.version }),
        detail: m.updateReadyDetail,
      });
      if (result.response === 0) {
        isQuitting = true;
        appendUpdaterSmokeStatus(updaterSmokeConfig, 'quit-and-install-started', { version: info.version });
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on('error', (err: Error) => {
    appendUpdaterSmokeStatus(updaterSmokeConfig, 'error', { error: err });
    console.error('[updater]', err);
    pendingUpdateVersion = null;
    getPrimaryWindow()?.setProgressBar(-1);
  });
};

const checkForUpdatesAuto = () => {
  if (!canRunUpdater()) return;
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[updater] auto check failed:', err);
  });
};

const checkForUpdatesManual = async () => {
  if (!canRunUpdater()) return;
  // manual check는 유저가 명시적으로 눌렀으므로 dedup을 건너뛰어 항상 다이얼로그를 띄움
  pendingUpdateVersion = null;
  let updateFound = false;
  const markFound = () => { updateFound = true; };
  autoUpdater.once('update-available', markFound);
  try {
    await autoUpdater.checkForUpdates();
    if (updateFound) return;
    const m = mt();
    await showUpdateDialog({
      type: 'info',
      buttons: ['OK'],
      message: m.upToDateMessage,
      detail: formatMsg(m.upToDateDetail, { version: app.getVersion() }),
    });
  } catch (err) {
    console.error('[updater] manual check failed:', err);
    const m = mt();
    await showUpdateDialog({
      type: 'error',
      buttons: ['OK'],
      message: m.updateErrorMessage,
      detail: (err as Error).message,
    });
  } finally {
    autoUpdater.off('update-available', markFound);
  }
};

const startUpdateCheckTimer = () => {
  if (!canRunUpdater() || updateCheckTimer) return;
  updateCheckTimer = setInterval(checkForUpdatesAuto, UPDATE_CHECK_INTERVAL_MS);
};

const stopUpdateCheckTimer = () => {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
};

// --- Local Server ---

const DEFAULT_PORT = 8121;
const ENGINE_URL = buildEngineUrl(DEFAULT_PORT);

const startLocalServer = async ({ allowPortFallback = true }: { allowPortFallback?: boolean } = {}): Promise<number> => {
  if (!cachedStart) {
    const appDir = process.env.__CMUX_APP_DIR!;
    const appDirUnpacked = process.env.__CMUX_APP_DIR_UNPACKED || appDir;
    const standaloneMods = [
      path.join(appDirUnpacked, '.next', 'standalone', 'node_modules'),
      path.join(appDir, '.next', 'standalone', 'node_modules'),
    ];
    process.env.NODE_PATH = buildPackagedNodePath({
      platform: process.platform,
      standaloneModules: standaloneMods,
      existingNodePath: process.env.NODE_PATH,
    });
    require('module').Module._initPaths(); // eslint-disable-line @typescript-eslint/no-require-imports
    const mod = await import(buildFileImportSpecifier(path.join(appDir, 'dist', 'server.js')));
    cachedStart = mod.start;
  }
  let result;
  try {
    result = await cachedStart!({ port: DEFAULT_PORT });
  } catch (err) {
    if (!allowPortFallback) throw err;
    result = await cachedStart!({ port: 0 });
  }
  serverShutdown = result.shutdown;
  localPort = result.port;
  process.title = APP_PROCESS_NAME;
  return result.port;
};

const stopLocalServer = async () => {
  if (serverShutdown) {
    await serverShutdown();
    serverShutdown = null;
    localPort = null;
  }
};

const showEngineError = async (message: string) => {
  await showUpdateDialog({
    type: 'error',
    buttons: ['OK'],
    message,
  });
};

const buildReservedPortsEnv = () => {
  const ports = new Set(
    (process.env.CODEXMUX_RESERVED_PORTS || '')
      .split(/[,\s;]+/)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0 && value <= 65535)
      .map(String),
  );

  for (const arg of process.argv) {
    const match = /^--remote-debugging-port=(\d+)$/.exec(arg);
    if (match) ports.add(match[1]);
  }

  return Array.from(ports).join(',');
};

const launchEngineProcess = () => {
  const child = spawn(process.execPath, buildEngineProcessArgs({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
  }), {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      CODEXWINMUX_ELECTRON_ENGINE_PROCESS: '1',
      CODEXMUX_ELECTRON_ENGINE_PROCESS: '1',
      CODEXWINMUX_WINDOWS_HOST_OWNER: process.env.CODEXWINMUX_WINDOWS_HOST_OWNER || 'tray',
      ...buildCodexwinmuxAliasEnv('CODEXWINMUX_RUNTIME_V2', '1'),
      ...buildCodexwinmuxAliasEnv('CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER', 'windows'),
      ...buildCodexwinmuxAliasEnv('CODEXMUX_PROCESS_INSPECTOR_ADAPTER', 'windows'),
      CODEXMUX_RESERVED_PORTS: buildReservedPortsEnv(),
      HOST: '127.0.0.1',
      PORT: String(DEFAULT_PORT),
    },
  });
  return child;
};

const getEngineController = () => {
  if (!engineController) {
    engineController = createEngineController({
      url: ENGINE_URL,
      deps: {
        probeHealth: (url) => probeEngineHealth(url),
        launchEngine: launchEngineProcess,
      },
    });
  }
  return engineController;
};

const ensureEngineRunning = async (): Promise<number> => {
  const result = await getEngineController().ensureRunning();
  if (!result.ok) {
    throw new Error(result.error || 'engine-start-failed');
  }
  localPort = DEFAULT_PORT;
  updateMenu();
  updateTrayMenu();
  return DEFAULT_PORT;
};

const stopOwnedEngine = async () => {
  const result = await getEngineController().stopOwnedEngine();
  if (result.ok) {
    localPort = null;
    updateMenu();
    updateTrayMenu();
  }
  return result;
};

const restartOwnedEngine = async () => {
  const result = await getEngineController().restartOwnedEngine();
  if (result.ok && 'url' in result) {
    localPort = DEFAULT_PORT;
    updateMenu();
    updateTrayMenu();
  }
  return result;
};

// --- Menu ---

const getServerLabel = (): string => {
  if (serverConfig.mode === 'remote') return serverConfig.remoteUrl || '';
  return localPort ? `localhost:${localPort}` : 'localhost';
};

const normalizeServerUrl = (raw: string): string | null => {
  const value = raw.trim();
  if (!value) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
};

const quitUiOnly = () => {
  stopEngineOnQuit = false;
  isQuitting = true;
  app.quit();
};

const quitUiAndStopEngine = () => {
  stopEngineOnQuit = true;
  isQuitting = true;
  app.quit();
};

const handleStopEngine = async () => {
  const result = await stopOwnedEngine();
  if (!result.ok) {
    await showEngineError(mt().engineNotOwnedMessage);
  }
};

const handleRestartEngine = async () => {
  const result = await restartOwnedEngine();
  if (!result.ok) {
    await showEngineError(result.error === 'engine-not-owned'
      ? mt().engineNotOwnedMessage
      : mt().engineStartErrorMessage);
    return;
  }

  for (const w of windows) {
    if (!w.isDestroyed()) w.loadURL(ENGINE_URL);
  }
};

const updateTrayMenu = () => {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: mt().openWindow, click: showPrimaryWindow },
    { type: 'separator' },
    { label: `${mt().server}: ${getServerLabel()}`, enabled: false },
    { label: mt().restartEngine, click: handleRestartEngine, enabled: serverConfig.mode === 'local' },
    { label: mt().stopEngine, click: handleStopEngine, enabled: serverConfig.mode === 'local' },
    { type: 'separator' },
    { label: mt().quitUi, click: quitUiOnly },
    { label: mt().quitUiAndStopEngine, click: quitUiAndStopEngine, enabled: serverConfig.mode === 'local' },
  ]));
};

const ensureTray = () => {
  if (tray) return;
  try {
    const iconPath = resolveTrayIconPath({
      platform: process.platform,
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
    });
    const trayImage = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
    tray = new Tray(trayImage.isEmpty() ? nativeImage.createEmpty() : trayImage);
    tray.setToolTip(APP_DISPLAY_NAME);
    tray.on('click', showPrimaryWindow);
    updateTrayMenu();
  } catch (err) {
    console.error('[electron] Failed to create tray:', err);
  }
};

const updateMenu = () => {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: mt().checkForUpdates, click: checkForUpdatesManual, enabled: canRunUpdater() },
        { type: 'separator' },
        { label: `${mt().server}: ${getServerLabel()}`, enabled: false },
        { label: mt().useLocalServer, type: 'radio', checked: serverConfig.mode === 'local', click: handleSwitchToLocal },
        { label: mt().connectRemoteServer, type: 'radio', checked: serverConfig.mode === 'remote', click: handleSwitchToRemote },
        { type: 'separator' },
        { label: mt().openWindow, click: showPrimaryWindow },
        { label: mt().restartEngine, click: handleRestartEngine, enabled: serverConfig.mode === 'local' },
        { label: mt().stopEngine, click: handleStopEngine, enabled: serverConfig.mode === 'local' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { label: mt().quitUi, click: quitUiOnly },
        { label: mt().quitUiAndStopEngine, click: quitUiAndStopEngine, enabled: serverConfig.mode === 'local' },
      ],
    },
    {
      label: mt().edit,
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: mt().view,
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: mt().window,
      submenu: [
        {
          label: mt().newWindow,
          accelerator: 'CommandOrControl+Shift+N',
          registerAccelerator: false,
          click: openNewWindow,
        },
        { type: 'separator' },
        { role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'close' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  updateTrayMenu();
};

// --- Server Switching ---

const handleSwitchToLocal = async () => {
  if (serverConfig.mode === 'local') return;

  serverConfig = { mode: 'local' };
  writeServerConfig(serverConfig);

  try {
    const port = await ensureEngineRunning();
    const url = `http://127.0.0.1:${port}`;
    for (const w of windows) w.loadURL(url);
  } catch (err) {
    console.error('[electron] Failed to start local engine:', err);
    await showEngineError(mt().engineStartErrorMessage);
  }
  updateMenu();
};

const handleSwitchToRemote = async () => {
  const parent = getPrimaryWindow();
  if (!parent) return;

  const url = normalizeServerUrl(await showServerPrompt(parent, serverConfig.remoteUrl) ?? '');
  if (!url) {
    updateMenu();
    return;
  }

  serverConfig = { mode: 'remote', remoteUrl: url };
  writeServerConfig(serverConfig);
  for (const w of windows) w.loadURL(url);
  updateMenu();
};

// --- Window ---

const getRestorePosition = (saved: IWindowState): { x?: number; y?: number } => {
  const hasPosition = saved.x != null && saved.y != null;
  if (hasPosition && isVisibleOnAnyDisplay({ x: saved.x!, y: saved.y!, width: saved.width, height: saved.height })) {
    return { x: saved.x, y: saved.y };
  }

  if (saved.displayId != null) {
    const target = screen.getAllDisplays().find((d) => d.id === saved.displayId);
    if (target) {
      const { x, y, width, height } = target.workArea;
      return {
        x: x + Math.floor((width - saved.width) / 2),
        y: y + Math.floor((height - saved.height) / 2),
      };
    }
  }

  return {};
};

const NEW_WINDOW_OFFSET = 32;

const createWindow = (url: string): BrowserWindow => {
  const saved = readWindowState();
  const pos = getRestorePosition(saved);
  const isFirstWindow = windows.size === 0;
  const offset = isFirstWindow ? 0 : (windows.size * NEW_WINDOW_OFFSET) % 200;

  const win = new BrowserWindow({
    title: APP_DISPLAY_NAME,
    width: saved.width,
    height: saved.height,
    x: pos.x != null ? pos.x + offset : undefined,
    y: pos.y != null ? pos.y + offset : undefined,
    minWidth: 800,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 16 },
    backgroundColor: resolveIsDark() ? '#09090b' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
  });

  windows.add(win);
  lastFocusedWindow = win;

  if (isFirstWindow) {
    if (saved.isMaximized) win.maximize();
    if (saved.isFullScreen) win.setFullScreen(true);
  }

  win.loadURL(url);

  win.on('focus', () => {
    lastFocusedWindow = win;
  });

  win.webContents.on('will-attach-webview', (_event, webPreferences) => {
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
  });

  win.webContents.setWindowOpenHandler(({ url: linkUrl }) => {
    shell.openExternal(linkUrl);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, navigationUrl) => {
    const currentOrigin = new URL(win.webContents.getURL() || '').origin;
    const targetOrigin = new URL(navigationUrl).origin;
    if (currentOrigin !== targetOrigin) {
      event.preventDefault();
      shell.openExternal(navigationUrl);
    }
  });

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const saveWindowState = () => {
    if (win.isDestroyed()) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const bounds = win.getNormalBounds();
      const currentDisplay = screen.getDisplayMatching(win.getBounds());
      writeWindowState({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized: win.isMaximized(),
        isFullScreen: win.isFullScreen(),
        displayId: currentDisplay.id,
      });
    }, 500);
  };

  win.on('resize', saveWindowState);
  win.on('move', saveWindowState);
  win.on('maximize', saveWindowState);
  win.on('unmaximize', saveWindowState);
  win.on('enter-full-screen', saveWindowState);
  win.on('leave-full-screen', saveWindowState);

  win.on('close', (e) => {
    if (saveTimer) clearTimeout(saveTimer);
    const bounds = win.getNormalBounds();
    const currentDisplay = screen.getDisplayMatching(win.getBounds());
    writeWindowState({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: win.isMaximized(),
      isFullScreen: win.isFullScreen(),
      displayId: currentDisplay.id,
    });

    if (!isQuitting && windows.has(win)) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    windows.delete(win);
    if (lastFocusedWindow === win) lastFocusedWindow = null;
  });

  return win;
};

const openNewWindow = () => {
  const url = resolveCurrentUrl();
  if (!url) return;
  createWindow(url);
};

const showPrimaryWindow = () => {
  const primary = getPrimaryWindow();
  if (primary) {
    if (primary.isMinimized()) primary.restore();
    primary.show();
    primary.focus();
    return;
  }
  openNewWindow();
};

// --- Splash (Loading) Screen ---

const resolveIsDark = (): boolean => {
  const cfg = readAppConfig();
  const theme = cfg.appTheme || 'dark';
  if (theme === 'system') return nativeTheme.shouldUseDarkColors;
  return theme !== 'light';
};

const buildSplashHTML = (isDark: boolean): string => {
  const bg = isDark ? '#09090b' : '#ffffff';
  const spinner = isDark ? '#a09dc0' : '#807da8';
  const text = isDark ? '#52525b' : '#a1a1aa';
  const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const tags = pickTaglines(8).map(escape);
  const tagsJson = "['" + tags.join("','") + "']";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${APP_DISPLAY_NAME}</title><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:${bg};display:flex;align-items:center;justify-content:center;height:100vh;-webkit-app-region:drag;font-family:'SF Mono','Fira Code','JetBrains Mono',monospace}
.container{text-align:center;user-select:none}
.spinner{font-size:20px;color:${spinner};height:28px;line-height:28px}
.word{font-size:12px;color:${text};margin-top:14px;height:20px}
</style></head><body><div class="container">
<div class="spinner" id="s"></div>
<div class="word" id="w"></div>
</div><script>
var sc=['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
var ws=${tagsJson};
var si=0,wi=0,ch=[],tg=[],rs=false,st=0;
var sEl=document.getElementById('s'),wEl=document.getElementById('w');
var pool='abcdefghijklmnopqrstuvwxyz.!?@#$%&*';
function go(){tg=ws[wi].split('');ch=tg.map(function(c){return c===' '?' ':pool[Math.floor(Math.random()*pool.length)]});rs=true;st=0;wi=(wi+1)%ws.length}
go();
setInterval(function(){sEl.textContent=sc[si];si=(si+1)%sc.length},80);
setInterval(function(){if(rs){if(st<tg.length){for(var i=0;i<ch.length;i++){if(i<=st){ch[i]=tg[i]}else if(tg[i]!==' '){ch[i]=pool[Math.floor(Math.random()*pool.length)]}}st+=2}else{for(var i=0;i<tg.length;i++){ch[i]=tg[i]}rs=false;setTimeout(go,1500)}}wEl.textContent=ch.join('')},40);
</script></body></html>`;
};

const loadSplash = (win: BrowserWindow) => {
  const html = buildSplashHTML(resolveIsDark());
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
};

// --- Bootstrap ---

const preparePackagedServerEnv = () => {
  applyPackagedServerEnv({
    env: process.env,
    isDev,
    cwd: process.cwd(),
    appPath: app.getAppPath(),
  });
};

const bootstrapEngineOnly = async () => {
  fixEnv();
  await applyResolvedShellEnv().then(capturePristineEnv);
  preparePackagedServerEnv();
  process.title = `${APP_PROCESS_NAME} engine`;

  try {
    await startLocalServer({ allowPortFallback: false });
  } catch (err) {
    console.error('[electron-engine] Failed to start engine:', err);
    app.exit(1);
  }
};

const bootstrapCoreProcessOnly = async () => {
  writeCoreBootstrapTrace('core-bootstrap:start', {
    argv: process.argv,
    role: electronProcessRole,
    transport: process.env.CODEXWINMUX_CORE_ENGINE_TRANSPORT,
  });
  fixEnv();
  writeCoreBootstrapTrace('core-bootstrap:after-fix-env');
  await applyResolvedShellEnv().then(capturePristineEnv);
  writeCoreBootstrapTrace('core-bootstrap:after-shell-env');
  preparePackagedServerEnv();
  writeCoreBootstrapTrace('core-bootstrap:after-packaged-env', {
    appDir: process.env.__CMUX_APP_DIR,
    appDirUnpacked: process.env.__CMUX_APP_DIR_UNPACKED,
    nodeEnv: process.env.NODE_ENV,
  });
  try {
    await bootstrapCoreOnly();
    writeCoreBootstrapTrace('core-bootstrap:ready');
  } catch (err) {
    writeCoreBootstrapTrace('core-bootstrap:error', {
      error: err instanceof Error ? err.message : String(err),
      code: err && typeof err === 'object' && 'code' in err ? (err as { code?: unknown }).code : undefined,
    });
    console.error('[electron-core] Failed to start core:', err);
    app.exit(1);
  }
};

const bootstrap = async () => {
  // Finder/Dock 런치 시 launchd env가 빈약해 child shell이 초기화에 실패함.
  // shell resolve는 100~500ms 걸리므로 splash 렌더와 오버랩시키고,
  // 로컬 서버 spawn 직전에만 완료를 대기한다.
  fixEnv();
  initBrowserBridge();
  const shellEnvReady = applyResolvedShellEnv().then(capturePristineEnv);

  if (devUrl) {
    await shellEnvReady;
    createWindow(devUrl);
    return;
  }

  preparePackagedServerEnv();

  serverConfig = readServerConfig();
  currentLocale = readLocaleFromConfig();
  ensureTray();

  // macOS: nativeTheme을 앱 테마와 동기화해야 비활성 트래픽 라이트가 올바른 대비로 렌더링됨
  const appTheme = readAppConfig().appTheme || 'dark';
  nativeTheme.themeSource = appTheme as 'dark' | 'light' | 'system';

  // splash/about:blank 엔트리가 히스토리에 남으면 마우스 뒤로가기 버튼으로 복귀 불가 상태에 빠짐
  const clearSplashHistory = (win: BrowserWindow) => {
    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed()) win.webContents.navigationHistory.clear();
    });
  };

  if (serverConfig.mode === 'remote' && serverConfig.remoteUrl) {
    const win = createWindow('about:blank');
    loadSplash(win);
    await shellEnvReady;
    win.loadURL(serverConfig.remoteUrl);
    clearSplashHistory(win);
  } else {
    serverConfig = { mode: 'local' };
    // 윈도우를 먼저 띄우고 로딩 화면을 보여준 뒤, 서버가 준비되면 전환
    const win = createWindow('about:blank');
    loadSplash(win);
    await shellEnvReady;
    try {
      const port = await ensureEngineRunning();
      win.loadURL(`http://127.0.0.1:${port}`);
    } catch (err) {
      console.error('[electron] Failed to start local engine:', err);
      await showEngineError(mt().engineStartErrorMessage);
    }
    clearSplashHistory(win);
  }

  updateMenu();

  setupAutoUpdater();
  // 메인 윈도우 로딩이 끝나기 전에 다이얼로그가 뜨지 않도록 첫 체크를 지연
  setTimeout(
    checkForUpdatesAuto,
    updaterSmokeConfig.enabled ? UPDATER_SMOKE_FIRST_CHECK_DELAY_MS : FIRST_CHECK_DELAY_MS,
  );
  startUpdateCheckTimer();
};

const VALID_URI_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const BLOCKED_SCHEME = /^(javascript|data|vbscript|blob|file|about|view-source):/i;

ipcMain.handle('open-external', (_event, url: string) => {
  if (typeof url !== 'string') return;
  if (!VALID_URI_SCHEME.test(url) || BLOCKED_SCHEME.test(url)) return;
  shell.openExternal(url);
});

ipcMain.handle('set-native-theme', (_event, theme: string) => {
  if (theme === 'dark' || theme === 'light' || theme === 'system') {
    nativeTheme.themeSource = theme;
  }
});

ipcMain.handle('set-locale', (_event, locale: string) => {
  const nextLocale = locale === 'ko' ? 'ko' : 'en';
  if (nextLocale !== currentLocale) {
    currentLocale = nextLocale;
    updateMenu();
    updateTrayMenu();
  }
});

// --- Native Notifications ---

ipcMain.handle('show-notification', (event, title: string, body: string, options?: { silent?: boolean }) => {
  const anyFocused = BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isFocused());
  if (anyFocused) return false;
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  const notification = new Notification({ title, body, silent: !!options?.silent });
  notification.on('click', () => {
    const target = senderWin && !senderWin.isDestroyed() ? senderWin : getPrimaryWindow();
    target?.show();
    target?.focus();
    target?.webContents.send('notification-click');
  });
  notification.show();
  return true;
});

ipcMain.handle('open-new-window', () => {
  openNewWindow();
});

ipcMain.handle('set-dock-badge', (_event, count: number) => {
  if (process.platform !== 'darwin' || !app.dock) return;
  app.dock.setBadge(count > 0 ? String(count) : '');
});

// --- System Resources ---

ipcMain.handle('get-system-resources', () => {
  const metrics = app.getAppMetrics();
  let cpuTotal = 0;
  let memTotal = 0;
  for (const m of metrics) {
    cpuTotal += m.cpu.percentCPUUsage;
    memTotal += m.memory.workingSetSize * 1024; // KB → bytes
  }

  return {
    cpu: cpuTotal,
    memory: { used: memTotal },
  };
});

if (isCoreProcess) {
  void bootstrapCoreProcessOnly();
} else {
  app.on('ready', isEngineProcess ? bootstrapEngineOnly : bootstrap);
}

const flushDefaultSessionStorage = async (): Promise<void> => {
  try {
    await Promise.resolve(session.defaultSession?.flushStorageData());
  } catch {
    // noop
  }
  try {
    await Promise.resolve(session.defaultSession?.cookies?.flushStore());
  } catch {
    // noop
  }
};

app.on('activate', () => {
  if (isEngineProcess || isCoreProcess) return;
  const primary = getPrimaryWindow();
  if (primary) {
    primary.show();
    primary.focus();
  } else if (!devUrl) {
    bootstrap();
  }
});

app.on('window-all-closed', async () => {
  if (isEngineProcess || isCoreProcess || process.platform === 'darwin' || !isQuitting) return;
});

// Cmd+Q 등으로 will-quit이 먼저 도달하는 경우,
// window-all-closed와 동일한 graceful shutdown 수행.
app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', async (event) => {
  if (updaterSmokeConfig.autoInstall) return;

  event.preventDefault();
  const forceExit = setTimeout(() => app.exit(1), 3000);

  stopUpdateCheckTimer();

  if (isEngineProcess && serverShutdown) {
    await serverShutdown();
    serverShutdown = null;
  }

  if (isCoreProcess) {
    await shutdownCoreOnly();
  }

  if (!isEngineProcess && !isCoreProcess && stopEngineOnQuit) {
    await stopOwnedEngine();
  }

  await flushDefaultSessionStorage();
  clearTimeout(forceExit);
  app.exit(0);
});

if (!isEngineProcess && !isCoreProcess) {
  app.requestSingleInstanceLock();
  app.on('second-instance', () => {
    showPrimaryWindow();
  });
}
