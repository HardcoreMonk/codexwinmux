import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('useWorkspaceStore', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('syncs workspaces with a no-store request so browser cache cannot hide external updates', async () => {
    const { default: useWorkspaceStore } = await import('@/hooks/use-workspace-store');
    useWorkspaceStore.setState({
      workspaces: [{ id: 'ws-one', name: 'Before', directories: ['D:/project'] }],
      groups: [],
      activeWorkspaceId: 'ws-one',
      sidebarCollapsed: false,
      sidebarWidth: 240,
      sidebarTab: 'workspace',
      isSettingsDialogOpen: false,
      isCheatSheetOpen: false,
      isLoading: false,
      error: null,
      pendingDeleteIds: new Set<string>(),
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        workspaces: [{ id: 'ws-one', name: 'After', directories: ['D:/project'] }],
        groups: [],
        activeWorkspaceId: 'ws-one',
        sidebarCollapsed: false,
        sidebarWidth: 240,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await useWorkspaceStore.getState().syncWorkspaces();

    expect(fetchMock).toHaveBeenCalledWith('/api/workspace', { cache: 'no-store' });
    expect(useWorkspaceStore.getState().workspaces[0]?.name).toBe('After');
  });
});
