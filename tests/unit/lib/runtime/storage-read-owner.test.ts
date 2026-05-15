import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { importLegacyStorageSnapshot } from '@/lib/runtime/storage-import';
import { openRuntimeDatabase } from '@/lib/runtime/storage/schema';
import type { ILayoutData, IWorkspacesData } from '@/types/terminal';

const restoreEnv = (key: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
};

describe('runtime storage v2 default read ownership', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalRuntimeV2 = process.env.CODEXWINMUX_RUNTIME_V2;
  const originalStorageMode = process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE;
  const originalRuntimeDb = process.env.CODEXWINMUX_RUNTIME_DB;
  let homeDir: string | null = null;

  afterEach(async () => {
    restoreEnv('HOME', originalHome);
    restoreEnv('USERPROFILE', originalUserProfile);
    restoreEnv('CODEXWINMUX_RUNTIME_V2', originalRuntimeV2);
    restoreEnv('CODEXWINMUX_RUNTIME_STORAGE_V2_MODE', originalStorageMode);
    restoreEnv('CODEXWINMUX_RUNTIME_DB', originalRuntimeDb);
    vi.resetModules();
    if (homeDir) {
      await fs.rm(homeDir, { recursive: true, force: true });
      homeDir = null;
    }
  });

  it('reads workspace and layout projection from SQLite when storage mode is default', async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-storage-read-'));
    const dataDir = path.join(homeDir, '.codexwinmux');
    const wsDir = path.join(dataDir, 'workspaces', 'ws-sqlite');
    const dbPath = path.join(dataDir, 'runtime-v2', 'state.db');
    const staleWorkspaces: IWorkspacesData = {
      workspaces: [{ id: 'ws-json', name: 'JSON', directories: [homeDir] }],
      groups: [],
      activeWorkspaceId: 'ws-json',
      sidebarCollapsed: false,
      sidebarWidth: 240,
      updatedAt: '2026-05-04T00:00:00.000Z',
    };
    const sqliteWorkspaces: IWorkspacesData = {
      workspaces: [{
        id: 'ws-sqlite',
        name: 'SQLite',
        directories: ['/sqlite/project', '/sqlite/project/sub'],
        groupId: 'grp-sqlite',
      }],
      groups: [{ id: 'grp-sqlite', name: 'SQLite Group', collapsed: true }],
      activeWorkspaceId: 'ws-sqlite',
      sidebarCollapsed: true,
      sidebarWidth: 300,
      updatedAt: '2026-05-04T00:01:00.000Z',
    };
    const sqliteLayout: ILayoutData = {
      root: {
        type: 'pane',
        id: 'pane-sqlite',
        activeTabId: 'tab-sqlite',
        tabs: [{
          id: 'tab-sqlite',
          sessionName: 'pt-ws-sqlite-pane-sqlite-tab-sqlite',
          name: 'SQLite tab',
          order: 0,
          runtimeVersion: 1,
          cwd: '/sqlite/project',
        }],
      },
      activePaneId: 'pane-sqlite',
      updatedAt: '2026-05-04T00:01:00.000Z',
    };

    await fs.mkdir(wsDir, { recursive: true });
    await fs.writeFile(path.join(dataDir, 'workspaces.json'), JSON.stringify(staleWorkspaces), { mode: 0o600 });
    await fs.writeFile(path.join(wsDir, 'layout.json'), JSON.stringify({
      root: { type: 'pane', id: 'pane-json', activeTabId: null, tabs: [] },
      activePaneId: 'pane-json',
      updatedAt: '2026-05-04T00:00:00.000Z',
    }), { mode: 0o600 });

    const db = openRuntimeDatabase(dbPath);
    importLegacyStorageSnapshot(db, {
      workspacesData: sqliteWorkspaces,
      layoutsByWorkspaceId: { 'ws-sqlite': sqliteLayout },
      importedAt: '2026-05-04T00:01:00.000Z',
    });
    db.close();

    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.CODEXWINMUX_RUNTIME_V2 = '1';
    process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = 'default';
    process.env.CODEXWINMUX_RUNTIME_DB = dbPath;
    vi.resetModules();

    const { getWorkspaces, getActiveWorkspaceId, getWorkspaceById } = await import('@/lib/workspace-store');
    const { readLayoutFile, resolveLayoutFile } = await import('@/lib/layout-store');

    expect(await getWorkspaces()).toEqual({
      workspaces: sqliteWorkspaces.workspaces,
      groups: sqliteWorkspaces.groups,
      activeWorkspaceId: 'ws-sqlite',
      sidebarCollapsed: true,
      sidebarWidth: 300,
    });
    expect(await getActiveWorkspaceId()).toBe('ws-sqlite');
    expect(await getWorkspaceById('ws-sqlite')).toEqual(sqliteWorkspaces.workspaces[0]);
    const layout = await readLayoutFile(resolveLayoutFile('ws-sqlite'));
    expect(layout?.activePaneId).toBe(sqliteLayout.activePaneId);
    expect(layout?.updatedAt).toBe(sqliteLayout.updatedAt);
    expect(layout?.root.type).toBe('pane');
    if (layout?.root.type === 'pane') {
      expect(layout.root.tabs).toEqual([
        expect.objectContaining({
          id: 'tab-sqlite',
          sessionName: 'pt-ws-sqlite-pane-sqlite-tab-sqlite',
          runtimeVersion: 1,
          cwd: '/sqlite/project',
        }),
      ]);
    }
  });

  it('does not replace an existing SQLite snapshot with empty JSON during default-mode initialization', async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-storage-init-'));
    const dataDir = path.join(homeDir, '.codexwinmux');
    const dbPath = path.join(dataDir, 'runtime-v2', 'state.db');
    const workspacesData: IWorkspacesData = {
      workspaces: [{ id: 'ws-sqlite', name: 'SQLite Only', directories: [homeDir] }],
      groups: [],
      activeWorkspaceId: 'ws-sqlite',
      sidebarCollapsed: false,
      sidebarWidth: 240,
      updatedAt: '2026-05-04T00:00:00.000Z',
    };
    const layout: ILayoutData = {
      root: {
        type: 'pane',
        id: 'pane-sqlite',
        activeTabId: 'tab-sqlite',
        tabs: [{
          id: 'tab-sqlite',
          sessionName: 'pt-ws-sqlite-pane-sqlite-tab-sqlite',
          name: '',
          order: 0,
          runtimeVersion: 1,
        }],
      },
      activePaneId: 'pane-sqlite',
      updatedAt: '2026-05-04T00:00:00.000Z',
    };

    const db = openRuntimeDatabase(dbPath);
    importLegacyStorageSnapshot(db, {
      workspacesData,
      layoutsByWorkspaceId: { 'ws-sqlite': layout },
      importedAt: '2026-05-04T00:00:00.000Z',
    });
    db.close();

    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.CODEXWINMUX_RUNTIME_V2 = '1';
    process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = 'default';
    process.env.CODEXWINMUX_RUNTIME_DB = dbPath;
    vi.resetModules();

    const { initWorkspaceStore, getWorkspaces } = await import('@/lib/workspace-store');
    await initWorkspaceStore();

    expect(await getWorkspaces()).toEqual({
      workspaces: workspacesData.workspaces,
      groups: [],
      activeWorkspaceId: 'ws-sqlite',
      sidebarCollapsed: false,
      sidebarWidth: 240,
    });
  });

  it('keeps an empty SQLite snapshot authoritative over stale JSON workspaces', async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-storage-empty-authority-'));
    const dataDir = path.join(homeDir, '.codexwinmux');
    const dbPath = path.join(dataDir, 'runtime-v2', 'state.db');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(path.join(dataDir, 'workspaces.json'), JSON.stringify({
      workspaces: [],
      groups: [],
      activeWorkspaceId: 'ws-stale',
      sidebarCollapsed: false,
      sidebarWidth: 240,
      updatedAt: '2026-05-04T00:00:00.000Z',
    }), { mode: 0o600 });

    openRuntimeDatabase(dbPath).close();

    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.CODEXWINMUX_RUNTIME_V2 = '1';
    process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = 'default';
    process.env.CODEXWINMUX_RUNTIME_DB = dbPath;
    vi.resetModules();

    const { getWorkspaces, getActiveWorkspaceId } = await import('@/lib/workspace-store');

    expect(await getWorkspaces()).toEqual({
      workspaces: [],
      groups: [],
      activeWorkspaceId: undefined,
      sidebarCollapsed: false,
      sidebarWidth: 240,
    });
    expect(await getActiveWorkspaceId()).toBeNull();
  });

  it('throws instead of falling back to stale workspace JSON when runtime default storage is unavailable', async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-storage-no-workspace-fallback-'));
    const dataDir = path.join(homeDir, '.codexwinmux');
    const blockingPath = path.join(homeDir, 'runtime-db-parent-file');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(blockingPath, 'not a directory');
    await fs.writeFile(path.join(dataDir, 'workspaces.json'), JSON.stringify({
      workspaces: [{ id: 'ws-json', name: 'stale JSON', directories: [homeDir] }],
      groups: [],
      activeWorkspaceId: 'ws-json',
      sidebarCollapsed: false,
      sidebarWidth: 240,
      updatedAt: '2026-05-16T00:00:00.000Z',
    }), { mode: 0o600 });

    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.CODEXWINMUX_RUNTIME_V2 = '1';
    process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = 'default';
    process.env.CODEXWINMUX_RUNTIME_DB = path.join(blockingPath, 'state.db');
    vi.resetModules();

    const { getWorkspaces } = await import('@/lib/workspace-store');

    await expect(getWorkspaces()).rejects.toMatchObject({
      code: 'runtime-storage-unavailable',
    });
  });

  it('throws instead of falling back to stale layout JSON when runtime default layout read is unavailable', async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-storage-no-layout-fallback-'));
    const dataDir = path.join(homeDir, '.codexwinmux');
    const layoutDir = path.join(dataDir, 'workspaces', 'ws-json');
    const blockingPath = path.join(homeDir, 'runtime-db-parent-file');
    await fs.mkdir(layoutDir, { recursive: true });
    await fs.writeFile(blockingPath, 'not a directory');
    await fs.writeFile(path.join(layoutDir, 'layout.json'), JSON.stringify({
      root: {
        type: 'pane',
        id: 'pane-json',
        activeTabId: null,
        tabs: [],
      },
      activePaneId: 'pane-json',
      updatedAt: '2026-05-16T00:00:00.000Z',
    }), { mode: 0o600 });

    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.CODEXWINMUX_RUNTIME_V2 = '1';
    process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = 'default';
    process.env.CODEXWINMUX_RUNTIME_DB = path.join(blockingPath, 'state.db');
    vi.resetModules();

    const { readLayoutFile, resolveLayoutFile } = await import('@/lib/layout-store');

    await expect(readLayoutFile(resolveLayoutFile('ws-json'))).rejects.toMatchObject({
      code: 'runtime-storage-unavailable',
    });
  });

  it('throws instead of falling back to message history JSON when runtime default workspace projection is missing', async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-storage-no-history-fallback-'));
    const dataDir = path.join(homeDir, '.codexwinmux');
    const historyDir = path.join(dataDir, 'workspaces', 'ws-json');
    const dbPath = path.join(dataDir, 'runtime-v2', 'state.db');
    await fs.mkdir(historyDir, { recursive: true });
    await fs.writeFile(path.join(historyDir, 'message-history.json'), JSON.stringify({
      entries: [{ id: 'hist-json', message: 'stale JSON history', sentAt: '2026-05-16T00:00:00.000Z' }],
    }), { mode: 0o600 });
    openRuntimeDatabase(dbPath).close();

    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.CODEXWINMUX_RUNTIME_V2 = '1';
    process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = 'default';
    process.env.CODEXWINMUX_RUNTIME_DB = dbPath;
    vi.resetModules();

    const { readMessageHistory } = await import('@/lib/message-history-store');

    await expect(readMessageHistory('ws-json')).rejects.toMatchObject({
      code: 'runtime-storage-unavailable',
    });
  });

  it('throws instead of silently ignoring workspace UI writes when runtime default storage is unavailable', async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-storage-no-ui-write-fallback-'));
    const dataDir = path.join(homeDir, '.codexwinmux');
    const blockingPath = path.join(homeDir, 'runtime-db-parent-file');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(blockingPath, 'not a directory');
    await fs.writeFile(path.join(dataDir, 'workspaces.json'), JSON.stringify({
      workspaces: [{ id: 'ws-json', name: 'stale JSON', directories: [homeDir] }],
      groups: [],
      activeWorkspaceId: 'ws-json',
      sidebarCollapsed: false,
      sidebarWidth: 240,
      updatedAt: '2026-05-16T00:00:00.000Z',
    }), { mode: 0o600 });

    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.CODEXWINMUX_RUNTIME_V2 = '1';
    process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = 'default';
    process.env.CODEXWINMUX_RUNTIME_DB = path.join(blockingPath, 'state.db');
    vi.resetModules();

    const { updateActive } = await import('@/lib/workspace-store');

    await expect(updateActive({ sidebarWidth: 320 })).rejects.toMatchObject({
      code: 'runtime-storage-unavailable',
    });
    const raw = JSON.parse(await fs.readFile(path.join(dataDir, 'workspaces.json'), 'utf-8')) as IWorkspacesData;
    expect(raw.sidebarWidth).toBe(240);
  });

  it('updates workspace directories in SQLite instead of JSON when runtime default storage owns workspace state', async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-storage-directory-write-'));
    const dataDir = path.join(homeDir, '.codexwinmux');
    const dbPath = path.join(dataDir, 'runtime-v2', 'state.db');
    const workspacesData: IWorkspacesData = {
      workspaces: [{ id: 'ws-a', name: 'Workspace A', directories: ['/runtime/original'] }],
      groups: [],
      activeWorkspaceId: 'ws-a',
      sidebarCollapsed: false,
      sidebarWidth: 240,
      updatedAt: '2026-05-16T00:00:00.000Z',
    };
    const layout: ILayoutData = {
      root: {
        type: 'pane',
        id: 'pane-a',
        activeTabId: 'tab-a',
        tabs: [{ id: 'tab-a', sessionName: 'pt-ws-a-pane-a-tab-a', name: '', order: 0, runtimeVersion: 1 }],
      },
      activePaneId: 'pane-a',
      updatedAt: '2026-05-16T00:00:00.000Z',
    };

    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(path.join(dataDir, 'workspaces.json'), JSON.stringify({
      ...workspacesData,
      workspaces: [{ id: 'ws-a', name: 'Workspace A', directories: ['/json/original'] }],
    }), { mode: 0o600 });
    const db = openRuntimeDatabase(dbPath);
    importLegacyStorageSnapshot(db, {
      workspacesData,
      layoutsByWorkspaceId: { 'ws-a': layout },
      importedAt: '2026-05-16T00:00:00.000Z',
    });
    db.close();

    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.CODEXWINMUX_RUNTIME_V2 = '1';
    process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = 'default';
    process.env.CODEXWINMUX_RUNTIME_DB = dbPath;
    vi.resetModules();

    const { updateWorkspaceDirectories, getWorkspaceById } = await import('@/lib/workspace-store');

    await updateWorkspaceDirectories('ws-a', ['/runtime/next', '/runtime/next/sub']);

    await expect(getWorkspaceById('ws-a')).resolves.toMatchObject({
      directories: ['/runtime/next', '/runtime/next/sub'],
    });
    const raw = JSON.parse(await fs.readFile(path.join(dataDir, 'workspaces.json'), 'utf-8')) as IWorkspacesData;
    expect(raw.workspaces[0].directories).toEqual(['/json/original']);
  });
});
