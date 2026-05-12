import fs from 'fs';
import path from 'path';

export const buildNsisSilentInstallArgs = (installDir) => {
  if (!installDir) throw new Error('installDir is required');
  return ['/S', `/D=${installDir}`];
};

export const findWindowsInstaller = (releaseDir) => {
  const entries = fs.existsSync(releaseDir)
    ? fs.readdirSync(releaseDir, { withFileTypes: true })
    : [];
  const installers = entries
    .filter((entry) => entry.isFile() && /^codexwinmux(?: Setup |-Setup-).+\.exe$/i.test(entry.name))
    .map((entry) => path.join(releaseDir, entry.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  return installers[0] ?? null;
};

export const resolveInstalledAppPaths = (installDir) => ({
  appExe: path.join(installDir, 'codexwinmux.exe'),
  appAsar: path.join(installDir, 'resources', 'app.asar'),
  uninstaller: path.join(installDir, 'Uninstall codexwinmux.exe'),
});
