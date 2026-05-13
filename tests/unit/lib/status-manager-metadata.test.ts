import { describe, expect, it, vi } from 'vitest';
import { StatusManager } from '@/lib/status-manager';

describe('status manager metadata persistence', () => {
  it('uses an injected metadata persistence adapter for client events', () => {
    const persistTabCliStatus = vi.fn();
    const manager = new StatusManager({
      broadcast: vi.fn(),
      enableRateLimits: false,
      persistTabCliStatus,
    });

    manager.registerTab('tab-a', {
      cliState: 'ready-for-review',
      workspaceId: 'ws-a',
      tabName: 'codex',
      tmuxSession: 'rtv2-ws-a-pane-a-tab-a',
      dismissedAt: null,
      agentSessionId: 'agent-a',
    });

    expect(manager.dismissTab('tab-a')).toBe(true);
    expect(persistTabCliStatus).toHaveBeenCalledWith(expect.objectContaining({
      tmuxSession: 'rtv2-ws-a-pane-a-tab-a',
      cliState: 'idle',
      dismissedAt: expect.any(Number),
    }));

    manager.shutdown();
  });
});
