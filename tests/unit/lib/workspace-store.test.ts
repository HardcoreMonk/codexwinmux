import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalRuntimeV2 = process.env.CODEXMUX_RUNTIME_V2;
const originalRuntimeStorageV2Mode = process.env.CODEXMUX_RUNTIME_STORAGE_V2_MODE;

const restoreEnv = (key: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
};

describe('workspace store', () => {
  let homeDir: string;
  let dataDir: string;

  beforeEach(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-workspace-store-'));
    dataDir = path.join(homeDir, '.codexmux');
    await fs.mkdir(dataDir, { recursive: true });
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    delete process.env.CODEXMUX_RUNTIME_V2;
    delete process.env.CODEXMUX_RUNTIME_STORAGE_V2_MODE;
    delete (globalThis as { __codexmuxWorkspaceLock?: unknown }).__codexmuxWorkspaceLock;
    delete (globalThis as { __codexmuxWorkspacesContentCache?: unknown }).__codexmuxWorkspacesContentCache;
    vi.resetModules();
  });

  afterEach(async () => {
    restoreEnv('HOME', originalHome);
    restoreEnv('USERPROFILE', originalUserProfile);
    restoreEnv('CODEXMUX_RUNTIME_V2', originalRuntimeV2);
    restoreEnv('CODEXMUX_RUNTIME_STORAGE_V2_MODE', originalRuntimeStorageV2Mode);
    await fs.rm(homeDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('trims and persists workspace names on rename', async () => {
    await fs.writeFile(
      path.join(dataDir, 'workspaces.json'),
      JSON.stringify({
        workspaces: [
          { id: 'ws-one', name: 'Old name', directories: ['/tmp/project'] },
        ],
        groups: [],
        activeWorkspaceId: 'ws-one',
        sidebarCollapsed: false,
        sidebarWidth: 240,
        updatedAt: new Date(0).toISOString(),
      }),
    );

    const { getWorkspaces, renameWorkspace } = await import('@/lib/workspace-store');

    const renamed = await renameWorkspace('ws-one', '  New name  ');
    const data = await getWorkspaces();

    expect(renamed?.name).toBe('New name');
    expect(data.workspaces[0].name).toBe('New name');
  });

  it('ignores empty rename requests', async () => {
    await fs.writeFile(
      path.join(dataDir, 'workspaces.json'),
      JSON.stringify({
        workspaces: [
          { id: 'ws-one', name: 'Stable name', directories: ['/tmp/project'] },
        ],
        groups: [],
        activeWorkspaceId: 'ws-one',
        sidebarCollapsed: false,
        sidebarWidth: 240,
        updatedAt: new Date(0).toISOString(),
      }),
    );

    const { getWorkspaces, renameWorkspace } = await import('@/lib/workspace-store');

    const renamed = await renameWorkspace('ws-one', '   ');
    const data = await getWorkspaces();

    expect(renamed?.name).toBe('Stable name');
    expect(data.workspaces[0].name).toBe('Stable name');
  });

  it('creates the first workspace through runtime v2 storage default without tmux', async () => {
    process.env.CODEXMUX_RUNTIME_V2 = '1';
    process.env.CODEXMUX_RUNTIME_STORAGE_V2_MODE = 'default';
    const listWorkspaces = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'ws-runtime',
        name: 'Workspace 1',
        defaultCwd: homeDir,
        active: 1,
        groupId: null,
        orderIndex: 0,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      }]);
    const createRuntimeWorkspace = vi.fn().mockResolvedValue({ id: 'ws-runtime', rootPaneId: 'pane-runtime' });
    const createTerminalTab = vi.fn().mockResolvedValue({
      id: 'tab-runtime',
      sessionName: 'rtv2-ws-runtime-pane-runtime-tab-runtime',
      name: '',
      order: 0,
      cwd: homeDir,
      panelType: 'terminal',
      runtimeVersion: 2,
      lifecycleState: 'ready',
    });

    vi.doMock('@/lib/runtime/supervisor', () => ({
      getRuntimeSupervisor: () => ({
        listWorkspaces,
        createWorkspace: createRuntimeWorkspace,
        createTerminalTab,
      }),
    }));
    vi.doMock('@/lib/tmux', () => ({
      listSessions: vi.fn().mockResolvedValue([]),
      createSession: vi.fn(() => {
        throw new Error('legacy tmux createSession should not run');
      }),
      hasSession: vi.fn(),
      killSession: vi.fn(),
      resolveExistingDir: vi.fn((value: string) => value),
      sendKeys: vi.fn(),
      workspaceSessionName: vi.fn((wsId: string, paneId: string, tabId: string) => `pt-${wsId}-${paneId}-${tabId}`),
    }));
    vi.resetModules();

    const { createWorkspace } = await import('@/lib/workspace-store');

    await expect(createWorkspace(homeDir)).resolves.toEqual({
      id: 'ws-runtime',
      name: 'Workspace 1',
      directories: [homeDir],
      groupId: null,
    });
    expect(createRuntimeWorkspace).toHaveBeenCalledWith({ name: 'Workspace 1', defaultCwd: homeDir });
    expect(createTerminalTab).toHaveBeenCalledWith({
      workspaceId: 'ws-runtime',
      paneId: 'pane-runtime',
      cwd: homeDir,
    });
  });

  it('deletes workspaces through runtime v2 storage default', async () => {
    process.env.CODEXMUX_RUNTIME_V2 = '1';
    process.env.CODEXMUX_RUNTIME_STORAGE_V2_MODE = 'default';
    const deleteRuntimeWorkspace = vi.fn().mockResolvedValue({
      deleted: true,
      killedSessions: ['rtv2-ws-runtime-pane-runtime-tab-runtime'],
      failedKills: [],
    });

    vi.doMock('@/lib/runtime/supervisor', () => ({
      getRuntimeSupervisor: () => ({
        deleteWorkspace: deleteRuntimeWorkspace,
      }),
    }));
    vi.resetModules();

    const { deleteWorkspace } = await import('@/lib/workspace-store');

    await expect(deleteWorkspace('ws-runtime')).resolves.toBe(true);
    expect(deleteRuntimeWorkspace).toHaveBeenCalledWith('ws-runtime');
  });
});
