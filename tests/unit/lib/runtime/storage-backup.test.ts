import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRuntimeStorageBackup } from '@/lib/runtime/storage-backup';

let tempDir = '';

const writeFile = async (filePath: string, content: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
};

describe('runtime v2 storage backup', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-storage-backup-test-'));
  });

  afterEach(async () => {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('copies legacy JSON stores and runtime sqlite files into a timestamped backup directory', async () => {
    const dataDir = path.join(tempDir, '.codexwinmux');
    const outputRoot = path.join(tempDir, 'backups');
    await writeFile(path.join(dataDir, 'workspaces.json'), JSON.stringify({
      workspaces: [{ id: 'ws-a', name: 'Secret Workspace', directories: ['/secret/project'] }],
    }));
    await writeFile(path.join(dataDir, 'workspaces', 'ws-a', 'layout.json'), JSON.stringify({
      root: {
        type: 'pane',
        id: 'pane-a',
        tabs: [{ id: 'tab-a', sessionName: 'pt-secret-session', cwd: '/secret/project' }],
      },
    }));
    await writeFile(path.join(dataDir, 'workspaces', 'ws-a', 'notes.md'), 'non-json-secret-content');
    await writeFile(path.join(dataDir, 'runtime-v2', 'state.db'), 'sqlite-secret-content');
    await writeFile(path.join(dataDir, 'runtime-v2', 'state.db-wal'), 'wal-secret-content');

    const result = await createRuntimeStorageBackup({
      dataDir,
      outputRoot,
      timestamp: '20260504T051500Z',
    });

    expect(path.basename(result.backupDir)).toBe('runtime-v2-storage-20260504T051500Z');
    expect(result.copied.map((entry) => entry.relativePath).sort()).toEqual([
      'runtime-v2/state.db',
      'runtime-v2/state.db-wal',
      'workspaces.json',
      'workspaces/ws-a/layout.json',
    ]);
    await expect(fs.readFile(path.join(result.backupDir, 'workspaces/ws-a/layout.json'), 'utf-8'))
      .resolves.toContain('pt-secret-session');
    await expect(fs.readFile(path.join(result.backupDir, 'runtime-v2/state.db'), 'utf-8'))
      .resolves.toBe('sqlite-secret-content');

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('/secret/project');
    expect(serialized).not.toContain('Secret Workspace');
    expect(serialized).not.toContain('pt-secret-session');
    expect(serialized).not.toContain('sqlite-secret-content');
    expect(serialized).not.toContain('notes.md');
  });

  it('returns an empty manifest when no storage files exist', async () => {
    const dataDir = path.join(tempDir, '.codexwinmux');
    const outputRoot = path.join(tempDir, 'backups');

    const result = await createRuntimeStorageBackup({
      dataDir,
      outputRoot,
      timestamp: '20260504T052000Z',
    });

    expect(result.copied).toEqual([]);
    expect(result.backupDir.endsWith('runtime-v2-storage-20260504T052000Z')).toBe(true);
    await expect(fs.stat(result.backupDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
  });
});
