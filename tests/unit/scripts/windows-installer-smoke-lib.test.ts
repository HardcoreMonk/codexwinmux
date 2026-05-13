import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/windows-installer-smoke-lib.mjs')).href);

describe('Windows installer smoke helpers', () => {
  it('builds silent NSIS install args with the install directory last', async () => {
    const { buildNsisSilentInstallArgs } = await loadLib();

    expect(buildNsisSilentInstallArgs('C:\\temp\\codexmux-install')).toEqual([
      '/S',
      '/D=C:\\temp\\codexmux-install',
    ]);
  });

  it('selects the newest codexmux NSIS installer', async () => {
    const { findWindowsInstaller } = await loadLib();
    const releaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-installer-test-'));
    const older = path.join(releaseDir, 'codexwinmux Setup 0.4.1.exe');
    const newer = path.join(releaseDir, 'codexwinmux-Setup-0.4.2.exe');
    await fs.writeFile(older, '');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fs.writeFile(newer, '');

    expect(findWindowsInstaller(releaseDir)).toBe(newer);
  });

  it('resolves installed app paths from the install directory', async () => {
    const { resolveInstalledAppPaths } = await loadLib();

    expect(resolveInstalledAppPaths('C:\\apps\\codexmux')).toEqual({
      appExe: 'C:\\apps\\codexmux\\codexwinmux.exe',
      appAsar: 'C:\\apps\\codexmux\\resources\\app.asar',
      uninstaller: 'C:\\apps\\codexmux\\Uninstall codexwinmux.exe',
    });
  });

  it('detects stale codexwinmux uninstall entries left by temp smoke installs', async () => {
    const { isStaleCodexwinmuxSmokeUninstallEntry } = await loadLib();

    expect(isStaleCodexwinmuxSmokeUninstallEntry({
      displayName: 'codexwinmux 0.4.15',
      uninstallString: '"C:\\Users\\yohan\\AppData\\Local\\Temp\\codexwinmux-updater-local-feed-smoke-twT0Ft\\app\\Uninstall codexwinmux.exe" /currentuser',
      tempDir: 'C:\\Users\\yohan\\AppData\\Local\\Temp',
      uninstallerExists: false,
    })).toBe(true);

    expect(isStaleCodexwinmuxSmokeUninstallEntry({
      displayName: 'codexwinmux 0.4.15',
      uninstallString: '"C:\\Users\\yohan\\AppData\\Local\\Temp\\codexwinmux-updater-local-feed-smoke-twT0Ft\\app\\Uninstall codexwinmux.exe" /currentuser',
      tempDir: 'C:\\Users\\yohan\\AppData\\Local\\Temp',
      uninstallerExists: true,
      removeExistingSmokeInstall: true,
    })).toBe(true);
    expect(isStaleCodexwinmuxSmokeUninstallEntry({
      displayName: 'codexwinmux 0.4.15',
      uninstallString: '"C:\\Users\\yohan\\AppData\\Local\\Temp\\codexwinmux-updater-local-feed-smoke-twT0Ft\\app\\Uninstall codexwinmux.exe" /currentuser',
      tempDir: 'C:\\Users\\yohan\\AppData\\Local\\Temp',
      uninstallerExists: true,
    })).toBe(false);
    expect(isStaleCodexwinmuxSmokeUninstallEntry({
      displayName: 'codexwinmux 0.4.15',
      uninstallString: '"C:\\Program Files\\codexwinmux\\Uninstall codexwinmux.exe" /currentuser',
      tempDir: 'C:\\Users\\yohan\\AppData\\Local\\Temp',
      uninstallerExists: false,
    })).toBe(false);
    expect(isStaleCodexwinmuxSmokeUninstallEntry({
      displayName: 'Other App',
      uninstallString: '"C:\\Users\\yohan\\AppData\\Local\\Temp\\codexmux-installer-smoke-abc\\app\\Uninstall codexwinmux.exe"',
      tempDir: 'C:\\Users\\yohan\\AppData\\Local\\Temp',
      uninstallerExists: false,
    })).toBe(false);
  });
});
