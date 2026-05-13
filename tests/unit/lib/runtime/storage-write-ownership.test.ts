import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ILayoutData, IWorkspacesData } from '@/types/terminal';

describe('runtime storage v2 write ownership mirror', () => {
  let homeDir: string | null = null;
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalRuntimeV2 = process.env.CODEXWINMUX_RUNTIME_V2;
  const originalStorageMode = process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE;
  const originalRuntimeDb = process.env.CODEXWINMUX_RUNTIME_DB;

  afterEach(async () => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    process.env.CODEXWINMUX_RUNTIME_V2 = originalRuntimeV2;
    process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = originalStorageMode;
    process.env.CODEXWINMUX_RUNTIME_DB = originalRuntimeDb;
    vi.resetModules();
    if (homeDir) {
      await fs.rm(homeDir, { recursive: true, force: true });
      homeDir = null;
    }
  });

  it('imports a legacy layout write into SQLite when storage mode is write', async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-storage-write-'));
    const dataDir = path.join(homeDir, '.codexwinmux');
    const layoutDir = path.join(dataDir, 'workspaces', 'ws-a');
    const layoutPath = path.join(layoutDir, 'layout.json');
    const dbPath = path.join(dataDir, 'runtime-v2', 'state.db');
    const workspaces: IWorkspacesData = {
      workspaces: [{
        id: 'ws-a',
        name: 'Workspace A',
        directories: [homeDir],
        groupId: 'grp-a',
      }],
      groups: [{ id: 'grp-a', name: 'Group A', collapsed: true }],
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
        tabs: [{
          id: 'tab-a',
          sessionName: 'pt-ws-a-pane-a-tab-a',
          name: '',
          order: 0,
          runtimeVersion: 1,
          cwd: homeDir,
          cliState: 'busy',
          agentSessionId: 'agent-a',
          agentSummary: 'summary',
        }],
      },
      activePaneId: 'pane-a',
      updatedAt: '2026-05-04T00:00:00.000Z',
    };

    await fs.mkdir(layoutDir, { recursive: true });
    await fs.writeFile(path.join(dataDir, 'workspaces.json'), JSON.stringify(workspaces), { mode: 0o600 });
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.CODEXWINMUX_RUNTIME_V2 = '1';
    process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = 'write';
    process.env.CODEXWINMUX_RUNTIME_DB = dbPath;
    vi.resetModules();

    const { writeLayoutFile } = await import('@/lib/layout-store');
    const { openRuntimeDatabase } = await import('@/lib/runtime/storage/schema');
    const { createStorageRepository } = await import('@/lib/runtime/storage/repository');

    await writeLayoutFile(layout, layoutPath);

    const db = openRuntimeDatabase(dbPath);
    try {
      const projection = createStorageRepository(db).getWorkspaceLayout('ws-a');
      expect(projection?.activePaneId).toBe('pane-a');
      expect(projection?.root.type).toBe('pane');
      if (projection?.root.type === 'pane') {
        expect(projection.root.tabs).toEqual([
          expect.objectContaining({
            id: 'tab-a',
            runtimeVersion: 1,
            cliState: 'busy',
            agentSessionId: 'agent-a',
          }),
        ]);
      }
    } finally {
      db.close();
    }
  });
});
