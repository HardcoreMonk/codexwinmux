import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/windows-zip-smoke-lib.mjs')).href);

describe('Windows zip smoke helpers', () => {
  it('selects the newest Windows zip artifact', async () => {
    const { findWindowsZipArtifact } = await loadLib();
    const releaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexwinmux-windows-zip-test-'));
    const older = path.join(releaseDir, 'codexwinmux-0.4.1-win.zip');
    const newer = path.join(releaseDir, 'codexwinmux-0.4.2-win.zip');
    await fs.writeFile(older, '');
    await fs.writeFile(path.join(releaseDir, 'codexwinmux Setup 0.4.2.exe.blockmap'), '');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fs.writeFile(newer, '');

    expect(findWindowsZipArtifact(releaseDir)).toBe(newer);
  });

  it('validates required Windows zip entries', async () => {
    const { evaluateWindowsZipEntries } = await loadLib();

    const result = evaluateWindowsZipEntries([
      { fullName: 'codexwinmux.exe', length: 100 },
      { fullName: 'resources/app.asar', length: 100 },
      { fullName: 'resources/app-update.yml', length: 100 },
      { fullName: 'resources/app.asar.unpacked/dist/workers/terminal-worker.js', length: 100 },
      { fullName: 'resources/app.asar.unpacked/dist/workers/storage-worker.js', length: 100 },
      { fullName: 'resources/app.asar.unpacked/dist/workers/timeline-worker.js', length: 100 },
      { fullName: 'resources/app.asar.unpacked/dist/workers/status-worker.js', length: 100 },
      { fullName: 'resources/app.asar.unpacked/.next/standalone/node_modules/node-pty/build/Release/conpty/conpty.dll', length: 100 },
      { fullName: 'resources/app.asar.unpacked/.next/standalone/node_modules/node-pty/build/Release/conpty/OpenConsole.exe', length: 100 },
      { fullName: 'resources/app.asar.unpacked/.next/standalone/node_modules/better-sqlite3/build/Release/better_sqlite3.node', length: 100 },
    ]);

    expect(result).toEqual({
      ok: true,
      checks: [
        'zip-entry-app-exe',
        'zip-entry-app-asar',
        'zip-entry-app-update',
        'zip-entry-runtime-workers',
        'zip-entry-node-pty-conpty',
        'zip-entry-better-sqlite3',
      ],
      missingEntryPatterns: [],
      entryCount: 10,
    });
  });

  it('reports missing required entries without raw archive listing', async () => {
    const { evaluateWindowsZipEntries } = await loadLib();

    const result = evaluateWindowsZipEntries([
      { fullName: 'codexwinmux.exe', length: 100 },
      { fullName: 'resources/app.asar', length: 100 },
    ]);

    expect(result.ok).toBe(false);
    expect(result.missingEntryPatterns).toContain('resources/app.asar.unpacked/dist/workers/terminal-worker.js');
    expect(JSON.stringify(result)).not.toContain('resources/app.asar"');
  });
});
