#!/usr/bin/env tsx
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createRuntimeStorageBackup } from '@/lib/runtime/storage-backup';

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

const writeFile = async (filePath: string, content: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
};

const main = async (): Promise<void> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-runtime-v2-storage-backup-'));
  const dataDir = path.join(root, '.codexwinmux');
  const outputRoot = path.join(root, 'backup-output');

  try {
    await writeFile(path.join(dataDir, 'workspaces.json'), JSON.stringify({
      workspaces: [{ id: 'ws-smoke', name: 'Backup Secret Workspace', directories: ['/secret/backup'] }],
    }));
    await writeFile(path.join(dataDir, 'workspaces', 'ws-smoke', 'layout.json'), JSON.stringify({
      root: {
        type: 'pane',
        id: 'pane-smoke',
        tabs: [{ id: 'tab-smoke', sessionName: 'pt-secret-backup-session', cwd: '/secret/backup' }],
      },
    }));
    await writeFile(path.join(dataDir, 'runtime-v2', 'state.db'), 'backup-secret-sqlite');

    const result = await createRuntimeStorageBackup({
      dataDir,
      outputRoot,
      timestamp: '20260504T053000Z',
    });
    const copiedPaths = result.copied.map((entry) => entry.relativePath).sort();
    assert(copiedPaths.includes('workspaces.json'), 'workspaces.json was not copied');
    assert(copiedPaths.includes('workspaces/ws-smoke/layout.json'), 'workspace layout was not copied');
    assert(copiedPaths.includes('runtime-v2/state.db'), 'runtime v2 state.db was not copied');

    const copiedLayout = await fs.readFile(path.join(result.backupDir, 'workspaces/ws-smoke/layout.json'), 'utf-8');
    assert(copiedLayout.includes('pt-secret-backup-session'), 'copied layout content mismatch');

    const serialized = JSON.stringify(result);
    assert(!serialized.includes('/secret/backup'), 'backup manifest leaked a cwd');
    assert(!serialized.includes('Backup Secret Workspace'), 'backup manifest leaked a workspace name');
    assert(!serialized.includes('pt-secret-backup-session'), 'backup manifest leaked a session name');
    assert(!serialized.includes('backup-secret-sqlite'), 'backup manifest leaked sqlite content');

    console.log(JSON.stringify({
      ok: true,
      copiedCount: result.copied.length,
      copiedPaths,
      backupDirBasename: path.basename(result.backupDir),
    }, null, 2));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
};

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
