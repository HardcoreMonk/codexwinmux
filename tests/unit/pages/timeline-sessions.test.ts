import type { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasSession: vi.fn(),
  listSessionPage: vi.fn(),
  coreRuntimeApi: {
    listTimelineSessions: vi.fn(),
  },
}));

vi.mock('@/lib/tmux', () => ({
  hasSession: mocks.hasSession,
}));

vi.mock('@/lib/session-list', () => ({
  listSessionPage: mocks.listSessionPage,
}));

vi.mock('@/lib/core-engine/runtime-api', () => ({
  getCoreRuntimeApi: vi.fn(() => mocks.coreRuntimeApi),
}));

import handler from '@/pages/api/timeline/sessions';

const originalRuntimeV2 = process.env.CODEXWINMUX_RUNTIME_V2;
const originalTimelineMode = process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE;
const originalPreferredRuntimeV2 = process.env.CODEXWINMUX_RUNTIME_V2;
const originalPreferredTimelineMode = process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE;

const restoreEnv = () => {
  if (originalPreferredRuntimeV2 === undefined) {
    delete process.env.CODEXWINMUX_RUNTIME_V2;
  } else {
    process.env.CODEXWINMUX_RUNTIME_V2 = originalPreferredRuntimeV2;
  }
  if (originalPreferredTimelineMode === undefined) {
    delete process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE;
  } else {
    process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE = originalPreferredTimelineMode;
  }
  if (originalRuntimeV2 === undefined) {
    delete process.env.CODEXWINMUX_RUNTIME_V2;
  } else {
    process.env.CODEXWINMUX_RUNTIME_V2 = originalRuntimeV2;
  }
  if (originalTimelineMode === undefined) {
    delete process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE;
  } else {
    process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE = originalTimelineMode;
  }
};

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

const createRequest = (query: Record<string, string>, method = 'GET'): NextApiRequest =>
  ({ method, query }) as unknown as NextApiRequest;

describe('/api/timeline/sessions', () => {
  beforeEach(() => {
    restoreEnv();
    delete process.env.CODEXWINMUX_RUNTIME_V2;
    delete process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE;
    delete process.env.CODEXWINMUX_RUNTIME_V2;
    delete process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE;
    mocks.hasSession.mockReset();
    mocks.listSessionPage.mockReset();
    mocks.coreRuntimeApi.listTimelineSessions.mockReset();
    mocks.hasSession.mockResolvedValue(false);
    mocks.listSessionPage.mockResolvedValue({
      sessions: [
        {
          sessionId: '019de318-38fe-7012-ab51-683d2ffd53cf',
          startedAt: '2026-05-01T10:31:48.759Z',
          lastActivityAt: '2026-05-01T17:00:34.751Z',
          firstMessage: 'Local work',
          turnCount: 1,
        },
      ],
      total: 1,
      hasMore: false,
    });
    mocks.coreRuntimeApi.listTimelineSessions.mockResolvedValue({ sessions: [], total: 0, hasMore: false });
  });

  afterEach(() => {
    restoreEnv();
  });

  it('returns Codex session index pages even when the tmux session is gone', async () => {
    const response = createResponse();

    await handler(createRequest({ tmuxSession: 'dead-tmux-session', panelType: 'codex' }), response.res);

    expect(response.statusCode).toBe(200);
    expect(mocks.hasSession).not.toHaveBeenCalled();
    expect(mocks.listSessionPage).toHaveBeenCalledWith(
      'dead-tmux-session',
      undefined,
      'codex',
      { offset: 0, limit: 50 },
    );
    expect(response.body).toMatchObject({ total: 1, hasMore: false });
  });

  it('marks session list responses as no-store because timeline sessions are dynamic UI state', async () => {
    const response = createResponse();

    await handler(createRequest({ tmuxSession: 'dead-tmux-session', panelType: 'codex' }), response.res);

    expect(response.headers['Cache-Control']).toBe('no-store');
  });

  it('ignores stale source filter query parameters', async () => {
    const response = createResponse();

    await handler(createRequest({
      tmuxSession: 'dead-tmux-session',
      panelType: 'codex',
      source: 'remote',
      sourceId: 'win11',
      limit: '10',
      offset: '20',
    }), response.res);

    expect(response.statusCode).toBe(200);
    expect(mocks.listSessionPage).toHaveBeenCalledWith(
      'dead-tmux-session',
      undefined,
      'codex',
      { offset: 20, limit: 10 },
    );
  });

  it('uses runtime v2 read ownership in default mode', async () => {
    delete process.env.CODEXWINMUX_RUNTIME_V2;
    delete process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE;
    process.env.CODEXWINMUX_RUNTIME_V2 = '1';
    process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE = 'default';
    const response = createResponse();

    await handler(createRequest({
      tmuxSession: 'dead-tmux-session',
      panelType: 'codex',
      cwd: '/workspace',
      limit: '10',
      offset: '20',
    }), response.res);

    expect(response.statusCode).toBe(200);
    expect(mocks.hasSession).not.toHaveBeenCalled();
    expect(mocks.listSessionPage).not.toHaveBeenCalled();
    expect(mocks.coreRuntimeApi.listTimelineSessions).toHaveBeenCalledWith({
      tmuxSession: 'dead-tmux-session',
      cwd: '/workspace',
      panelType: 'codex',
      offset: 20,
      limit: 10,
    });
  });

  it('still rejects missing tmux sessions for non-agent panel types', async () => {
    const response = createResponse();

    await handler(createRequest({ tmuxSession: 'dead-tmux-session', panelType: 'terminal' }), response.res);

    expect(response.statusCode).toBe(404);
    expect(mocks.hasSession).toHaveBeenCalledWith('dead-tmux-session');
    expect(mocks.listSessionPage).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({ error: 'tmux-session-not-found' });
  });
});
