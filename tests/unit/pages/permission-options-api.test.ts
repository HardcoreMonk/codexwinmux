import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyApprovalPromptMetadata, parsePermissionOptions } from '@/lib/permission-prompt';

const mocks = vi.hoisted(() => ({
  hasSession: vi.fn(),
  capturePaneAtWidth: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@/lib/tmux', () => ({
  hasSession: mocks.hasSession,
}));

vi.mock('@/lib/capture-at-width', () => ({
  capturePaneAtWidth: mocks.capturePaneAtWidth,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    error: mocks.logError,
  }),
}));

import handler from '@/pages/api/tmux/permission-options';

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

const createRequest = (method = 'GET', query: Record<string, string> = { session: 'pt-session' }): NextApiRequest =>
  ({ method, query }) as unknown as NextApiRequest;

const commandApprovalCapture = [
  'Codex wants to run a command:',
  '  touch /tmp/approval-secret',
  '',
  '❯ 1. Yes',
  '  2. Yes, and don’t ask again for: touch /tmp/approval-secret',
  '  3. No',
].join('\n');

describe('/api/tmux/permission-options', () => {
  beforeEach(() => {
    mocks.hasSession.mockReset();
    mocks.capturePaneAtWidth.mockReset();
    mocks.logError.mockReset();
    mocks.hasSession.mockResolvedValue(true);
    mocks.capturePaneAtWidth.mockResolvedValue(commandApprovalCapture);
  });

  it('returns parser options, focused index, and sanitized metadata for permission prompts', async () => {
    const response = createResponse();
    const parsed = parsePermissionOptions(commandApprovalCapture);

    await handler(createRequest(), response.res);

    expect(response.statusCode).toBe(200);
    expect(mocks.hasSession).toHaveBeenCalledWith('pt-session');
    expect(mocks.capturePaneAtWidth).toHaveBeenCalledWith('pt-session', 120, 50);
    expect(response.body).toMatchObject({
      options: parsed.options,
      focusedIndex: parsed.focusedIndex,
      metadata: parsed.metadata,
    });
    expect(JSON.stringify((response.body as { metadata: unknown }).metadata)).not.toContain('/tmp/approval-secret');
    expect((response.body as { options: string[] }).options.join('\n')).toContain('/tmp/approval-secret');
  });

  it('returns empty options and empty approval metadata when capture is empty', async () => {
    mocks.capturePaneAtWidth.mockResolvedValue('');
    const response = createResponse();

    await handler(createRequest(), response.res);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      options: [],
      focusedIndex: 0,
      captureEmpty: true,
      metadata: createEmptyApprovalPromptMetadata(),
    });
  });

  it('rejects non-GET methods with Allow GET', async () => {
    const response = createResponse();

    await handler(createRequest('POST'), response.res);

    expect(response.statusCode).toBe(405);
    expect(response.headers.Allow).toBe('GET');
    expect(response.body).toEqual({ error: 'Method not allowed' });
  });

  it('returns session not found when the tmux session is missing', async () => {
    mocks.hasSession.mockResolvedValue(false);
    const response = createResponse();

    await handler(createRequest(), response.res);

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({ error: 'Session not found' });
    expect(mocks.capturePaneAtWidth).not.toHaveBeenCalled();
  });

  it('returns terminal fallback guidance without leaking terminal content when capture rejects', async () => {
    mocks.capturePaneAtWidth.mockRejectedValue(new Error(`capture failed: ${commandApprovalCapture}`));
    const response = createResponse();

    await handler(createRequest(), response.res);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      options: [],
      focusedIndex: 0,
      captureEmpty: false,
      captureFailed: true,
      fallbackReason: 'capture-failed',
      metadata: createEmptyApprovalPromptMetadata(),
    });
    expect(JSON.stringify(response.body)).not.toContain('/tmp/approval-secret');
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain('/tmp/approval-secret');
  });
});
