import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const statusManager = {
    registerTab: vi.fn(),
  };
  const supervisor = {
    ensureStarted: vi.fn(),
    createTerminalTab: vi.fn(),
    deleteTerminalTab: vi.fn(),
  };
  return {
    addTabToPane: vi.fn(),
    addExistingTabToPane: vi.fn(),
    updateTabAgentSessionId: vi.fn(),
    getActiveWorkspaceId: vi.fn(),
    getWorkspaceById: vi.fn(),
    getStatusManager: vi.fn(() => statusManager),
    statusManager,
    getProviderByPanelType: vi.fn(),
    sendKeys: vi.fn(),
    getRuntimeSupervisor: vi.fn(() => supervisor),
    supervisor,
  };
});

vi.mock('@/lib/layout-store', () => ({
  addTabToPane: mocks.addTabToPane,
  addExistingTabToPane: mocks.addExistingTabToPane,
  updateTabAgentSessionId: mocks.updateTabAgentSessionId,
}));

vi.mock('@/lib/workspace-store', () => ({
  getActiveWorkspaceId: mocks.getActiveWorkspaceId,
  getWorkspaceById: mocks.getWorkspaceById,
}));

vi.mock('@/lib/status-manager', () => ({
  getStatusManager: mocks.getStatusManager,
}));

vi.mock('@/lib/providers', () => ({
  getProviderByPanelType: mocks.getProviderByPanelType,
}));

vi.mock('@/lib/tmux', () => ({
  sendKeys: mocks.sendKeys,
}));

vi.mock('@/lib/runtime/supervisor', () => ({
  getRuntimeSupervisor: mocks.getRuntimeSupervisor,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

import handler from '@/pages/api/layout/pane/[paneId]/tabs';

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

const createRequest = (body: unknown): NextApiRequest => ({
  method: 'POST',
  query: { workspace: 'ws-a', paneId: 'pane-a' },
  body,
  headers: {},
}) as unknown as NextApiRequest;

describe('layout tab api runtime routing', () => {
  beforeEach(() => {
    delete process.env.CODEXWINMUX_RUNTIME_V2;
    delete process.env.CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE;
    delete process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE;
    delete process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE;
    delete process.env.CODEXWINMUX_RUNTIME_STATUS_V2_MODE;
    process.env.CODEXMUX_RUNTIME_V2 = '1';
    process.env.CODEXMUX_RUNTIME_TERMINAL_V2_MODE = 'off';
    process.env.CODEXMUX_RUNTIME_STORAGE_V2_MODE = 'off';
    process.env.CODEXMUX_RUNTIME_TIMELINE_V2_MODE = 'off';
    process.env.CODEXMUX_RUNTIME_STATUS_V2_MODE = 'off';
    Object.values(mocks).forEach((value) => {
      if (typeof value === 'function') value.mockReset();
    });
    mocks.statusManager.registerTab.mockReset();
    mocks.supervisor.ensureStarted.mockReset();
    mocks.supervisor.createTerminalTab.mockReset();
    mocks.supervisor.deleteTerminalTab.mockReset();
    mocks.getWorkspaceById.mockResolvedValue({
      id: 'ws-a',
      name: 'Workspace A',
      directories: ['/repo'],
    });
    mocks.addTabToPane.mockResolvedValue({
      id: 'tab-legacy',
      sessionName: 'pt-ws-a-pane-a-tab-legacy',
      name: '',
      order: 1,
      runtimeVersion: 1,
    });
    mocks.supervisor.createTerminalTab.mockResolvedValue({
      id: 'tab-runtime',
      sessionName: 'rtv2-ws-a-pane-a-tab-runtime',
      name: '',
      order: 0,
      cwd: '/repo',
      panelType: 'terminal',
      runtimeVersion: 2,
      lifecycleState: 'ready',
    });
    mocks.addExistingTabToPane.mockResolvedValue({
      id: 'tab-runtime',
      sessionName: 'rtv2-ws-a-pane-a-tab-runtime',
      name: '',
      order: 1,
      cwd: '/repo',
      panelType: 'terminal',
      runtimeVersion: 2,
    });
  });

  it('keeps using legacy tab creation when terminal v2 mode is off', async () => {
    const response = createResponse();

    await handler(createRequest({ cwd: '/repo', panelType: 'terminal' }), response.res);

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ sessionName: 'pt-ws-a-pane-a-tab-legacy', runtimeVersion: 1 });
    expect(mocks.addTabToPane).toHaveBeenCalledWith('ws-a', 'pane-a', undefined, '/repo', 'terminal', undefined);
    expect(mocks.getRuntimeSupervisor).not.toHaveBeenCalled();
  });

  it('creates plain new terminal tabs through runtime v2 when new-tabs mode is enabled', async () => {
    process.env.CODEXMUX_RUNTIME_TERMINAL_V2_MODE = 'new-tabs';
    const response = createResponse();

    await handler(createRequest({ cwd: '/repo', panelType: 'terminal' }), response.res);

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ sessionName: 'rtv2-ws-a-pane-a-tab-runtime', runtimeVersion: 2 });
    expect(mocks.supervisor.ensureStarted).toHaveBeenCalled();
    expect(mocks.supervisor.createTerminalTab).toHaveBeenCalledWith({
      workspaceId: 'ws-a',
      paneId: 'pane-a',
      cwd: '/repo',
      ensureWorkspacePane: {
        workspaceName: 'Workspace A',
        defaultCwd: '/repo',
      },
    });
    expect(mocks.addExistingTabToPane).toHaveBeenCalledWith('ws-a', 'pane-a', expect.objectContaining({
      id: 'tab-runtime',
      runtimeVersion: 2,
    }));
    expect(mocks.addTabToPane).not.toHaveBeenCalled();
  });

  it('keeps command-start and non-terminal tabs on the legacy path', async () => {
    process.env.CODEXMUX_RUNTIME_TERMINAL_V2_MODE = 'new-tabs';

    await handler(createRequest({ cwd: '/repo', panelType: 'terminal', command: 'codex' }), createResponse().res);
    await handler(createRequest({ cwd: '/repo', panelType: 'codex' }), createResponse().res);

    expect(mocks.addTabToPane).toHaveBeenCalledTimes(2);
    expect(mocks.getRuntimeSupervisor).not.toHaveBeenCalled();
  });

  it('deletes the created runtime v2 tab when legacy layout append fails', async () => {
    process.env.CODEXMUX_RUNTIME_TERMINAL_V2_MODE = 'new-tabs';
    mocks.addExistingTabToPane.mockResolvedValueOnce(null);
    const response = createResponse();

    await handler(createRequest({ cwd: '/repo', panelType: 'terminal' }), response.res);

    expect(response.statusCode).toBe(404);
    expect(response.body).toMatchObject({ error: 'Pane not found' });
    expect(mocks.supervisor.deleteTerminalTab).toHaveBeenCalledWith('tab-runtime');
  });
});
