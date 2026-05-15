import { describe, expect, it } from 'vitest';
import path from 'path';
import { pathToFileURL } from 'url';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/android-webview-smoke-lib.mjs')).href);

describe('Android WebView smoke helpers', () => {
  it('extracts WebView DevTools sockets from /proc/net/unix output', async () => {
    const { extractDevtoolsSockets } = await loadLib();
    const output = [
      'Num       RefCount Protocol Flags    Type St Inode Path',
      '00000000: 00000002 00000000 00010000 0001 01 12345 @webview_devtools_remote_101',
      '00000000: 00000002 00000000 00010000 0001 01 12346 @chrome_devtools_remote',
      '00000000: 00000002 00000000 00010000 0001 01 12347 @webview_devtools_remote_202',
      '00000000: 00000002 00000000 00010000 0001 01 12348 @webview_devtools_remote_101',
    ].join('\n');

    expect(extractDevtoolsSockets(output)).toEqual([
      'webview_devtools_remote_202',
      'webview_devtools_remote_101',
    ]);
  });

  it('prefers the target serving the requested codexmux origin', async () => {
    const { selectDevtoolsTarget } = await loadLib();
    const targets = [
      { type: 'page', url: 'https://localhost/?connection=failed' },
      { type: 'page', url: 'https://gti12.tail73c4be.ts.net/login', webSocketDebuggerUrl: 'ws://remote' },
      { type: 'other', url: 'https://gti12.tail73c4be.ts.net/worker', webSocketDebuggerUrl: 'ws://worker' },
    ];

    expect(selectDevtoolsTarget(targets, 'https://gti12.tail73c4be.ts.net').url)
      .toBe('https://gti12.tail73c4be.ts.net/login');
  });

  it('falls back to the local launcher target when the remote app is not loaded yet', async () => {
    const { selectDevtoolsTarget } = await loadLib();
    const targets = [
      { type: 'iframe', url: 'about:blank' },
      { type: 'page', url: 'https://localhost/', webSocketDebuggerUrl: 'ws://launcher' },
    ];

    expect(selectDevtoolsTarget(targets, 'https://gti12.tail73c4be.ts.net').url)
      .toBe('https://localhost/');
  });

  it('reconnects the launcher with codexwinmux storage keys only', async () => {
    const { reconnectLauncherToServer } = await loadLib();
    const source = reconnectLauncherToServer.toString();

    expect(source).toContain("localStorage.setItem('codexwinmux:server-url'");
    expect(source).toContain("localStorage.setItem('codexwinmux:recent-server-urls'");
    expect(source).toContain("localStorage.removeItem('codexmux:server-url'");
    expect(source).toContain("localStorage.removeItem('codexmux:recent-server-urls'");
  });

  it('collects Android bridge and reconnect console failures', async () => {
    const { collectBlockingConsoleEvents } = await loadLib();
    const events = [
      { type: 'log', text: 'normal log line' },
      { type: 'error', text: "Cannot read properties of undefined (reading 'triggerEvent')" },
      { type: 'error', text: 'WebSocket connection to wss://host/api/terminal failed: Error during WebSocket handshake' },
      { type: 'error', text: 'ignored extension noise' },
    ];

    expect(collectBlockingConsoleEvents(events).map((event: { text: string }) => event.text)).toEqual([
      "Cannot read properties of undefined (reading 'triggerEvent')",
      'WebSocket connection to wss://host/api/terminal failed: Error during WebSocket handshake',
    ]);
  });

  it('does not fail foreground smoke on browser WebSocket warnings alone', async () => {
    const { collectBlockingConsoleEvents } = await loadLib();
    const events = [
      {
        source: 'log',
        type: 'warning',
        text: "WebSocket connection to 'wss://host/api/sync' failed: WebSocket is closed before the connection is established.",
      },
    ];

    expect(collectBlockingConsoleEvents(events)).toEqual([]);
  });

  it('ignores the known Next dev HMR static indicator warning', async () => {
    const { collectBlockingConsoleEvents } = await loadLib();
    const events = [
      {
        source: 'console',
        type: 'warning',
        text: '[HMR] Invalid message: {"type":"isrManifest"}\nTypeError: Cannot read properties of undefined (reading \'components\')\n    at handleStaticIndicator',
        url: 'http://127.0.0.1:8122/_next/static/chunks/node_modules_next_dist_client.js',
      },
      {
        source: 'console',
        type: 'error',
        text: "Cannot read properties of undefined (reading 'triggerEvent')",
        url: 'http://127.0.0.1:8122/_next/static/chunks/app.js',
      },
    ];

    expect(collectBlockingConsoleEvents(events).map((event: { text: string }) => event.text)).toEqual([
      "Cannot read properties of undefined (reading 'triggerEvent')",
    ]);
  });

  it('collects matching logcat lines without failing unrelated Chromium logs', async () => {
    const { collectBlockingLogcatLines } = await loadLib();
    const logcat = [
      '05-03 16:47:01.000 I/chromium: [INFO:CONSOLE] "regular console"',
      '05-03 16:47:01.500 I AndroidRuntime: VM exiting with result code 0, cleanup skipped.',
      '05-03 16:47:02.000 E/AndroidRuntime: FATAL EXCEPTION: main',
      '05-03 16:47:03.000 I/chromium: Cannot read properties of undefined (reading triggerEvent)',
      "05-14 19:18:16.033 W Capacitor/Console: TypeError: Cannot read properties of undefined (reading 'components')",
    ].join('\n');

    expect(collectBlockingLogcatLines(logcat)).toEqual([
      '05-03 16:47:02.000 E/AndroidRuntime: FATAL EXCEPTION: main',
      '05-03 16:47:03.000 I/chromium: Cannot read properties of undefined (reading triggerEvent)',
    ]);
  });

  it('detects whether a WebView state is on the expected remote origin', async () => {
    const { isExpectedRemoteState } = await loadLib();

    expect(isExpectedRemoteState({
      href: 'https://gti12.tail73c4be.ts.net/login',
      readyState: 'complete',
    }, 'https://gti12.tail73c4be.ts.net')).toBe(true);

    expect(isExpectedRemoteState({
      href: 'https://localhost/?connection=failed',
      readyState: 'complete',
    }, 'https://gti12.tail73c4be.ts.net')).toBe(false);
  });

  it('parses opt-in smoke flags from environment values', async () => {
    const { isSmokeFlagEnabled } = await loadLib();

    expect(isSmokeFlagEnabled('1')).toBe(true);
    expect(isSmokeFlagEnabled('true')).toBe(true);
    expect(isSmokeFlagEnabled('YES')).toBe(true);
    expect(isSmokeFlagEnabled('0')).toBe(false);
    expect(isSmokeFlagEnabled(undefined)).toBe(false);
  });

  it('requires an explicit codexwinmux Android smoke URL by default', async () => {
    const { DEFAULT_ANDROID_SMOKE_URL, resolveAndroidSmokeUrl } = await loadLib();

    expect(DEFAULT_ANDROID_SMOKE_URL).toBe('');
    expect(() => resolveAndroidSmokeUrl(undefined)).toThrow(/CODEXMUX_ANDROID_SMOKE_URL is required/);
    expect(resolveAndroidSmokeUrl('http://192.168.3.74:8121')).toBe('http://192.168.3.74:8121');
  });

  it('uses an external HTTP 404 URL for the HTTP recovery scenario so auth redirects do not mask main-frame errors', async () => {
    const { buildAndroidRecoveryScenarioUrl } = await loadLib();

    expect(buildAndroidRecoveryScenarioUrl('http', 'http://192.168.3.74:8121')).toBe('https://httpstat.us/404');
    expect(buildAndroidRecoveryScenarioUrl('http', 'http://192.168.3.74:8121', {
      CODEXMUX_ANDROID_HTTP_BAD_URL: 'http://192.168.3.74:8121/custom-404',
    })).toBe('http://192.168.3.74:8121/custom-404');
  });

  it('wakes Android before DevTools discovery in recovery smoke scripts', async () => {
    const { wakeAndroidDevice } = await loadLib();
    const calls: string[][] = [];

    wakeAndroidDevice({
      adb: 'adb',
      adbArgs: ['-s', 'device'],
      run: (_command: string, args: string[]) => {
        calls.push(args);
        return '';
      },
    });

    expect(calls).toEqual([
      ['-s', 'device', 'shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'],
      ['-s', 'device', 'shell', 'wm', 'dismiss-keyguard'],
      ['-s', 'device', 'shell', 'input', 'keyevent', 'KEYCODE_MENU'],
    ]);
  });

  it('resolves winget platform-tools adb on Windows when SDK adb is absent', async () => {
    const { resolveAdbPath } = await loadLib();
    const localAppData = 'C:\\Users\\yohan\\AppData\\Local';
    const expected = path.join(
      localAppData,
      'Microsoft',
      'WinGet',
      'Packages',
      'Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe',
      'platform-tools',
      'adb.exe',
    );

    expect(resolveAdbPath({
      env: { LOCALAPPDATA: localAppData },
      homeDir: 'C:\\Users\\yohan',
      platform: 'win32',
      exists: (candidate: string) => candidate === expected,
    })).toBe(expected);
  });

  it('resolves the Program Files Android SDK adb on Windows when user SDK adb is absent', async () => {
    const { resolveAdbPath } = await loadLib();
    const programFilesX86 = 'C:\\Program Files (x86)';
    const expected = path.join(
      programFilesX86,
      'Android',
      'android-sdk',
      'platform-tools',
      'adb.exe',
    );

    expect(resolveAdbPath({
      env: {
        LOCALAPPDATA: 'C:\\Users\\yohan\\AppData\\Local',
        'ProgramFiles(x86)': programFilesX86,
      },
      homeDir: 'C:\\Users\\yohan',
      platform: 'win32',
      exists: (candidate: string) => candidate === expected,
    })).toBe(expected);
  });
});
