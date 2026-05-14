import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const supervisor = {
    ensureStarted: vi.fn(),
    createTerminalTab: vi.fn(),
    deleteTerminalTab: vi.fn(),
  };
  return {
    verifyCliToken: vi.fn(),
    getLayout: vi.fn(),
    addTabToPane: vi.fn(),
    addExistingTabToPane: vi.fn(),
    getWorkspaceById: vi.fn(),
    getWorkspaces: vi.fn(),
    resolveFirstPaneId: vi.fn(),
    getRuntimeSupervisor: vi.fn(() => supervisor),
    broadcastSync: vi.fn(),
    supervisor,
  };
});

vi.mock('@/lib/cli-token', () => ({
  verifyCliToken: mocks.verifyCliToken,
}));

vi.mock('@/lib/layout-store', () => ({
  getLayout: mocks.getLayout,
  addTabToPane: mocks.addTabToPane,
  addExistingTabToPane: mocks.addExistingTabToPane,
}));

vi.mock('@/lib/workspace-store', () => ({
  getWorkspaceById: mocks.getWorkspaceById,
  getWorkspaces: mocks.getWorkspaces,
}));

vi.mock('@/lib/cli-utils', () => ({
  resolveFirstPaneId: mocks.resolveFirstPaneId,
}));

vi.mock('@/lib/runtime/supervisor', () => ({
  getRuntimeSupervisor: mocks.getRuntimeSupervisor,
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

import handler from '@/pages/api/cli/tabs';

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
  query: {},
  body,
  headers: {},
}) as unknown as NextApiRequest;

describe('CLI tabs API runtime storage ownership', () => {
  beforeEach(() => {
    delete process.env.CODEXWINMUX_RUNTIME_V2;
    delete process.env.CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE;
    delete process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE;
    delete process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE;
    delete process.env.CODEXWINMUX_RUNTIME_STATUS_V2_MODE;
    process.env.CODEXWINMUX_RUNTIME_V2 = '1';
    process.env.CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE = 'new-tabs';
    process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = 'default';
    process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE = 'default';
    process.env.CODEXWINMUX_RUNTIME_STATUS_V2_MODE = 'default';

    Object.values(mocks).forEach((value) => {
      if (typeof value === 'function') value.mockReset();
    });
    mocks.supervisor.ensureStarted.mockReset();
    mocks.supervisor.createTerminalTab.mockReset();
    mocks.supervisor.deleteTerminalTab.mockReset();

    mocks.verifyCliToken.mockReturnValue(true);
    mocks.getWorkspaceById.mockResolvedValue({
      id: 'ws-a',
      name: 'Workspace A',
      directories: ['/repo'],
    });
    mocks.getWorkspaces.mockResolvedValue({ workspaces: [], groups: [] });
    mocks.resolveFirstPaneId.mockResolvedValue('pane-a');
    mocks.addTabToPane.mockResolvedValue({
      id: 'tab-legacy',
      sessionName: 'pt-ws-a-pane-a-tab-legacy',
      name: 'Legacy',
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
      name: 'Runtime CLI',
      order: 0,
      cwd: '/repo',
      panelType: 'terminal',
      runtimeVersion: 2,
    });
  });

  it('creates plain terminal tabs through the runtime supervisor in storage default mode', async () => {
    const response = createResponse();

    await handler(createRequest({
      workspaceId: 'ws-a',
      name: 'Runtime CLI',
      panelType: 'terminal',
    }), response.res);

    expect(response.statusCode).toBe(201);
    expect(response.body).toMatchObject({
      tabId: 'tab-runtime',
      workspaceId: 'ws-a',
      paneId: 'pane-a',
      sessionName: 'rtv2-ws-a-pane-a-tab-runtime',
    });
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
    expect(mocks.addTabToPane).not.toHaveBeenCalled();
    expect(mocks.addExistingTabToPane).not.toHaveBeenCalled();
    expect(mocks.broadcastSync).toHaveBeenCalledWith({ type: 'layout', workspaceId: 'ws-a' });
  });

  it('mirrors runtime tabs into legacy layout when storage default read is not active', async () => {
    process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = 'write';
    const response = createResponse();

    await handler(createRequest({
      workspaceId: 'ws-a',
      name: 'Runtime CLI',
      panelType: 'terminal',
    }), response.res);

    expect(response.statusCode).toBe(201);
    expect(mocks.addExistingTabToPane).toHaveBeenCalledWith('ws-a', 'pane-a', expect.objectContaining({
      id: 'tab-runtime',
      name: 'Runtime CLI',
      runtimeVersion: 2,
    }));
    expect(mocks.addTabToPane).not.toHaveBeenCalled();
    expect(mocks.broadcastSync).not.toHaveBeenCalled();
  });

  it('keeps non-terminal CLI tabs on the legacy creation path', async () => {
    const response = createResponse();

    await handler(createRequest({
      workspaceId: 'ws-a',
      name: 'Browser',
      panelType: 'web-browser',
    }), response.res);

    expect(response.statusCode).toBe(201);
    expect(response.body).toMatchObject({ tabId: 'tab-legacy', sessionName: 'pt-ws-a-pane-a-tab-legacy' });
    expect(mocks.addTabToPane).toHaveBeenCalledWith('ws-a', 'pane-a', 'Browser', '/repo', 'web-browser');
    expect(mocks.getRuntimeSupervisor).not.toHaveBeenCalled();
  });
});
