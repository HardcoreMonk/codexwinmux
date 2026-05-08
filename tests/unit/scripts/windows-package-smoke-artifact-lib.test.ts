import { describe, expect, it } from 'vitest';
import path from 'path';
import { pathToFileURL } from 'url';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/windows-package-smoke-artifact-lib.mjs')).href);

describe('Windows package smoke artifact helpers', () => {
  it('summarizes packaged launch evidence without runtime identifiers or target URLs', async () => {
    const { buildWindowsPackagedLaunchArtifactPayload } = await loadLib();

    const payload = buildWindowsPackagedLaunchArtifactPayload({
      ok: true,
      mutatesSystem: false,
      appPath: 'D:\\data\\projects\\codexmux\\release\\win-unpacked\\codexmux.exe',
      homeDir: 'C:\\Users\\yohan\\AppData\\Local\\Temp\\codexmux-windows-packaged-launch-secret',
      launchMode: 'windows-exe',
      longRunHoldMs: 120000,
      remoteDebuggingPort: 61234,
      checks: ['packaged-exe-present', 'runtime-v2-terminal-ws'],
      state: {
        href: 'http://localhost:8121/login',
        origin: 'http://localhost:8121',
        title: '로그인 - windows native codexmux',
        readyState: 'complete',
        hasElectronApi: true,
        electronApiKeys: ['platform'],
        hasPasswordInput: false,
        userAgent: 'codexmux/0.4.2 Electron/41.1.1',
      },
      health: {
        app: 'codexmux',
        version: '0.4.2',
        commit: 'fa3e4978',
        buildTime: '2026-05-06T15:35:10.450Z',
      },
      longRunHealth: {
        app: 'codexmux',
        version: '0.4.2',
        commit: 'fa3e4978',
        buildTime: '2026-05-06T15:35:10.450Z',
      },
      engineLifecycle: true,
      engineLifecycleEvidence: {
        uiQuitRequested: true,
        uiExited: true,
        uiExitCode: 0,
        uiExitSignal: null,
        healthAfterUiQuit: {
          app: 'codexmux',
          version: '0.4.2',
          commit: 'fa3e4978',
          buildTime: '2026-05-06T15:35:10.450Z',
        },
        url: 'http://localhost:8121',
      },
      runtimeV2Terminal: {
        tabId: 'tab-secret',
        sessionName: 'rtv2-ws-secret-pane-secret-tab-secret',
        runtimeVersion: 2,
        marker: 'windows-packaged-runtime-v2-secret',
      },
      consoleEventCount: 0,
      blockingConsoleCount: 0,
      outputTail: 'terminal output should not survive',
    });

    expect(payload).toEqual({
      ok: true,
      mutatesSystem: false,
      launchMode: 'windows-exe',
      longRunHoldMs: 120000,
      checks: ['packaged-exe-present', 'runtime-v2-terminal-ws'],
      state: {
        title: '로그인 - windows native codexmux',
        readyState: 'complete',
        hasElectronApi: true,
        electronApiKeys: ['platform'],
        hasPasswordInput: false,
        userAgent: 'codexmux/0.4.2 Electron/41.1.1',
      },
      health: {
        app: 'codexmux',
        version: '0.4.2',
        commit: 'fa3e4978',
        buildTime: '2026-05-06T15:35:10.450Z',
      },
      longRunHealth: {
        app: 'codexmux',
        version: '0.4.2',
        commit: 'fa3e4978',
        buildTime: '2026-05-06T15:35:10.450Z',
      },
      engineLifecycle: true,
      engineLifecycleEvidence: {
        uiQuitRequested: true,
        uiExited: true,
        uiExitCode: 0,
        uiExitSignal: null,
        healthAfterUiQuit: {
          app: 'codexmux',
          version: '0.4.2',
          commit: 'fa3e4978',
          buildTime: '2026-05-06T15:35:10.450Z',
        },
      },
      runtimeV2Terminal: {
        verified: true,
        runtimeVersion: 2,
      },
      consoleEventCount: 0,
      blockingConsoleCount: 0,
    });
    expect(JSON.stringify(payload)).not.toContain('localhost');
    expect(JSON.stringify(payload)).not.toContain('tab-secret');
    expect(JSON.stringify(payload)).not.toContain('terminal output');
    expect(JSON.stringify(payload)).not.toContain('Temp');
  });

  it('summarizes installer smoke evidence without install paths or child process output', async () => {
    const { buildWindowsInstallerArtifactPayload } = await loadLib();

    const payload = buildWindowsInstallerArtifactPayload({
      ok: true,
      mutatesSystem: true,
      installerPath: 'D:\\data\\projects\\codexmux\\release\\codexmux Setup 0.4.2.exe',
      installDir: 'C:\\Users\\yohan\\AppData\\Local\\Temp\\codexmux-installer-smoke-secret\\app',
      checks: ['installer-present', 'installed-app-launch-smoke', 'silent-uninstall'],
      runtimeV2Terminal: true,
      launch: {
        ok: true,
        mutatesSystem: false,
        launchMode: 'windows-exe',
        checks: ['runtime-v2-terminal-ws'],
        runtimeV2Terminal: {
          tabId: 'tab-secret',
          sessionName: 'rtv2-secret',
          runtimeVersion: 2,
        },
        consoleEventCount: 0,
        blockingConsoleCount: 0,
      },
      installResult: {
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: 'installer stdout should not survive',
        stderr: 'installer stderr should not survive',
      },
    });

    expect(payload).toMatchObject({
      ok: true,
      mutatesSystem: true,
      checks: ['installer-present', 'installed-app-launch-smoke', 'silent-uninstall'],
      runtimeV2Terminal: true,
      launch: {
        ok: true,
        runtimeV2Terminal: {
          verified: true,
          runtimeVersion: 2,
        },
      },
      installResult: {
        exitCode: 0,
        signal: null,
        timedOut: false,
      },
    });
    expect(JSON.stringify(payload)).not.toContain('installer stdout');
    expect(JSON.stringify(payload)).not.toContain('installer stderr');
    expect(JSON.stringify(payload)).not.toContain('Temp');
    expect(JSON.stringify(payload)).not.toContain('tab-secret');
  });
});
