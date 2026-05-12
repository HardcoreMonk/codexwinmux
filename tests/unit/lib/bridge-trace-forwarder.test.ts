import { describe, expect, it, vi } from 'vitest';

import {
  buildBridgeTracePayload,
  createBridgeTraceForwarder,
} from '@/lib/bridge-trace-forwarder';
import type { IStatusUpdateMessage } from '@/types/status';

const statusUpdate = (overrides: Partial<IStatusUpdateMessage> = {}): IStatusUpdateMessage => ({
  type: 'status:update',
  tabId: 'tab-1',
  cliState: 'busy',
  workspaceId: 'workspace-1',
  tabName: 'codex',
  agentSessionId: 'session-1',
  currentAction: { toolName: 'Read', summary: 'Read file' },
  lastAssistantMessage: null,
  lastUserMessage: '작업 진행',
  ...overrides,
});

const workspaceState = {
  workspaces: [{
    id: 'workspace-1',
    name: 'codexwinmux',
    directories: ['/data/projects/codex-zone/codexmux'],
  }],
  groups: [],
  sidebarCollapsed: false,
  sidebarWidth: 240,
};

describe('bridge trace forwarder', () => {
  it('builds a sanitized codexmux status payload', () => {
    const payload = buildBridgeTracePayload(statusUpdate(), workspaceState, new Date('2026-05-05T03:34:56Z'));

    expect(payload).not.toBeNull();
    if (!payload) throw new Error('payload should not be null');
    expect(payload).toMatchObject({
      source: 'codexwinmux',
      event_type: 'status',
      project_dir: '/data/projects/codex-zone/codexmux',
      workspace_id: 'workspace-1',
      tab_id: 'tab-1',
      tab_name: 'codex',
      session_id: 'session-1',
      state: 'busy',
      current_action: 'Read file',
      last_assistant_message: null,
      last_user_message: '작업 진행',
      occurred_at: '2026-05-05T03:34:56.000Z',
    });
    expect(payload.event_id).toContain('tab-1');
  });

  it('does not call fetch when forwarding is disabled', async () => {
    const fetchImpl = vi.fn();
    const forwarder = createBridgeTraceForwarder({
      url: '',
      token: '',
      fetchImpl,
      now: () => new Date('2026-05-05T03:34:56Z'),
      getWorkspaces: async () => workspaceState,
    });

    await forwarder.forwardStatusUpdate(statusUpdate());

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts enabled updates with bearer auth and dedupes identical status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    const forwarder = createBridgeTraceForwarder({
      url: 'http://127.0.0.1:47381/v1/external-trace/events',
      token: 'secret',
      fetchImpl,
      now: () => new Date('2026-05-05T03:34:56Z'),
      getWorkspaces: async () => workspaceState,
    });

    await forwarder.forwardStatusUpdate(statusUpdate());
    await forwarder.forwardStatusUpdate(statusUpdate());
    await forwarder.forwardStatusUpdate(statusUpdate({
      currentAction: { toolName: 'Edit', summary: 'Edit status-manager.ts' },
    }));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://127.0.0.1:47381/v1/external-trace/events');
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret',
      },
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1].body))).toMatchObject({
      project_dir: '/data/projects/codex-zone/codexmux',
      current_action: 'Read file',
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1].body))).toMatchObject({
      current_action: 'Edit status-manager.ts',
    });
  });
});
