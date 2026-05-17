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
      renameWorkspace: vi.fn(async () => ({
        id: 'ws-a',
        name: 'Renamed',
        defaultCwd: 'D:\\repo',
        active: 1,
        groupId: null,
        orderIndex: 0,
        createdAt: '2026-05-17T00:00:00.000Z',
        updatedAt: '2026-05-17T00:00:01.000Z',
      })),
      createWorkspaceGroup: vi.fn(async () => ({ id: 'grp-a', name: 'Group A', collapsed: false })),
      renameWorkspaceGroup: vi.fn(async () => ({ id: 'grp-a', name: 'Group B', collapsed: false })),
      setWorkspaceGroupCollapsed: vi.fn(async () => ({ ok: true })),
      deleteWorkspaceGroup: vi.fn(async () => ({ deleted: true })),
      reorderWorkspaceGroups: vi.fn(async () => ({ ok: true })),
      setWorkspaceGroup: vi.fn(async () => ({ ok: true })),
      reorderWorkspaces: vi.fn(async () => ({ ok: true })),
      patchLayout: vi.fn(async () => ({ activePaneId: 'pane-a' })),
      patchPane: vi.fn(async () => ({ activePaneId: 'pane-a' })),
      splitPane: vi.fn(async () => ({ activePaneId: 'pane-new' })),
      closePane: vi.fn(async () => ({ layout: { activePaneId: 'pane-a' }, killedSessions: [], failedKills: [] })),
      reorderTabs: vi.fn(async () => ({ activePaneId: 'pane-a' })),
      moveTab: vi.fn(async () => ({ activePaneId: 'pane-b' })),
      patchTab: vi.fn(async () => ({ activePaneId: 'pane-a' })),
      patchTabStatusMetadata: vi.fn(async () => ({ updated: true, workspaceId: 'ws-a', tabId: 'tab-a' })),
      getTabStatusMetadata: vi.fn(async () => ({
        workspaceId: 'ws-a',
        tabId: 'tab-a',
        agentSessionId: null,
        agentJsonlPath: 'D:\\sessions\\agent.jsonl',
        agentSummary: null,
        lastUserMessage: null,
        cliState: null,
        dismissedAt: null,
      })),
      getTerminalSessionInfo: vi.fn(async () => ({ sessionName: 'rtv2-ws-a-pane-a-tab-a', exists: true, pid: 1234, cwd: 'D:\\repo' })),
      readTimelineEntriesBefore: vi.fn(async () => ({ entries: [], startByteOffset: 0, hasMore: false })),
      getTimelineMessageCounts: vi.fn(async () => ({ userCount: 0, assistantCount: 0, toolCount: 0, toolBreakdown: {} })),
      evaluateStatusSideEffects: vi.fn(async () => ({ sendNeedsInputNotification: true })),
      evaluateStatusClientEvent: vi.fn(async () => ({ accepted: true, nextState: 'busy' })),
      addStatusSessionHistoryEntry: vi.fn(async () => ({ inserted: true })),
      updateStatusSessionHistoryDismissedAt: vi.fn(async () => ({ entry: { id: 'history-a', tabId: 'tab-a' } })),
      sendStatusWebPush: vi.fn(async () => ({ sent: 1, failed: 0, removed: 0, skippedVisible: false })),
      sendStatusLiveHookEvent: vi.fn(async () => ({ accepted: true })),
      sendStatusLiveClientEvent: vi.fn(async () => ({ accepted: true })),
      notifyStatusLiveLastUserMessage: vi.fn(async () => ({ accepted: true })),
      requestStatusLiveSync: vi.fn(async () => ({ tabs: {} })),
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
      type: 'core.workspace.rename',
      payload: { workspaceId: 'ws-a', name: 'Renamed' },
    }))).resolves.toMatchObject({ ok: true, payload: { id: 'ws-a', name: 'Renamed' } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.workspace-group.create',
      payload: { name: 'Group A' },
    }))).resolves.toMatchObject({ ok: true, payload: { id: 'grp-a', name: 'Group A' } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.workspace-group.rename',
      payload: { groupId: 'grp-a', name: 'Group B' },
    }))).resolves.toMatchObject({ ok: true, payload: { id: 'grp-a', name: 'Group B' } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.workspace-group.set-collapsed',
      payload: { groupId: 'grp-a', collapsed: true },
    }))).resolves.toMatchObject({ ok: true, payload: { ok: true } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.workspace-group.delete',
      payload: { groupId: 'grp-a' },
    }))).resolves.toMatchObject({ ok: true, payload: { deleted: true } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.workspace-group.reorder',
      payload: { groupIds: ['grp-a'] },
    }))).resolves.toMatchObject({ ok: true, payload: { ok: true } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.workspace.set-group',
      payload: { workspaceId: 'ws-a', groupId: 'grp-a' },
    }))).resolves.toMatchObject({ ok: true, payload: { ok: true } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.workspace.reorder',
      payload: { items: [{ id: 'ws-b' }, { id: 'ws-a', groupId: 'grp-a' }] },
    }))).resolves.toMatchObject({ ok: true, payload: { ok: true } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.layout.patch',
      payload: { workspaceId: 'ws-a', activePaneId: 'pane-a' },
    }))).resolves.toMatchObject({ ok: true, payload: { activePaneId: 'pane-a' } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.layout.pane.patch',
      payload: { workspaceId: 'ws-a', paneId: 'pane-a', activeTabId: 'tab-a' },
    }))).resolves.toMatchObject({ ok: true, payload: { activePaneId: 'pane-a' } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.layout.pane.split',
      payload: { workspaceId: 'ws-a', sourcePaneId: 'pane-a', orientation: 'horizontal', cwd: 'D:\\repo' },
    }))).resolves.toMatchObject({ ok: true, payload: { activePaneId: 'pane-new' } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.layout.pane.close',
      payload: { workspaceId: 'ws-a', paneId: 'pane-b' },
    }))).resolves.toMatchObject({ ok: true, payload: { layout: { activePaneId: 'pane-a' } } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.layout.tabs.reorder',
      payload: { workspaceId: 'ws-a', paneId: 'pane-a', tabIds: ['tab-b', 'tab-a'] },
    }))).resolves.toMatchObject({ ok: true, payload: { activePaneId: 'pane-a' } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.layout.tab.move',
      payload: { workspaceId: 'ws-a', tabId: 'tab-a', fromPaneId: 'pane-a', toPaneId: 'pane-b', toIndex: 0 },
    }))).resolves.toMatchObject({ ok: true, payload: { activePaneId: 'pane-b' } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.layout.tab.patch',
      payload: { workspaceId: 'ws-a', paneId: 'pane-a', tabId: 'tab-a', patch: { name: 'patched' } },
    }))).resolves.toMatchObject({ ok: true, payload: { activePaneId: 'pane-a' } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.tab-status.patch',
      payload: { sessionName: 'rtv2-ws-a-pane-a-tab-a', agentJsonlPath: 'D:\\sessions\\agent.jsonl' },
    }))).resolves.toMatchObject({ ok: true, payload: { updated: true, workspaceId: 'ws-a', tabId: 'tab-a' } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.tab-status.get',
      payload: { sessionName: 'rtv2-ws-a-pane-a-tab-a' },
    }))).resolves.toMatchObject({ ok: true, payload: { agentJsonlPath: 'D:\\sessions\\agent.jsonl' } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.timeline.read-entries-before',
      payload: { jsonlPath: 'D:\\sessions\\a.jsonl', beforeByte: 10, limit: 20, panelType: 'codex' },
    }))).resolves.toMatchObject({ ok: true, payload: { entries: [], startByteOffset: 0, hasMore: false } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.timeline.message-counts',
      payload: { jsonlPath: 'D:\\sessions\\a.jsonl' },
    }))).resolves.toMatchObject({ ok: true, payload: { userCount: 0 } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.terminal-session.info',
      payload: { sessionName: 'rtv2-ws-a-pane-a-tab-a' },
    }))).resolves.toMatchObject({ ok: true, payload: { exists: true, pid: 1234 } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.status.evaluate-side-effects',
      payload: { currentState: 'busy', newState: 'needs-input' },
    }))).resolves.toMatchObject({ ok: true, payload: { sendNeedsInputNotification: true } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.status.evaluate-client-event',
      payload: { eventType: 'ack-notification', currentState: 'needs-input' },
    }))).resolves.toMatchObject({ ok: true, payload: { accepted: true, nextState: 'busy' } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.status.session-history.add',
      payload: { entry: { id: 'history-a', tabId: 'tab-a' } },
    }))).resolves.toMatchObject({ ok: true, payload: { inserted: true } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.status.session-history.update-dismissed-at',
      payload: { tabId: 'tab-a', dismissedAt: 123 },
    }))).resolves.toMatchObject({ ok: true, payload: { entry: { id: 'history-a' } } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.status.web-push.send',
      payload: { anyDeviceVisible: false, payload: { title: 'Task Complete', body: 'done', tabId: 'tab-a' } },
    }))).resolves.toMatchObject({ ok: true, payload: { sent: 1, failed: 0 } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.status.live-hook-event',
      payload: { tmuxSession: 'pt-a', event: 'task_complete' },
    }))).resolves.toMatchObject({ ok: true, payload: { accepted: true } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.status.live-client-event',
      payload: { eventType: 'ack-notification', tabId: 'tab-a', seq: 7 },
    }))).resolves.toMatchObject({ ok: true, payload: { accepted: true } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.status.live-notify-last-user-message',
      payload: { sessionName: 'rtv2-ws-a-pane-a-tab-a', message: 'hello' },
    }))).resolves.toMatchObject({ ok: true, payload: { accepted: true } });
    await expect(server.handleCommand(createCoreCommand({
      type: 'core.status.live-request-sync',
      payload: {},
    }))).resolves.toMatchObject({ ok: true, payload: { tabs: {} } });
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
    expect(supervisor.renameWorkspace).toHaveBeenCalledWith({ workspaceId: 'ws-a', name: 'Renamed' });
    expect(supervisor.createWorkspaceGroup).toHaveBeenCalledWith({ name: 'Group A' });
    expect(supervisor.renameWorkspaceGroup).toHaveBeenCalledWith({ groupId: 'grp-a', name: 'Group B' });
    expect(supervisor.setWorkspaceGroupCollapsed).toHaveBeenCalledWith({ groupId: 'grp-a', collapsed: true });
    expect(supervisor.deleteWorkspaceGroup).toHaveBeenCalledWith({ groupId: 'grp-a' });
    expect(supervisor.reorderWorkspaceGroups).toHaveBeenCalledWith({ groupIds: ['grp-a'] });
    expect(supervisor.setWorkspaceGroup).toHaveBeenCalledWith({ workspaceId: 'ws-a', groupId: 'grp-a' });
    expect(supervisor.reorderWorkspaces).toHaveBeenCalledWith({ items: [{ id: 'ws-b' }, { id: 'ws-a', groupId: 'grp-a' }] });
    expect(supervisor.patchLayout).toHaveBeenCalledWith({ workspaceId: 'ws-a', activePaneId: 'pane-a' });
    expect(supervisor.patchPane).toHaveBeenCalledWith({ workspaceId: 'ws-a', paneId: 'pane-a', activeTabId: 'tab-a' });
    expect(supervisor.splitPane).toHaveBeenCalledWith({
      workspaceId: 'ws-a',
      sourcePaneId: 'pane-a',
      orientation: 'horizontal',
      cwd: 'D:\\repo',
    });
    expect(supervisor.closePane).toHaveBeenCalledWith({ workspaceId: 'ws-a', paneId: 'pane-b' });
    expect(supervisor.reorderTabs).toHaveBeenCalledWith({ workspaceId: 'ws-a', paneId: 'pane-a', tabIds: ['tab-b', 'tab-a'] });
    expect(supervisor.moveTab).toHaveBeenCalledWith({ workspaceId: 'ws-a', tabId: 'tab-a', fromPaneId: 'pane-a', toPaneId: 'pane-b', toIndex: 0 });
    expect(supervisor.patchTab).toHaveBeenCalledWith({
      workspaceId: 'ws-a',
      paneId: 'pane-a',
      tabId: 'tab-a',
      patch: { name: 'patched' },
    });
    expect(supervisor.patchTabStatusMetadata).toHaveBeenCalledWith({
      sessionName: 'rtv2-ws-a-pane-a-tab-a',
      agentJsonlPath: 'D:\\sessions\\agent.jsonl',
    });
    expect(supervisor.getTabStatusMetadata).toHaveBeenCalledWith({ sessionName: 'rtv2-ws-a-pane-a-tab-a' });
    expect(supervisor.getTerminalSessionInfo).toHaveBeenCalledWith('rtv2-ws-a-pane-a-tab-a');
    expect(supervisor.evaluateStatusSideEffects).toHaveBeenCalledWith({ currentState: 'busy', newState: 'needs-input' });
    expect(supervisor.evaluateStatusClientEvent).toHaveBeenCalledWith({ eventType: 'ack-notification', currentState: 'needs-input' });
    expect(supervisor.addStatusSessionHistoryEntry).toHaveBeenCalledWith({ id: 'history-a', tabId: 'tab-a' });
    expect(supervisor.updateStatusSessionHistoryDismissedAt).toHaveBeenCalledWith({ tabId: 'tab-a', dismissedAt: 123 });
    expect(supervisor.sendStatusWebPush).toHaveBeenCalledWith({
      anyDeviceVisible: false,
      payload: { title: 'Task Complete', body: 'done', tabId: 'tab-a' },
    });
    expect(supervisor.sendStatusLiveClientEvent).toHaveBeenCalledWith({ eventType: 'ack-notification', tabId: 'tab-a', seq: 7 });
    expect(supervisor.notifyStatusLiveLastUserMessage).toHaveBeenCalledWith({
      sessionName: 'rtv2-ws-a-pane-a-tab-a',
      message: 'hello',
    });
    expect(supervisor.updateStatusLiveDeviceVisibility).toHaveBeenCalledWith({ deviceId: 'dev-a', visible: true });
  });

  it('bridges status live subscriptions through core events', async () => {
    const events: unknown[] = [];
    let liveEventHandler: ((event: unknown) => void) | undefined;
    const supervisor = {
      health: vi.fn(async () => ({ ok: true })),
      listWorkspaces: vi.fn(async () => []),
      subscribeStatusLive: vi.fn(async (input: { onEvent?: (event: unknown) => void }) => {
        liveEventHandler = input.onEvent;
        return { subscriberId: 'status-sub-a', subscribed: true, sync: { tabs: {} } };
      }),
      unsubscribeStatusLive: vi.fn(async (subscriberId: string) => ({ subscriberId, unsubscribed: true })),
    };
    const server = createCoreEngineServer({
      supervisor,
      emit: (event) => events.push(event),
    });

    await expect(server.handleCommand(createCoreCommand({
      type: 'core.status.live-subscribe',
      payload: {},
    }))).resolves.toMatchObject({
      ok: true,
      payload: { subscriberId: 'status-sub-a', subscribed: true, sync: { tabs: {} } },
    });

    liveEventHandler?.({
      kind: 'event',
      id: 'status-event-a',
      source: 'status',
      target: 'supervisor',
      sentAt: '2026-05-17T00:00:00.000Z',
      delivery: 'realtime',
      type: 'status.sync',
      payload: { tabs: {} },
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: 'core.status.live-event',
        payload: expect.objectContaining({
          subscriberId: 'status-sub-a',
          event: expect.objectContaining({ type: 'status.sync' }),
        }),
      }),
    ]);

    await expect(server.handleCommand(createCoreCommand({
      type: 'core.status.live-unsubscribe',
      payload: { subscriberId: 'status-sub-a' },
    }))).resolves.toMatchObject({
      ok: true,
      payload: { subscriberId: 'status-sub-a', unsubscribed: true },
    });
    expect(supervisor.unsubscribeStatusLive).toHaveBeenCalledWith('status-sub-a');
  });
});
