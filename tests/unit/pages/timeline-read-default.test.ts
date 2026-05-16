import type { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isAllowedJsonlPath: vi.fn(),
  provider: {
    readEntriesBefore: vi.fn(),
  },
  getProviderByPanelType: vi.fn(),
  coreRuntimeApi: {
    readTimelineEntriesBefore: vi.fn(),
    getTimelineMessageCounts: vi.fn(),
  },
}));

vi.mock('@/lib/path-validation', () => ({
  isAllowedJsonlPath: mocks.isAllowedJsonlPath,
}));

vi.mock('@/lib/providers', () => ({
  getProviderByPanelType: mocks.getProviderByPanelType,
}));

vi.mock('@/lib/core-engine/runtime-api', () => ({
  getCoreRuntimeApi: vi.fn(() => mocks.coreRuntimeApi),
}));

import entriesHandler from '@/pages/api/timeline/entries';
import messageCountsHandler from '@/pages/api/timeline/message-counts';

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

describe('timeline legacy read routes in runtime v2 default mode', () => {
  beforeEach(() => {
    restoreEnv();
    delete process.env.CODEXWINMUX_RUNTIME_V2;
    delete process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE;
    delete process.env.CODEXWINMUX_RUNTIME_V2;
    delete process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE;
    mocks.isAllowedJsonlPath.mockReset();
    mocks.provider.readEntriesBefore.mockReset();
    mocks.getProviderByPanelType.mockReset();
    mocks.coreRuntimeApi.readTimelineEntriesBefore.mockReset();
    mocks.coreRuntimeApi.getTimelineMessageCounts.mockReset();
    mocks.isAllowedJsonlPath.mockReturnValue(true);
    mocks.getProviderByPanelType.mockReturnValue(mocks.provider);
    mocks.coreRuntimeApi.readTimelineEntriesBefore.mockResolvedValue({
      entries: [],
      startByteOffset: 0,
      hasMore: false,
    });
    mocks.coreRuntimeApi.getTimelineMessageCounts.mockResolvedValue({
      userCount: 1,
      assistantCount: 2,
      toolCount: 3,
      toolBreakdown: { shell: 3 },
    });
  });

  afterEach(() => {
    restoreEnv();
  });

  it('routes entries-before through the Timeline Worker', async () => {
    delete process.env.CODEXWINMUX_RUNTIME_V2;
    delete process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE;
    process.env.CODEXWINMUX_RUNTIME_V2 = '1';
    process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE = 'default';
    const response = createResponse();

    await entriesHandler(createRequest({
      jsonlPath: '/tmp/session.jsonl',
      beforeByte: '100',
      limit: '300',
      panelType: 'codex',
    }), response.res);

    expect(response.statusCode).toBe(200);
    expect(mocks.provider.readEntriesBefore).not.toHaveBeenCalled();
    expect(mocks.coreRuntimeApi.readTimelineEntriesBefore).toHaveBeenCalledWith({
      jsonlPath: '/tmp/session.jsonl',
      beforeByte: 100,
      limit: 200,
      panelType: 'codex',
    });
  });

  it('routes message counts through the Timeline Worker', async () => {
    delete process.env.CODEXWINMUX_RUNTIME_V2;
    delete process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE;
    process.env.CODEXWINMUX_RUNTIME_V2 = '1';
    process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE = 'default';
    const response = createResponse();

    await messageCountsHandler(createRequest({
      jsonlPath: '/tmp/session.jsonl',
    }), response.res);

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ userCount: 1, assistantCount: 2, toolCount: 3 });
    expect(mocks.coreRuntimeApi.getTimelineMessageCounts).toHaveBeenCalledWith('/tmp/session.jsonl');
  });
});
