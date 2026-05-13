import { describe, expect, it } from 'vitest';
import {
  buildElectronBootstrapEnv,
  buildFileImportSpecifier,
  buildPackagedNodePath,
} from '../../../electron/runtime-env';

describe('Electron runtime environment helpers', () => {
  it('does not inject POSIX launch paths into Windows PATH', () => {
    const env = buildElectronBootstrapEnv({
      platform: 'win32',
      env: {
        PATH: 'C:\\Windows\\System32;C:\\Program Files\\nodejs',
      },
    });

    expect(env.PATH).toBe('C:\\Windows\\System32;C:\\Program Files\\nodejs');
    expect(env.LANG).toBeUndefined();
    expect(env.CODEXWINMUX_RUNTIME_V2).toBe('1');
    expect(env.CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE).toBe('new-tabs');
    expect(env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE).toBe('default');
    expect(env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE).toBe('default');
    expect(env.CODEXWINMUX_RUNTIME_STATUS_V2_MODE).toBe('default');
    expect(env.CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER).toBe('windows');
    expect(env.CODEXWINMUX_PROCESS_INSPECTOR_ADAPTER).toBe('windows');
    expect(env.CODEXMUX_RUNTIME_V2).toBeUndefined();
    expect(env.CODEXMUX_RUNTIME_TERMINAL_V2_MODE).toBeUndefined();
    expect(env.CODEXMUX_RUNTIME_STORAGE_V2_MODE).toBeUndefined();
    expect(env.CODEXMUX_RUNTIME_TIMELINE_V2_MODE).toBeUndefined();
    expect(env.CODEXMUX_RUNTIME_STATUS_V2_MODE).toBeUndefined();
    expect(env.CODEXMUX_RUNTIME_TERMINAL_ADAPTER).toBeUndefined();
    expect(env.CODEXMUX_PROCESS_INSPECTOR_ADAPTER).toBe('windows');
  });

  it('preserves explicit Windows runtime rollback settings', () => {
    const env = buildElectronBootstrapEnv({
      platform: 'win32',
      env: {
        CODEXWINMUX_RUNTIME_V2: '0',
        CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE: 'off',
        CODEXWINMUX_RUNTIME_STORAGE_V2_MODE: 'off',
        CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE: 'off',
        CODEXWINMUX_RUNTIME_STATUS_V2_MODE: 'off',
      },
    });

    expect(env.CODEXWINMUX_RUNTIME_V2).toBe('0');
    expect(env.CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE).toBe('off');
    expect(env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE).toBe('off');
    expect(env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE).toBe('off');
    expect(env.CODEXWINMUX_RUNTIME_STATUS_V2_MODE).toBe('off');
    expect(env.CODEXMUX_RUNTIME_V2).toBeUndefined();
  });

  it('ignores legacy CODEXMUX Windows runtime aliases after migration', () => {
    const env = buildElectronBootstrapEnv({
      platform: 'win32',
      env: {
        CODEXWINMUX_RUNTIME_V2: '0',
        CODEXMUX_RUNTIME_V2: '1',
        CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE: 'off',
        CODEXWINMUX_RUNTIME_STORAGE_V2_MODE: 'off',
        CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE: 'off',
        CODEXWINMUX_RUNTIME_STATUS_V2_MODE: 'off',
        CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER: 'windows',
        CODEXWINMUX_PROCESS_INSPECTOR_ADAPTER: 'windows',
      },
    });

    expect(env.CODEXWINMUX_RUNTIME_V2).toBe('0');
    expect(env.CODEXMUX_RUNTIME_V2).toBeUndefined();
    expect(env.CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE).toBe('off');
    expect(env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE).toBe('off');
    expect(env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE).toBe('off');
    expect(env.CODEXWINMUX_RUNTIME_STATUS_V2_MODE).toBe('off');
    expect(env.CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER).toBe('windows');
    expect(env.CODEXMUX_RUNTIME_TERMINAL_ADAPTER).toBeUndefined();
    expect(env.CODEXMUX_PROCESS_INSPECTOR_ADAPTER).toBe('windows');
  });

  it('keeps macOS Finder launch PATH compatibility', () => {
    const env = buildElectronBootstrapEnv({
      platform: 'darwin',
      env: {
        PATH: '/usr/bin:/bin',
      },
    });

    const pathParts = env.PATH?.split(':') ?? [];
    expect(pathParts).toEqual(expect.arrayContaining(['/opt/homebrew/bin', '/usr/local/bin', '/usr/sbin', '/sbin']));
    expect(pathParts).toContain('/usr/bin');
    expect(pathParts).toContain('/bin');
    expect(env.PATH).toContain('/opt/homebrew/bin');
    expect(env.LANG).toBe('en_US.UTF-8');
  });

  it('uses the Windows delimiter for packaged server NODE_PATH', () => {
    expect(buildPackagedNodePath({
      platform: 'win32',
      standaloneModules: 'C:\\codexmux\\resources\\app.asar\\.next\\standalone\\node_modules',
      existingNodePath: 'C:\\extra\\node_modules',
    })).toBe('C:\\codexmux\\resources\\app.asar\\.next\\standalone\\node_modules;C:\\extra\\node_modules');
  });

  it('uses the POSIX delimiter for packaged server NODE_PATH outside Windows', () => {
    expect(buildPackagedNodePath({
      platform: 'darwin',
      standaloneModules: '/Applications/codexmux.app/Contents/Resources/app.asar/.next/standalone/node_modules',
      existingNodePath: '/opt/cmux/node_modules',
    })).toBe('/Applications/codexmux.app/Contents/Resources/app.asar/.next/standalone/node_modules:/opt/cmux/node_modules');
  });

  it('converts packaged server paths to file import specifiers', () => {
    expect(buildFileImportSpecifier('D:\\codexmux\\resources\\app.asar\\dist\\server.js'))
      .toBe('file:///D:/codexmux/resources/app.asar/dist/server.js');
  });
});
