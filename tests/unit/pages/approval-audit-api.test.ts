import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendApprovalAuditEvent: vi.fn(),
  readApprovalAuditEvents: vi.fn(),
}));

vi.mock('@/lib/approval-audit-store', () => ({
  appendApprovalAuditEvent: mocks.appendApprovalAuditEvent,
  readApprovalAuditEvents: mocks.readApprovalAuditEvents,
}));

import handler from '@/pages/api/approval/audit';

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

const createRequest = (method: string, body?: unknown, query: Record<string, string> = {}): NextApiRequest =>
  ({ method, body, query }) as unknown as NextApiRequest;

describe('/api/approval/audit', () => {
  beforeEach(() => {
    mocks.appendApprovalAuditEvent.mockReset();
    mocks.readApprovalAuditEvents.mockReset();
    mocks.appendApprovalAuditEvent.mockResolvedValue({
      id: 'audit-1',
      createdAt: '2026-05-05T00:00:00.000Z',
      eventType: 'selection-sent',
      workspaceId: 'ws-1',
      tabId: 'tab-1',
    });
    mocks.readApprovalAuditEvents.mockResolvedValue([]);
  });

  it('appends only sanitized approval audit fields', async () => {
    const response = createResponse();

    await handler(createRequest('POST', {
      eventType: 'selection-sent',
      workspaceId: 'ws-1',
      tabId: 'tab-1',
      promptType: 'command',
      approvalKind: 'allow',
      riskLevel: 'high',
      selectedOptionIndex: 1,
      optionCount: 2,
      commandPreview: 'rm -rf /secret',
      sessionName: 'pt-secret',
    }), response.res);

    expect(response.statusCode).toBe(200);
    expect(mocks.appendApprovalAuditEvent).toHaveBeenCalledWith({
      eventType: 'selection-sent',
      workspaceId: 'ws-1',
      tabId: 'tab-1',
      promptType: 'command',
      approvalKind: 'allow',
      riskLevel: 'high',
      selectedOptionIndex: 1,
      optionCount: 2,
      fallbackReason: undefined,
    });
    expect(JSON.stringify(mocks.appendApprovalAuditEvent.mock.calls)).not.toContain('/secret');
    expect(JSON.stringify(mocks.appendApprovalAuditEvent.mock.calls)).not.toContain('pt-secret');
  });

  it('reads audit events with a bounded limit', async () => {
    const response = createResponse();

    await handler(createRequest('GET', undefined, { limit: '1000' }), response.res);

    expect(response.statusCode).toBe(200);
    expect(mocks.readApprovalAuditEvents).toHaveBeenCalledWith({ limit: 200 });
    expect(response.body).toEqual({ events: [] });
  });

  it('accepts capture-failed fallback reason without raw terminal details', async () => {
    const response = createResponse();

    await handler(createRequest('POST', {
      eventType: 'fallback',
      workspaceId: 'ws-1',
      tabId: 'tab-1',
      fallbackReason: 'capture-failed',
      raw: 'terminal output with /secret',
    }), response.res);

    expect(response.statusCode).toBe(200);
    expect(mocks.appendApprovalAuditEvent).toHaveBeenCalledWith({
      eventType: 'fallback',
      workspaceId: 'ws-1',
      tabId: 'tab-1',
      promptType: undefined,
      approvalKind: undefined,
      riskLevel: undefined,
      selectedOptionIndex: undefined,
      optionCount: undefined,
      fallbackReason: 'capture-failed',
    });
    expect(JSON.stringify(mocks.appendApprovalAuditEvent.mock.calls)).not.toContain('/secret');
  });
});
