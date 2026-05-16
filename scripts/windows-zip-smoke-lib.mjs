import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const requiredEntryGroups = [
  {
    check: 'zip-entry-app-exe',
    patterns: ['codexwinmux.exe'],
  },
  {
    check: 'zip-entry-app-asar',
    patterns: ['resources/app.asar'],
  },
  {
    check: 'zip-entry-app-update',
    patterns: ['resources/app-update.yml'],
  },
  {
    check: 'zip-entry-runtime-workers',
    patterns: [
      'resources/app.asar.unpacked/dist/workers/terminal-worker.js',
      'resources/app.asar.unpacked/dist/workers/storage-worker.js',
      'resources/app.asar.unpacked/dist/workers/timeline-worker.js',
      'resources/app.asar.unpacked/dist/workers/status-worker.js',
    ],
  },
  {
    check: 'zip-entry-node-pty-conpty',
    patterns: [
      'resources/app.asar.unpacked/.next/standalone/node_modules/node-pty/build/Release/conpty/conpty.dll',
      'resources/app.asar.unpacked/.next/standalone/node_modules/node-pty/build/Release/conpty/OpenConsole.exe',
    ],
  },
  {
    check: 'zip-entry-better-sqlite3',
    patterns: [
      'resources/app.asar.unpacked/.next/standalone/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    ],
  },
  {
    check: 'zip-entry-standalone-runtime-deps',
    patterns: [
      'resources/app.asar.unpacked/.next/standalone/node_modules/nanoid/package.json',
      'resources/app.asar.unpacked/.next/standalone/node_modules/zod/package.json',
    ],
  },
];

const normalizeZipEntryName = (value) => String(value || '').replace(/\\/g, '/');

export const findWindowsZipArtifact = (releaseDir) => {
  const entries = fs.existsSync(releaseDir)
    ? fs.readdirSync(releaseDir, { withFileTypes: true })
    : [];
  const zips = entries
    .filter((entry) => entry.isFile() && /^codexwinmux-.+-win\.zip$/i.test(entry.name))
    .map((entry) => path.join(releaseDir, entry.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  return zips[0] ?? null;
};

export const evaluateWindowsZipEntries = (entries) => {
  const names = new Set((Array.isArray(entries) ? entries : []).map((entry) => normalizeZipEntryName(entry.fullName)));
  const checks = [];
  const missingEntryPatterns = [];

  for (const group of requiredEntryGroups) {
    const missing = group.patterns.filter((pattern) => !names.has(pattern));
    if (missing.length === 0) {
      checks.push(group.check);
    } else {
      missingEntryPatterns.push(...missing);
    }
  }

  return {
    ok: missingEntryPatterns.length === 0,
    checks,
    missingEntryPatterns,
    entryCount: Array.isArray(entries) ? entries.length : 0,
  };
};

export const readWindowsZipEntries = (zipPath) =>
  new Promise((resolve, reject) => {
    const script = [
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      '$zip = $env:CODEXMUX_WINDOWS_ZIP_PATH',
      '$archive = [IO.Compression.ZipFile]::OpenRead($zip)',
      'try {',
      '  @($archive.Entries | ForEach-Object { [PSCustomObject]@{ fullName = $_.FullName; length = $_.Length } }) | ConvertTo-Json -Depth 3 -Compress',
      '} finally {',
      '  $archive.Dispose()',
      '}',
    ].join('; ');

    const child = spawn('powershell.exe', ['-NoProfile', '-Command', script], {
      env: {
        ...process.env,
        CODEXMUX_WINDOWS_ZIP_PATH: zipPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`zip listing failed with ${code}: ${stderr.slice(-800)}`));
        return;
      }
      try {
        const parsed = stdout.trim() ? JSON.parse(stdout) : [];
        resolve(Array.isArray(parsed) ? parsed : [parsed]);
      } catch (err) {
        reject(new Error(`zip listing JSON parse failed: ${err instanceof Error ? err.message : String(err)}`));
      }
    });
  });
