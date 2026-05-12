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
});
