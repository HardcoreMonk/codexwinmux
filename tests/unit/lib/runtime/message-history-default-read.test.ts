import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { importLegacyStorageSnapshot } from '@/lib/runtime/storage-import';
import { openRuntimeDatabase } from '@/lib/runtime/storage/schema';
import type { ILayoutData, IWorkspacesData } from '@/types/terminal';

describe('runtime storage v2 message history ownership', () => {
  const originalHome = process.env.HOME;
  const originalRuntimeV2 = process.env.CODEXWINMUX_RUNTIME_V2;
  const originalStorageMode = process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE;
  const originalRuntimeDb = process.env.CODEXWINMUX_RUNTIME_DB;
  let homeDir: string | null = null;

  afterEach(async () => {
    process.env.HOME = originalHome;
    process.env.CODEXWINMUX_RUNTIME_V2 = originalRuntimeV2;
    process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = originalStorageMode;
    process.env.CODEXWINMUX_RUNTIME_DB = originalRuntimeDb;
    vi.resetModules();
    if (homeDir) {
      await fs.rm(homeDir, { recursive: true, force: true });
      homeDir = null;
    }
  });

  it('reads and writes message history through SQLite in default mode while mirroring JSON fallback', async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-message-history-'));
    const dataDir = path.join(homeDir, '.codexwinmux');
    const dbPath = path.join(dataDir, 'runtime-v2', 'state.db');
    const workspacesData: IWorkspacesData = {
      workspaces: [{ id: 'ws-a', name: 'Workspace A', directories: [homeDir] }],
      groups: [],
      activeWorkspaceId: 'ws-a',
      sidebarCollapsed: false,
      sidebarWidth: 240,
      updatedAt: '2026-05-04T00:00:00.000Z',
    };
    const layout: ILayoutData = {
      root: {
        type: 'pane',
        id: 'pane-a',
        activeTabId: 'tab-a',
        tabs: [{ id: 'tab-a', sessionName: 'pt-ws-a-pane-a-tab-a', name: '', order: 0, runtimeVersion: 1 }],
      },
      activePaneId: 'pane-a',
      updatedAt: '2026-05-04T00:00:00.000Z',
    };

    const db = openRuntimeDatabase(dbPath);
    importLegacyStorageSnapshot(db, {
      workspacesData,
      layoutsByWorkspaceId: { 'ws-a': layout },
      messageHistoryByWorkspaceId: {
        'ws-a': [{ id: 'hist-imported', message: 'imported message', sentAt: '2026-05-04T00:00:00.000Z' }],
      },
      importedAt: '2026-05-04T00:00:00.000Z',
    });
    db.close();

    process.env.HOME = homeDir;
    process.env.CODEXWINMUX_RUNTIME_V2 = '1';
    process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = 'default';
    process.env.CODEXWINMUX_RUNTIME_DB = dbPath;
    vi.resetModules();

    const { readMessageHistory, addMessageHistory, deleteMessageHistory } = await import('@/lib/message-history-store');

    expect(await readMessageHistory('ws-a')).toEqual([
      { id: 'hist-imported', message: 'imported message', sentAt: '2026-05-04T00:00:00.000Z' },
    ]);

    const added = await addMessageHistory('ws-a', 'new message');
    expect(await readMessageHistory('ws-a')).toEqual([
      expect.objectContaining({ id: added.id, message: 'new message' }),
      { id: 'hist-imported', message: 'imported message', sentAt: '2026-05-04T00:00:00.000Z' },
    ]);

    process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = 'off';
    expect(await readMessageHistory('ws-a')).toEqual([
      expect.objectContaining({ id: added.id, message: 'new message' }),
      { id: 'hist-imported', message: 'imported message', sentAt: '2026-05-04T00:00:00.000Z' },
    ]);

    process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = 'default';
    expect(await deleteMessageHistory('ws-a', added.id)).toBe(true);
    expect(await readMessageHistory('ws-a')).toEqual([
      { id: 'hist-imported', message: 'imported message', sentAt: '2026-05-04T00:00:00.000Z' },
    ]);
  });
});
