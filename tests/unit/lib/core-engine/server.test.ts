import { describe, expect, it, vi } from 'vitest';
import { createCoreCommand } from '@/lib/core-engine/contracts';
import { createCoreEngineServer } from '@/lib/core-engine/server';

describe('core engine server', () => {
  it('keeps the supervisor context for workspace mutations', async () => {
    const supervisor = {
      started: false,
      async ensureStarted() {
        this.started = true;
      },
      health: vi.fn(async () => ({ ok: true })),
      listWorkspaces: vi.fn(async () => []),
      async createWorkspace(input: { name: string; defaultCwd: string }) {
        await this.ensureStarted();
        return { id: `ws-${input.name}`, rootPaneId: 'pane-root' };
      },
    };
    const server = createCoreEngineServer({ supervisor });

    await expect(server.handleCommand(createCoreCommand({
      type: 'core.workspace.create',
      payload: { name: 'main', defaultCwd: 'D:\\repo' },
    }))).resolves.toMatchObject({
      ok: true,
      payload: { id: 'ws-main', rootPaneId: 'pane-root' },
    });
    expect(supervisor.started).toBe(true);
  });

  it('bridges terminal attach, io, resize, and detach through the core protocol', async () => {
    const events: unknown[] = [];
    const supervisor = {
      health: vi.fn(async () => ({ ok: true })),
      listWorkspaces: vi.fn(async () => []),
      attachTerminal: vi.fn(async (input: { send: (data: string) => void; close: (code: number, reason: string) => void }) => {
        input.send('hello');
        input.close(1000, 'done');
        return { subscriberId: 'runtime-sub-a' };
      }),
      writeTerminal: vi.fn(async () => undefined),
      resizeTerminal: vi.fn(async () => undefined),
      detachTerminal: vi.fn(async () => undefined),
    };
    const server = createCoreEngineServer({
      supervisor,
      emit: (event) => events.push(event),
    });

    const attach = await server.handleCommand(createCoreCommand({
      id: 'cmd-attach',
      type: 'core.terminal.attach',
      payload: {
        connectionId: 'conn-a',
        sessionName: 'rtv2-ws-a-pane-a-tab-a',
        cols: 120,
        rows: 40,
      },
    }));

    expect(attach).toMatchObject({
      ok: true,
      payload: { subscriberId: 'conn-a' },
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: 'core.terminal.stdout',
        payload: expect.objectContaining({ connectionId: 'conn-a', data: 'hello' }),
      }),
      expect.objectContaining({
        type: 'core.terminal.closed',
        payload: expect.objectContaining({ connectionId: 'conn-a', code: 1000, reason: 'done' }),
      }),
    ]);

    const failedWrite = await server.handleCommand(createCoreCommand({
      id: 'cmd-write-after-close',
      type: 'core.terminal.write',
      payload: {
        connectionId: 'conn-a',
        sessionName: 'rtv2-ws-a-pane-a-tab-a',
        data: 'ls',
      },
    }));
    expect(failedWrite).toMatchObject({
      ok: false,
      error: { code: 'runtime-v2-terminal-subscriber-not-found', retryable: false },
    });
  });

  it('keeps terminal subscriber ownership on the core side', async () => {
    const supervisor = {
      health: vi.fn(async () => ({ ok: true })),
      listWorkspaces: vi.fn(async () => []),
      attachTerminal: vi.fn(async () => ({ subscriberId: 'runtime-sub-a' })),
      writeTerminal: vi.fn(async () => undefined),
      resizeTerminal: vi.fn(async () => undefined),
      detachTerminal: vi.fn(async () => undefined),
    };
    const server = createCoreEngineServer({ supervisor });

    await server.handleCommand(createCoreCommand({
      type: 'core.terminal.attach',
      payload: {
        connectionId: 'conn-a',
        sessionName: 'rtv2-ws-a-pane-a-tab-a',
        cols: 80,
        rows: 24,
      },
    }));
    await server.handleCommand(createCoreCommand({
      type: 'core.terminal.write',
      payload: {
        connectionId: 'conn-a',
        sessionName: 'rtv2-ws-a-pane-a-tab-a',
        data: 'pwd',
      },
    }));
    await server.handleCommand(createCoreCommand({
      type: 'core.terminal.resize',
      payload: {
        connectionId: 'conn-a',
        sessionName: 'rtv2-ws-a-pane-a-tab-a',
        cols: 100,
        rows: 30,
      },
    }));
    await server.handleCommand(createCoreCommand({
      type: 'core.terminal.detach',
      payload: {
        connectionId: 'conn-a',
        sessionName: 'rtv2-ws-a-pane-a-tab-a',
      },
    }));

    expect(supervisor.writeTerminal).toHaveBeenCalledWith({
      sessionName: 'rtv2-ws-a-pane-a-tab-a',
      subscriberId: 'runtime-sub-a',
      data: 'pwd',
    });
    expect(supervisor.resizeTerminal).toHaveBeenCalledWith({
      sessionName: 'rtv2-ws-a-pane-a-tab-a',
      subscriberId: 'runtime-sub-a',
      cols: 100,
      rows: 30,
    });
    expect(supervisor.detachTerminal).toHaveBeenCalledWith({
      sessionName: 'rtv2-ws-a-pane-a-tab-a',
      subscriberId: 'runtime-sub-a',
    });
  });

  it('routes timeline list sessions through the core protocol', async () => {
    const supervisor = {
      health: vi.fn(async () => ({ ok: true })),
      listWorkspaces: vi.fn(async () => []),
      listTimelineSessions: vi.fn(async () => ({ sessions: [], total: 0, hasMore: false })),
    };
    const server = createCoreEngineServer({ supervisor });

    const reply = await server.handleCommand(createCoreCommand({
      id: 'cmd-timeline',
      type: 'core.timeline.list-sessions',
      payload: {
        tmuxSession: 'pt-ws-pane-tab',
        panelType: 'codex',
        offset: 5,
        limit: 25,
      },
    }));

    expect(reply).toMatchObject({
      ok: true,
      payload: { sessions: [], total: 0, hasMore: false },
    });
    expect(supervisor.listTimelineSessions).toHaveBeenCalledWith({
      tmuxSession: 'pt-ws-pane-tab',
      panelType: 'codex',
      offset: 5,
      limit: 25,
    });
  });

  it('routes mutation and status commands through the core protocol', async () => {
    const supervisor = {
      health: vi.fn(async () => ({ ok: true })),
      listWorkspaces: vi.fn(async () => []),
      createTerminalTab: vi.fn(async () => ({
        id: 'tab-a',
        sessionName: 'rtv2-ws-a-pane-a-tab-a',
        name: '',
        order: 0,
        panelType: 'terminal',
        runtimeVersion: 2,
        lifecycleState: 'ready',
      })),
      restartTerminalTab: vi.fn(async () => ({
        id: 'tab-a',
        sessionName: 'rtv2-ws-a-pane-a-tab-a',
        name: '',
        order: 0,
        panelType: 'terminal',
        runtimeVersion: 2,
        lifecycleState: 'ready',
      })),
      deleteTerminalTab: vi.fn(async () => ({ deleted: true, workspaceId: 'ws-a', killedSession: null, failedKill: null })),
      deleteWorkspace: vi.fn(async () => ({ deleted: true, killedSessions: [], failedKills: [] })),
      readTimelineEntriesBefore: vi.fn(async () => ({ entries: [], startByteOffset: 0, hasMore: false })),
      getTimelineMessageCounts: vi.fn(async () => ({ userCount: 0, assistantCount: 0, toolCount: 0, toolBreakdown: {} })),
      sendStatusLiveHookEvent: vi.fn(async () => ({ accepted: true })),
      pollStatusLive: vi.fn(async () => ({ polled: true })),
      registerStatusLiveTab: vi.fn(async () => ({ accepted: true })),
      removeStatusLiveTab: vi.fn(async () => ({ accepted: true })),
      updateStatusLiveDeviceVisibility: vi.fn(async () => ({ accepted: true })),
    };
    const server = createCoreEngineServer({ supervisor });

    await expect(server.handleCommand(createCoreCommand({
      type: 'core.terminal-tab.create',
      payload: { workspaceId: 'ws-a', paneId: 'pane-a', cwd: 'D:\\repo' },
    }))).resolves.toMatchObject({ ok: true, payload: { id: 'tab-a' } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.terminal-tab.delete',
      payload: { tabId: 'tab-a' },
    }))).resolves.toMatchObject({ ok: true, payload: { deleted: true } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.terminal-tab.restart',
      payload: {
        workspaceId: 'ws-a',
        paneId: 'pane-a',
        tabId: 'tab-a',
        sessionName: 'rtv2-ws-a-pane-a-tab-a',
        cwd: 'D:\\repo',
      },
    }))).resolves.toMatchObject({ ok: true, payload: { id: 'tab-a', runtimeVersion: 2 } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.workspace.delete',
      payload: { workspaceId: 'ws-a' },
    }))).resolves.toMatchObject({ ok: true, payload: { deleted: true } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.timeline.read-entries-before',
      payload: { jsonlPath: 'D:\\sessions\\a.jsonl', beforeByte: 10, limit: 20, panelType: 'codex' },
    }))).resolves.toMatchObject({ ok: true, payload: { entries: [], startByteOffset: 0, hasMore: false } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.timeline.message-counts',
      payload: { jsonlPath: 'D:\\sessions\\a.jsonl' },
    }))).resolves.toMatchObject({ ok: true, payload: { userCount: 0 } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.status.live-hook-event',
      payload: { tmuxSession: 'pt-a', event: 'task_complete' },
    }))).resolves.toMatchObject({ ok: true, payload: { accepted: true } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.status.live-poll',
      payload: {},
    }))).resolves.toMatchObject({ ok: true, payload: { polled: true } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.status.live-register-tab',
      payload: { tabId: 'tab-a', entry: { tmuxSession: 'pt-a' } },
    }))).resolves.toMatchObject({ ok: true, payload: { accepted: true } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.status.live-remove-tab',
      payload: { tabId: 'tab-a' },
    }))).resolves.toMatchObject({ ok: true, payload: { accepted: true } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.status.live-device-visibility',
      payload: { deviceId: 'dev-a', visible: true },
    }))).resolves.toMatchObject({ ok: true, payload: { accepted: true } });

    expect(supervisor.createTerminalTab).toHaveBeenCalledWith({
      workspaceId: 'ws-a',
      paneId: 'pane-a',
      cwd: 'D:\\repo',
    });
    expect(supervisor.restartTerminalTab).toHaveBeenCalledWith({
      workspaceId: 'ws-a',
      paneId: 'pane-a',
      tabId: 'tab-a',
      sessionName: 'rtv2-ws-a-pane-a-tab-a',
      cwd: 'D:\\repo',
    });
    expect(supervisor.deleteTerminalTab).toHaveBeenCalledWith('tab-a');
    expect(supervisor.deleteWorkspace).toHaveBeenCalledWith('ws-a');
    expect(supervisor.updateStatusLiveDeviceVisibility).toHaveBeenCalledWith({ deviceId: 'dev-a', visible: true });
  });
});
