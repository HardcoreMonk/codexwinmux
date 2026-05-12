import { describe, expect, it } from 'vitest';
import path from 'path';
import { pathToFileURL } from 'url';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/pack-electron-windows-lib.mjs')).href);

describe('Windows Electron package wrapper helpers', () => {
  it('builds a Windows unpacked electron-builder command without native rebuild', async () => {
    const { buildElectronBuilderArgs } = await loadLib();

    expect(buildElectronBuilderArgs({ dir: true })).toEqual([
      '--win',
      '--dir',
      '--config.npmRebuild=false',
    ]);
  });

  it('adds signtool config from preferred CODEXWINMUX signing env aliases', async () => {
    const { buildElectronBuilderArgs } = await loadLib();

    expect(buildElectronBuilderArgs({
      env: {
        CODEXWINMUX_WINDOWS_CERTIFICATE_SHA1: '8C5F3B5030D3A54B1150C2C30CFD9868800DF0C6',
        CODEXWINMUX_WINDOWS_PUBLISHER_NAME: 'CN=Internal Publisher',
        CODEXWINMUX_WINDOWS_TIMESTAMP_SERVER: 'http://timestamp.digicert.com',
        CODEXMUX_WINDOWS_CERTIFICATE_SHA1: 'LEGACY',
      },
    })).toEqual([
      '--win',
      '--config.npmRebuild=false',
      '--config.win.signtoolOptions.certificateSha1=8C5F3B5030D3A54B1150C2C30CFD9868800DF0C6',
      '--config.win.signtoolOptions.publisherName=CN=Internal Publisher',
      '--config.win.signtoolOptions.rfc3161TimeStampServer=http://timestamp.digicert.com',
    ]);
  });

  it('prepends a temporary pnpm shim directory to PATH', async () => {
    const { buildElectronBuilderEnv } = await loadLib();

    expect(buildElectronBuilderEnv({ env: { PATH: 'C:\\Windows' }, shimDir: 'C:\\tmp\\codexmux-bin' }).PATH)
      .toBe('C:\\tmp\\codexmux-bin;C:\\Windows');
  });

  it('builds Electron native prebuild install tasks for the standalone bundle', async () => {
    const { buildElectronNativePrebuildTasks } = await loadLib();

    expect(buildElectronNativePrebuildTasks({
      cwd: 'D:\\repo\\codexmux',
      electronVersion: '41.1.1',
      arch: 'x64',
    })).toEqual([
      {
        packageName: 'better-sqlite3',
        cwd: 'D:\\repo\\codexmux\\.next\\standalone\\node_modules\\better-sqlite3',
        args: [
          '--runtime',
          'electron',
          '--target',
          '41.1.1',
          '--arch',
          'x64',
          '--platform',
          'win32',
        ],
      },
    ]);
  });
});
