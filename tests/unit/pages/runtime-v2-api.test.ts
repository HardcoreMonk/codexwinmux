import os from 'os';
import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const supervisor = {
    ensureStarted: vi.fn(),
    health: vi.fn(),
    listWorkspaces: vi.fn(),
    createWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    deleteTerminalTab: vi.fn(),
    createTerminalTab: vi.fn(),
    getLayout: vi.fn(),
    listTimelineSessions: vi.fn(),
    readTimelineEntriesBefore: vi.fn(),
    getTimelineMessageCounts: vi.fn(),
  };
  return {
    auth: vi.fn(),
    getRuntimeSupervisor: vi.fn(() => supervisor),
    supervisor,
  };
});

vi.mock('@/lib/runtime/api-auth', () => ({
  verifyRuntimeV2ApiAuth: mocks.auth,
}));

vi.mock('@/lib/runtime/supervisor', () => ({
  getRuntimeSupervisor: mocks.getRuntimeSupervisor,
}));

import healthHandler from '@/pages/api/v2/runtime/health';
import workspacesHandler from '@/pages/api/v2/workspaces';
import workspaceCleanupHandler from '@/pages/api/v2/workspaces/[workspaceId]';
import layoutHandler from '@/pages/api/v2/workspaces/[workspaceId]/layout';
import tabsHandler from '@/pages/api/v2/tabs';
import tabHandler from '@/pages/api/v2/tabs/[tabId]';
import timelineSessionsHandler from '@/pages/api/v2/timeline/sessions';
import timelineEntriesHandler from '@/pages/api/v2/timeline/entries';
import timelineMessageCountsHandler from '@/pages/api/v2/timeline/message-counts';

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

const createRequest = (input: {
  method?: string;
  body?: unknown;
  query?: Record<string, string>;
  url?: string;
}): NextApiRequest => ({
  method: input.method ?? 'GET',
  body: input.body,
  query: input.query ?? {},
  url: input.url ?? '/api/v2/runtime/health',
  headers: {},
}) as unknown as NextApiRequest;

