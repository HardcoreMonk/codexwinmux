import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/electron-smoke-lib.mjs')).href);

describe('Electron smoke helpers', () => {
  it('normalizes attach URLs with a default http scheme', async () => {
    const { normalizeElectronSmokeUrl } = await loadLib();

    expect(normalizeElectronSmokeUrl('127.0.0.1:8121')).toBe('http://127.0.0.1:8121');
    expect(normalizeElectronSmokeUrl('https://gti12.tail73c4be.ts.net/')).toBe('https://gti12.tail73c4be.ts.net');
  });

  it('selects the Electron page target matching the expected origin', async () => {
    const { selectElectronPageTarget } = await loadLib();
    const targets = [
      { type: 'other', url: 'devtools://devtools/bundled/inspector.html', webSocketDebuggerUrl: 'ws://other' },
      { type: 'page', url: 'http://127.0.0.1:8121/login', webSocketDebuggerUrl: 'ws://local' },
      { type: 'page', url: 'https://example.invalid/', webSocketDebuggerUrl: 'ws://example' },
    ];

    expect(selectElectronPageTarget(targets, 'http://127.0.0.1:8121')?.url).toBe('http://127.0.0.1:8121/login');
  });

  it('selects a packaged Electron local server page target', async () => {
    const { selectElectronLocalPageTarget } = await loadLib();
    const targets = [
      { type: 'page', url: 'data:text/html,splash', webSocketDebuggerUrl: 'ws://splash' },
      { type: 'page', url: 'http://localhost:8121/login', webSocketDebuggerUrl: 'ws://local' },
      { type: 'page', url: 'https://example.invalid/', webSocketDebuggerUrl: 'ws://remote' },
    ];

    expect(selectElectronLocalPageTarget(targets)?.url).toBe('http://localhost:8121/login');
  });

  it('builds Electron launch args with remote debugging before the app path', async () => {
    const { buildElectronSmokeArgs } = await loadLib();

    expect(buildElectronSmokeArgs({ remoteDebuggingPort: 9222, appPath: '.' })).toEqual([
      '--remote-debugging-port=9222',
      '--disable-gpu',
      '--no-sandbox',
      '.',
    ]);
  });

  it('builds a default Electron CLI launch command', async () => {
    const { buildElectronSmokeLaunchCommand } = await loadLib();

    expect(buildElectronSmokeLaunchCommand({
      remoteDebuggingPort: 9222,
      appPath: '.',
      platform: 'linux',
    })).toEqual({
      command: 'corepack',
      args: [
        'pnpm',
        'exec',
        'electron',
        '--remote-debugging-port=9222',
        '--disable-gpu',
        '--no-sandbox',
        '.',
      ],
      mode: 'electron-cli',
    });
  });

  it('builds a packaged macOS app launch command from a .app bundle', async () => {
    const { buildElectronSmokeLaunchCommand } = await loadLib();
    const appDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-smoke-app-'));
    const bundlePath = path.join(appDir, 'codexmux.app');
    const executablePath = path.join(bundlePath, 'Contents', 'MacOS', 'codexwinmux');
    await fs.mkdir(path.dirname(executablePath), { recursive: true });
    await fs.writeFile(executablePath, '#!/bin/sh\n');
    await fs.chmod(executablePath, 0o755);

    expect(buildElectronSmokeLaunchCommand({
      remoteDebuggingPort: 9222,
      appPath: bundlePath,
      platform: 'darwin',
    })).toEqual({
      command: executablePath,
      args: [
        '--remote-debugging-port=9222',
        '--disable-gpu',
        '--no-sandbox',
      ],
      mode: 'mac-app',
    });
  });

  it('rejects macOS .app bundles on non-macOS platforms', async () => {
    const { buildElectronSmokeLaunchCommand } = await loadLib();

    expect(() => buildElectronSmokeLaunchCommand({
      remoteDebuggingPort: 9222,
      appPath: '/tmp/codexmux.app',
      platform: 'linux',
    })).toThrow(/requires macOS/);
  });

  it('builds a packaged Windows executable launch command from a .exe path', async () => {
    const { buildElectronSmokeLaunchCommand } = await loadLib();

    expect(buildElectronSmokeLaunchCommand({
      remoteDebuggingPort: 9222,
      appPath: 'D:\\apps\\codexmux\\codexwinmux.exe',
      platform: 'win32',
    })).toEqual({
      command: 'D:\\apps\\codexmux\\codexwinmux.exe',
      args: [
        '--remote-debugging-port=9222',
        '--disable-gpu',
        '--no-sandbox',
      ],
      mode: 'windows-exe',
    });
  });

  it('builds a runtime v2 page-context smoke script', async () => {
    const { buildElectronRuntimeV2EvalScript } = await loadLib();

    const script = buildElectronRuntimeV2EvalScript({
      sessionName: 'rtv2-ws-pane-tab',
      marker: 'electron-v2-marker',
      cols: 100,
      rows: 30,
    });

    expect(script).toContain('/api/v2/terminal');
    expect(script).toContain('rtv2-ws-pane-tab');
    expect(script).toContain('electron-v2-marker');
    expect(script).toContain('new WebSocket');
    expect(script).toContain('Uint8Array');

    const escapedScript = buildElectronRuntimeV2EvalScript({
      sessionName: 'rtv2-ws-pane-tab',
      marker: "electron-v2-'marker",
    });
    const commandMatch = escapedScript.match(/const command = ("(?:\\.|[^"])*");/);
    expect(commandMatch).not.toBeNull();
    expect(JSON.parse(commandMatch?.[1] ?? 'null')).toBe("printf '%s\\n' 'electron-v2-'\\''marker'\r");
  });

  it('builds a Windows runtime v2 page-context marker command', async () => {
    const { buildElectronRuntimeV2EvalScript } = await loadLib();

    const script = buildElectronRuntimeV2EvalScript({
      sessionName: 'rtv2-windows-pane-tab',
      marker: 'windows-v2-marker',
      commandKind: 'windows',
    });
    const commandMatch = script.match(/const command = ("(?:\\.|[^"])*");/);

    expect(commandMatch).not.toBeNull();
    expect(JSON.parse(commandMatch?.[1] ?? 'null')).toBe('echo windows-v2-marker\r');
  });

  it('builds reconnect smoke rounds after the initial attach', async () => {
    const { buildElectronRuntimeV2ReconnectRounds } = await loadLib();

    expect(buildElectronRuntimeV2ReconnectRounds({
      baseMarker: 'electron-v2',
      reconnectRounds: 2,
    })).toEqual([
      { label: 'initial', marker: 'electron-v2-initial', reloadBefore: false },
      { label: 'reconnect-1', marker: 'electron-v2-reconnect-1', reloadBefore: true },
      { label: 'reconnect-2', marker: 'electron-v2-reconnect-2', reloadBefore: true },
    ]);
  });

  it('normalizes reconnect round counts', async () => {
    const { normalizeElectronReconnectRounds } = await loadLib();

    expect(normalizeElectronReconnectRounds(undefined)).toBe(2);
    expect(normalizeElectronReconnectRounds('0')).toBe(0);
    expect(normalizeElectronReconnectRounds('3')).toBe(3);
    expect(normalizeElectronReconnectRounds('999')).toBe(10);
    expect(normalizeElectronReconnectRounds('nope')).toBe(2);
  });

  it('normalizes Electron window foreground cycle counts', async () => {
    const { normalizeElectronWindowForegroundCycles } = await loadLib();

    expect(normalizeElectronWindowForegroundCycles(undefined)).toBe(0);
    expect(normalizeElectronWindowForegroundCycles('1')).toBe(1);
    expect(normalizeElectronWindowForegroundCycles('5')).toBe(5);
    expect(normalizeElectronWindowForegroundCycles('999')).toBe(5);
    expect(normalizeElectronWindowForegroundCycles('nope')).toBe(0);
  });
});
