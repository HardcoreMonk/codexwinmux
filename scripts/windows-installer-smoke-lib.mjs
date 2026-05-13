import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

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
  appExe: path.win32.join(installDir, 'codexwinmux.exe'),
  appAsar: path.win32.join(installDir, 'resources', 'app.asar'),
  uninstaller: path.win32.join(installDir, 'Uninstall codexwinmux.exe'),
});

const normalizeWinPath = (value) =>
  String(value || '')
    .replace(/\//g, '\\')
    .replace(/\\+$/g, '')
    .toLowerCase();

const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

export const parseWindowsUninstallExecutablePath = (uninstallString) => {
  const text = String(uninstallString || '').trim();
  const quoted = /^"([^"]+\.exe)"/i.exec(text);
  if (quoted) return quoted[1];
  const unquoted = /^(.+?\.exe)(?:\s|$)/i.exec(text);
  return unquoted?.[1] || '';
};

export const isStaleCodexwinmuxSmokeUninstallEntry = ({
  displayName,
  uninstallString,
  removeExistingSmokeInstall = false,
  tempDir = os.tmpdir(),
  uninstallerExists = false,
} = {}) => {
  if (!/^codexwinmux(?:\s|$)/i.test(String(displayName || '').trim())) return false;
  if (uninstallerExists && !removeExistingSmokeInstall) return false;

  const uninstallerPath = parseWindowsUninstallExecutablePath(uninstallString);
  const normalizedUninstaller = normalizeWinPath(uninstallerPath);
  const normalizedTemp = normalizeWinPath(tempDir);
  if (!normalizedUninstaller || !normalizedUninstaller.startsWith(`${normalizedTemp}\\`)) return false;

  return /\\codexwinmux-updater-local-feed-smoke-[^\\]+\\/i.test(normalizedUninstaller)
    || /\\codexmux-installer-smoke-[^\\]+\\/i.test(normalizedUninstaller);
};

const listCodexwinmuxUninstallEntriesScript = `
$ErrorActionPreference = 'Stop'
$root = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
$rows = @()
if (Test-Path -LiteralPath $root) {
  Get-ChildItem -LiteralPath $root | ForEach-Object {
    $item = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
    if ($item.DisplayName -like 'codexwinmux*') {
      $rows += [PSCustomObject]@{
        keyPath = $_.Name
        displayName = [string]$item.DisplayName
        uninstallString = [string]$item.UninstallString
      }
    }
  }
}
$rows | ConvertTo-Json -Compress
`;

const defaultRunPowerShell = (command) =>
  spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
  });

export const cleanupStaleCodexwinmuxSmokeUninstallEntries = ({
  fileExists = fs.existsSync,
  runPowerShell = defaultRunPowerShell,
  tempDir = os.tmpdir(),
} = {}) => {
  if (process.platform !== 'win32') return { removed: [], checked: 0 };

  const listResult = runPowerShell(listCodexwinmuxUninstallEntriesScript);
  if (listResult.status !== 0) {
    return {
      removed: [],
      checked: 0,
      error: String(listResult.stderr || listResult.stdout || 'registry query failed').trim(),
    };
  }

  const parsed = listResult.stdout?.trim() ? JSON.parse(listResult.stdout) : [];
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const staleEntries = entries.filter((entry) => {
    const uninstallerPath = parseWindowsUninstallExecutablePath(entry?.uninstallString);
    return isStaleCodexwinmuxSmokeUninstallEntry({
      displayName: entry?.displayName,
      uninstallString: entry?.uninstallString,
      removeExistingSmokeInstall: true,
      tempDir,
      uninstallerExists: uninstallerPath ? fileExists(uninstallerPath) : false,
    });
  });

  const removed = [];
  for (const entry of staleEntries) {
    if (!entry?.keyPath) continue;
    const removeResult = runPowerShell(`Remove-Item -LiteralPath ${psQuote(`Registry::${entry.keyPath}`)} -Recurse -Force`);
    if (removeResult.status === 0) {
      removed.push(entry.keyPath);
    }
  }

  return { removed, checked: entries.length };
};