describe('runtime v2 api routes', () => {
  beforeEach(() => {
    delete process.env.CODEXWINMUX_RUNTIME_V2;
    delete process.env.CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE;
    delete process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE;
    delete process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE;
    delete process.env.CODEXWINMUX_RUNTIME_STATUS_V2_MODE;
    process.env.CODEXWINMUX_RUNTIME_V2 = '1';
    delete process.env.CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE;
    delete process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE;
    delete process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE;
    delete process.env.CODEXWINMUX_RUNTIME_STATUS_V2_MODE;
    mocks.auth.mockReset();
    mocks.getRuntimeSupervisor.mockClear();
    Object.values(mocks.supervisor).forEach((mock) => mock.mockReset());
    mocks.auth.mockResolvedValue(true);
    mocks.supervisor.ensureStarted.mockResolvedValue(undefined);
    mocks.supervisor.health.mockResolvedValue({ ok: true, storage: {}, terminal: {} });
    mocks.supervisor.listWorkspaces.mockResolvedValue([{ id: 'ws-a', name: 'Runtime', defaultCwd: '/tmp', active: 1, orderIndex: 0, createdAt: 'now', updatedAt: 'now' }]);
    mocks.supervisor.createWorkspace.mockResolvedValue({ id: 'ws-a', rootPaneId: 'pane-a' });
    mocks.supervisor.deleteWorkspace.mockResolvedValue({ deleted: true, killedSessions: ['rtv2-ws-a-pane-a-tab-a'], failedKills: [] });
    mocks.supervisor.deleteTerminalTab.mockResolvedValue({ deleted: true, killedSession: 'rtv2-ws-a-pane-a-tab-a', failedKill: null });
    mocks.supervisor.getLayout.mockResolvedValue({ root: { type: 'pane', id: 'pane-a', tabs: [] }, activePaneId: 'pane-a', updatedAt: 'now' });
    mocks.supervisor.createTerminalTab.mockResolvedValue({ id: 'tab-a', sessionName: 'rtv2-ws-a-pane-a-tab-a', name: '', order: 0, cwd: '/tmp', panelType: 'terminal', lifecycleState: 'ready', runtimeVersion: 2 });
    mocks.supervisor.listTimelineSessions.mockResolvedValue({ sessions: [], total: 0, hasMore: false });
    mocks.supervisor.readTimelineEntriesBefore.mockResolvedValue({ entries: [], startByteOffset: 0, hasMore: false });
    mocks.supervisor.getTimelineMessageCounts.mockResolvedValue({ userCount: 0, assistantCount: 0, toolCount: 0, toolBreakdown: {} });
  });

  it('rejects unauthenticated v2 API calls', async () => {
    mocks.auth.mockResolvedValue(false);
    const response = createResponse();
    await healthHandler(createRequest({ method: 'GET' }), response.res);
    expect(response.statusCode).toBe(401);
    expect(mocks.getRuntimeSupervisor).not.toHaveBeenCalled();
  });

  it('returns disabled before auth when runtime v2 flag is off', async () => {
    delete process.env.CODEXWINMUX_RUNTIME_V2;
    process.env.CODEXWINMUX_RUNTIME_V2 = '0';
    mocks.auth.mockResolvedValue(false);
    const cases = [
      { handler: healthHandler, request: createRequest({ method: 'GET' }) },
      { handler: workspacesHandler, request: createRequest({ method: 'GET' }) },
      { handler: workspaceCleanupHandler, request: createRequest({ method: 'DELETE', query: { workspaceId: 'ws-a' } }) },
      { handler: layoutHandler, request: createRequest({ method: 'GET', query: { workspaceId: 'ws-a' } }) },
      { handler: tabsHandler, request: createRequest({ method: 'POST', body: { workspaceId: 'ws-a', paneId: 'pane-a' } }) },
      { handler: tabHandler, request: createRequest({ method: 'DELETE', query: { tabId: 'tab-a' } }) },
      { handler: timelineSessionsHandler, request: createRequest({ method: 'GET', query: { tmuxSession: 'pt-ws-pane-tab' } }) },
      { handler: timelineEntriesHandler, request: createRequest({ method: 'GET', query: { jsonlPath: '/tmp/nope.jsonl', beforeByte: '1' } }) },
      { handler: timelineMessageCountsHandler, request: createRequest({ method: 'GET', query: { jsonlPath: '/tmp/nope.jsonl' } }) },
    ];

    for (const { handler, request } of cases) {
      const response = createResponse();
      await handler(request, response.res);
      expect(response.statusCode).toBe(404);
      expect(response.body).toMatchObject({ error: 'runtime-v2-disabled' });
    }

    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.getRuntimeSupervisor).not.toHaveBeenCalled();
  });

  it('returns method errors before supervisor access', async () => {
    const cases = [
      { handler: healthHandler, request: createRequest({ method: 'POST' }), allow: 'GET' },
      { handler: workspacesHandler, request: createRequest({ method: 'PATCH' }), allow: 'GET, POST' },
      { handler: workspaceCleanupHandler, request: createRequest({ method: 'GET', query: { workspaceId: 'ws-a' } }), allow: 'DELETE' },
      { handler: layoutHandler, request: createRequest({ method: 'POST', query: { workspaceId: 'ws-a' } }), allow: 'GET' },
      { handler: tabsHandler, request: createRequest({ method: 'GET' }), allow: 'POST' },
      { handler: tabHandler, request: createRequest({ method: 'POST', query: { tabId: 'tab-a' } }), allow: 'DELETE' },
      { handler: timelineSessionsHandler, request: createRequest({ method: 'POST', query: { tmuxSession: 'pt-ws-pane-tab' } }), allow: 'GET' },
      { handler: timelineEntriesHandler, request: createRequest({ method: 'POST', query: { jsonlPath: '/tmp/nope.jsonl', beforeByte: '1' } }), allow: 'GET' },
      { handler: timelineMessageCountsHandler, request: createRequest({ method: 'POST', query: { jsonlPath: '/tmp/nope.jsonl' } }), allow: 'GET' },
    ];

    for (const { handler, request, allow } of cases) {
      const response = createResponse();
      await handler(request, response.res);
      expect(response.statusCode).toBe(405);
      expect(response.body).toMatchObject({ error: 'Method not allowed' });
      expect(response.headers.Allow).toBe(allow);
    }

    expect(mocks.getRuntimeSupervisor).not.toHaveBeenCalled();
  });

  it('returns health and workspace lists', async () => {
    process.env.CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE = 'new-tabs';
    process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = 'write';
    process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE = 'shadow';
    process.env.CODEXWINMUX_RUNTIME_STATUS_V2_MODE = 'shadow';
    const health = createResponse();
    await healthHandler(createRequest({ method: 'GET' }), health.res);
    expect(health.statusCode).toBe(200);
    expect(health.body).toMatchObject({
      ok: true,
      terminalV2Mode: 'new-tabs',
      storageV2Mode: 'write',
      timelineV2Mode: 'shadow',
      statusV2Mode: 'shadow',
    });
    expect(mocks.supervisor.ensureStarted).toHaveBeenCalled();

    const workspaces = createResponse();
    await workspacesHandler(createRequest({ method: 'GET' }), workspaces.res);
    expect(workspaces.statusCode).toBe(200);
    expect(workspaces.body).toMatchObject({ workspaces: [expect.objectContaining({ id: 'ws-a' })] });
  });

  it('returns phase 6 code fallback modes when surface env modes are unset', async () => {
    const health = createResponse();
    await healthHandler(createRequest({ method: 'GET' }), health.res);

    expect(health.statusCode).toBe(200);
    expect(health.body).toMatchObject({
      ok: true,
      terminalV2Mode: 'new-tabs',
      storageV2Mode: 'default',
      timelineV2Mode: 'default',
      statusV2Mode: 'default',
    });
  });

  it('returns timeline v2 read surfaces', async () => {
    const sessions = createResponse();
    await timelineSessionsHandler(createRequest({
      method: 'GET',
      query: { tmuxSession: 'pt-ws-pane-tab', panelType: 'codex', limit: '10', offset: '5', source: 'remote', sourceId: 'win11' },
    }), sessions.res);
    expect(sessions.statusCode).toBe(200);
    expect(sessions.body).toMatchObject({ total: 0, hasMore: false });
    expect(mocks.supervisor.listTimelineSessions).toHaveBeenCalledWith({
      tmuxSession: 'pt-ws-pane-tab',
      cwd: undefined,
      panelType: 'codex',
      offset: 5,
      limit: 10,
    });

    const allowedPath = `${os.homedir()}/.codex/sessions/session.jsonl`;
    const entries = createResponse();
    await timelineEntriesHandler(createRequest({
      method: 'GET',
      query: {
        jsonlPath: allowedPath,
        beforeByte: '100',
        limit: '25',
        panelType: 'codex',
      },
    }), entries.res);
    expect(entries.statusCode).toBe(200);
    expect(mocks.supervisor.readTimelineEntriesBefore).toHaveBeenCalledWith({
      jsonlPath: allowedPath,
      beforeByte: 100,
      limit: 25,
      panelType: 'codex',
    });

    const counts = createResponse();
    await timelineMessageCountsHandler(createRequest({
      method: 'GET',
      query: { jsonlPath: allowedPath },
    }), counts.res);
    expect(counts.statusCode).toBe(200);
    expect(counts.body).toMatchObject({ userCount: 0, assistantCount: 0, toolCount: 0 });
    expect(mocks.supervisor.getTimelineMessageCounts).toHaveBeenCalledWith(allowedPath);
  });

  it('validates tab creation requests', async () => {
    const response = createResponse();
    await tabsHandler(createRequest({ method: 'POST', body: { workspaceId: '', paneId: '' } }), response.res);
    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({ error: 'invalid-runtime-v2-request' });
  });

  it('creates terminal tabs and deletes tabs and workspaces', async () => {
    const tabResponse = createResponse();
    await tabsHandler(createRequest({
      method: 'POST',
      body: { workspaceId: 'ws-a', paneId: 'pane-a', cwd: '/tmp' },
    }), tabResponse.res);
    expect(tabResponse.statusCode).toBe(200);
    expect(tabResponse.body).toMatchObject({ sessionName: 'rtv2-ws-a-pane-a-tab-a', runtimeVersion: 2 });

    const tabDeleteResponse = createResponse();
    await tabHandler(createRequest({
      method: 'DELETE',
      query: { tabId: 'tab-a' },
    }), tabDeleteResponse.res);
    expect(tabDeleteResponse.statusCode).toBe(200);
    expect(tabDeleteResponse.body).toMatchObject({ deleted: true, killedSession: 'rtv2-ws-a-pane-a-tab-a' });
    expect(mocks.supervisor.deleteTerminalTab).toHaveBeenCalledWith('tab-a');

    const deleteResponse = createResponse();
    await workspaceCleanupHandler(createRequest({
      method: 'DELETE',
      query: { workspaceId: 'ws-a' },
    }), deleteResponse.res);
    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.body).toMatchObject({ deleted: true });
    expect(mocks.supervisor.deleteWorkspace).toHaveBeenCalledWith('ws-a');
  });

  it('maps worker and domain failures', async () => {
    mocks.supervisor.createTerminalTab.mockRejectedValueOnce(Object.assign(new Error('terminal worker exited'), {
      code: 'worker-exited',
      retryable: true,
    }));
    const workerFailure = createResponse();
    await tabsHandler(createRequest({
      method: 'POST',
      body: { workspaceId: 'ws-a', paneId: 'pane-a' },
    }), workerFailure.res);
    expect(workerFailure.statusCode).toBe(503);
    expect(workerFailure.body).toMatchObject({ retryable: true });

    mocks.supervisor.createTerminalTab.mockRejectedValueOnce(Object.assign(new Error('pane does not belong to workspace'), {
      code: 'runtime-v2-pane-workspace-mismatch',
      retryable: false,
    }));
    const domainFailure = createResponse();
    await tabsHandler(createRequest({
      method: 'POST',
      body: { workspaceId: 'ws-a', paneId: 'pane-other' },
    }), domainFailure.res);
    expect(domainFailure.statusCode).toBe(409);
    expect(domainFailure.body).toMatchObject({ error: 'runtime-v2-pane-workspace-mismatch' });
  });

  it('returns 404 for missing layouts', async () => {
    mocks.supervisor.getLayout.mockResolvedValue(null);
    const response = createResponse();
    await layoutHandler(createRequest({ method: 'GET', query: { workspaceId: 'ws-missing' } }), response.res);
    expect(response.statusCode).toBe(404);
  });
});
