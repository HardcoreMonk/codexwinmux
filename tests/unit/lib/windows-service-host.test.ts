import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  resolveWindowsServiceHostPlan,
  resolveWindowsServiceHostOwner,
} from '@/lib/windows-service-host';

const env = {
  USERPROFILE: 'C:\\Users\\cmux',
  LOCALAPPDATA: 'C:\\Users\\cmux\\AppData\\Local',
  PATH: 'C:\\Windows\\System32',
};

describe('Windows service host baseline', () => {
  it('defaults to a tray-first service-capable host plan without system mutation', () => {
    const plan = resolveWindowsServiceHostPlan({
      platform: 'win32',
      env,
      appDir: 'D:\\apps\\codexmux',
    });

    expect(plan).toMatchObject({
      platform: 'win32',
      owner: 'tray',
      hostModel: 'tray-first-service-capable',
      mutatesSystem: false,
      service: {
        name: 'codexwinmux',
        displayName: 'codexwinmux',
      },
      process: {
        command: 'corepack',
        args: ['pnpm', 'start'],
        cwd: 'D:\\apps\\codexmux',
        env: {
          CODEXWINMUX_RUNTIME_V2: '1',
          CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER: 'windows',
          CODEXWINMUX_PROCESS_INSPECTOR_ADAPTER: 'windows',
          CODEXMUX_PROCESS_INSPECTOR_ADAPTER: 'windows',
          HOST: '127.0.0.1',
          PORT: '8121',
        },
      },
      restartPolicy: {
        strategy: 'installer-or-service-manager',
        maxRestarts: 3,
      },
    });
    expect(plan.paths.dataDir).toBe(path.win32.join('C:\\Users\\cmux', '.codexwinmux'));
    expect(plan.paths.logDir).toBe(path.win32.join('C:\\Users\\cmux\\AppData\\Local', 'codexwinmux', 'logs'));
  });

  it('marks Windows service ownership as elevation-required but still dry-run', () => {
    const plan = resolveWindowsServiceHostPlan({
      platform: 'win32',
      env: {
        ...env,
        CODEXWINMUX_WINDOWS_HOST_OWNER: 'service',
        CODEXWINMUX_WINDOWS_SERVICE_NAME: 'codexwinmux-dev',
        CODEXWINMUX_WINDOWS_SERVICE_EXE: 'D:\\apps\\codexwinmux\\codexwinmux.exe',
        CODEXWINMUX_WINDOWS_SERVICE_WRAPPER_EXE: 'C:\\Users\\cmux\\AppData\\Local\\codexwinmux\\service\\codexwinmux-service.exe',
        PORT: '9133',
      },
      appDir: 'D:\\apps\\codexmux',
    });

    expect(plan.owner).toBe('service');
    expect(plan.service.name).toBe('codexwinmux-dev');
    expect(plan.process.env.PORT).toBe('9133');
    expect(plan.requiresElevation).toBe(true);
    expect(plan.mutatesSystem).toBe(false);
    expect(plan.hostModel).toBe('windows-service-owner-capable');
    expect(plan.service.executablePath).toBe('D:\\apps\\codexwinmux\\codexwinmux.exe');
    expect(plan.service.executableArgs).toEqual(['--codexwinmux-engine']);
    expect(plan.service.wrapper).toMatchObject({
      kind: 'winsw',
      executablePath: 'C:\\Users\\cmux\\AppData\\Local\\codexwinmux\\service\\codexwinmux-service.exe',
      configPath: path.win32.join('C:\\Users\\cmux\\AppData\\Local', 'codexwinmux', 'service', 'codexwinmux-service.xml'),
    });
    expect(plan.service.commands.install).toMatchObject({
      program: 'C:\\Users\\cmux\\AppData\\Local\\codexwinmux\\service\\codexwinmux-service.exe',
      args: ['install'],
      mutatesSystem: false,
      requiresElevation: true,
    });
    expect(plan.service.commands.uninstall.args).toEqual(['uninstall']);
    expect(plan.service.commands.start.args).toEqual(['start']);
    expect(plan.service.commands.stop.args).toEqual(['stop']);
  });

  it('prefers canonical Windows host owner env over legacy env', () => {
    expect(resolveWindowsServiceHostOwner({
      CODEXWINMUX_WINDOWS_HOST_OWNER: 'service',
      CODEXMUX_WINDOWS_HOST_OWNER: 'tray',
    })).toEqual({
      ok: true,
      owner: 'service',
    });
  });

  it('keeps owner parsing fail-closed for unsupported host owners', () => {
    expect(resolveWindowsServiceHostOwner({ CODEXMUX_WINDOWS_HOST_OWNER: 'systemd' })).toEqual({
      ok: false,
      error: 'unsupported-windows-host-owner',
      value: 'systemd',
    });
  });

  it('carries unsupported owner errors into the dry-run plan without mutation', () => {
    expect(resolveWindowsServiceHostPlan({
      platform: 'win32',
      env: {
        ...env,
        CODEXMUX_WINDOWS_HOST_OWNER: 'systemd',
      },
      appDir: 'D:\\apps\\codexmux',
    })).toMatchObject({
      reason: 'unsupported-windows-host-owner',
      mutatesSystem: false,
    });
  });

  it('returns a skipped plan outside win32', () => {
    expect(resolveWindowsServiceHostPlan({
      platform: 'linux',
      env,
      appDir: '/srv/codexmux',
    })).toMatchObject({
      platform: 'linux',
      skipped: true,
      reason: 'windows-service-host-only-runs-on-win32',
      mutatesSystem: false,
    });
  });
});
