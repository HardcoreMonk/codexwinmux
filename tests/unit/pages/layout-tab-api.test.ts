import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const runtime = {
    ensureStarted: vi.fn(),
    getLayout: vi.fn(),
    restartTerminalTab: vi.fn(),
    removeStatusLiveTab: vi.fn(),
  };
  const statusManager = {
    removeTab: vi.fn(),
  };
  return {
    removeTabFromPane: vi.fn(),
    restartTabSession: vi.fn(),
    patchTab: vi.fn(),
    getActiveWorkspaceId: vi.fn(),
    getWorkspaceById: vi.fn(),
    getStatusManager: vi.fn(() => statusManager),
    statusManager,
    getCoreRuntimeApi: vi.fn(() => runtime),
    runtime,
    resolveExistingDir: vi.fn(),
    broadcastSync: vi.fn(),
  };
});

vi.mock('@/lib/layout-store', () => ({
  removeTabFromPane: mocks.removeTabFromPane,
  restartTabSession: mocks.restartTabSession,
  patchTab: mocks.patchTab,
}));

vi.mock('@/lib/workspace-store', () => ({
  getActiveWorkspaceId: mocks.getActiveWorkspaceId,
  getWorkspaceById: mocks.getWorkspaceById,
}));

vi.mock('@/lib/status-manager', () => ({
  getStatusManager: mocks.getStatusManager,
}));

vi.mock('@/lib/core-engine/runtime-api', () => ({
  getCoreRuntimeApi: mocks.getCoreRuntimeApi,
}));

vi.mock('@/lib/tmux', () => ({
  resolveExistingDir: mocks.resolveExistingDir,
}));

vi.mock('@/lib/sync-server', () => ({
  broadcastSync: mocks.broadcastSync,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

import handler from '@/pages/api/layout/pane/[paneId]/tabs/[tabId]';

const createResponse = () => {
  let statusCode = 0;
  let body: unknown;
  const headers: Record<string, number | string | string[]> = {};
  const res = {
    setHeader: vi.fn((name: string, value: number | string | string[]) => {
      headers[name] = value;
      return res;
    }),
    status: vi.fn((code: number) => {
      statusCode = code;
      return res;
    }),
    json: vi.fn((value: unknown) => {
      body = value;
      return res;
    }),
    end: vi.fn(() => res),
  } as unknown as NextApiResponse;

  return {
    res,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
    headers,
  };
};

const createRequest = (body: unknown = {}): NextApiRequest => ({
  method: 'POST',
  query: { workspace: 'ws-a', paneId: 'pane-a', tabId: 'tab-a' },
  body,
  headers: {},
}) as unknown as NextApiRequest;

describe('layout tab item api runtime routing', () => {
  beforeEach(() => {
    delete process.env.CODEXWINMUX_RUNTIME_V2;
    delete process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE;
    delete process.env.CODEXWINMUX_RUNTIME_STATUS_V2_MODE;
    process.env.CODEXWINMUX_RUNTIME_V2 = '1';
    process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = 'off';
    process.env.CODEXWINMUX_RUNTIME_STATUS_V2_MODE = 'off';

    Object.values(mocks).forEach((value) => {
      if (typeof value === 'function') value.mockReset();
    });
    mocks.runtime.ensureStarted.mockReset();
    mocks.runtime.getLayout.mockReset();
    mocks.runtime.restartTerminalTab.mockReset();
    mocks.runtime.removeStatusLiveTab.mockReset();
    mocks.statusManager.removeTab.mockReset();
    mocks.getWorkspaceById.mockResolvedValue({
      id: 'ws-a',
      name: 'Workspace A',
      directories: ['D:\\repo'],
    });
    mocks.resolveExistingDir.mockResolvedValue('D:\\repo');
    mocks.runtime.getLayout.mockResolvedValue({
      root: {
        type: 'pane',
        id: 'pane-a',
        activeTabId: 'tab-a',
        tabs: [{
          id: 'tab-a',
          sessionName: 'rtv2-ws-a-pane-a-tab-a',
          name: '',
          order: 0,
          runtimeVersion: 2,
          cwd: 'D:\\repo',
          panelType: 'terminal',
        }],
      },
      activePaneId: 'pane-a',
      updatedAt: new Date(0).toISOString(),
    });
    mocks.runtime.restartTerminalTab.mockResolvedValue({
      id: 'tab-a',
      sessionName: 'rtv2-ws-a-pane-a-tab-a',
      name: '',
      order: 0,
      runtimeVersion: 2,
      cwd: 'D:\\repo',
      panelType: 'terminal',
      lifecycleState: 'ready',
    });
    mocks.restartTabSession.mockResolvedValue(true);
  });

  it('keeps legacy restart routing when runtime storage is not the read owner', async () => {
    const response = createResponse();

    await handler(createRequest(), response.res);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(mocks.restartTabSession).toHaveBeenCalledWith('ws-a', 'pane-a', 'tab-a', undefined);
    expect(mocks.runtime.restartTerminalTab).not.toHaveBeenCalled();
  });

  it('restarts runtime v2 storage-default tabs through the core runtime api', async () => {
    process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = 'default';
    const response = createResponse();

    await handler(createRequest(), response.res);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(mocks.restartTabSession).not.toHaveBeenCalled();
    expect(mocks.runtime.ensureStarted).toHaveBeenCalled();
    expect(mocks.runtime.restartTerminalTab).toHaveBeenCalledWith({
      workspaceId: 'ws-a',
      paneId: 'pane-a',
      tabId: 'tab-a',
      sessionName: 'rtv2-ws-a-pane-a-tab-a',
      cwd: 'D:\\repo',
      ensureWorkspacePane: {
        workspaceName: 'Workspace A',
        defaultCwd: 'D:\\repo',
      },
    });
    expect(mocks.broadcastSync).toHaveBeenCalledWith({ type: 'layout', workspaceId: 'ws-a' });
  });

  it('does not fall back to the backend runtime when storage-default cannot find the tab', async () => {
    process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = 'default';
    mocks.runtime.getLayout.mockResolvedValueOnce({
      root: {
        type: 'pane',
        id: 'pane-a',
        activeTabId: null,
        tabs: [],
      },
      activePaneId: 'pane-a',
      updatedAt: new Date(0).toISOString(),
    });
    const response = createResponse();

    await handler(createRequest(), response.res);

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({ error: 'Tab not found' });
    expect(mocks.restartTabSession).not.toHaveBeenCalled();
    expect(mocks.runtime.restartTerminalTab).not.toHaveBeenCalled();
  });
});
