import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openRuntimeDatabase } from '@/lib/runtime/storage/schema';
import type { TRuntimeDatabase } from '@/lib/runtime/storage/schema';
import { createStorageRepository } from '@/lib/runtime/storage/repository';

describe('runtime storage repository', () => {
  let dir: string;
  const dbs: TRuntimeDatabase[] = [];

  const openTestDatabase = (...args: Parameters<typeof openRuntimeDatabase>): TRuntimeDatabase => {
    const db = openRuntimeDatabase(...args);
    dbs.push(db);
    return db;
  };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-runtime-db-'));
  });

  afterEach(async () => {
    for (const db of dbs.splice(0)) {
      try {
        db.close();
      } catch {}
    }
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('creates pending terminal tab intents, assigns stable order, finalizes active tab, and projects only ready tabs', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);

    const workspace = repo.createWorkspace({ name: 'Runtime', defaultCwd: dir });
    const firstPending = repo.createPendingTerminalTab({
      id: 'tab-runtime-a',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-runtime-a`,
      cwd: dir,
    });
    const secondPending = repo.createPendingTerminalTab({
      id: 'tab-runtime-b',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-runtime-b`,
      cwd: dir,
    });

    const pendingLayout = repo.getWorkspaceLayout(workspace.id);
    if (pendingLayout?.root.type === 'pane') {
      expect(pendingLayout.root.tabs).toEqual([]);
    }

    const firstTab = repo.finalizeTerminalTab({ id: firstPending.id });
    const secondTab = repo.finalizeTerminalTab({ id: secondPending.id });
    const layout = repo.getWorkspaceLayout(workspace.id);

    expect(firstTab.order).toBe(0);
    expect(firstTab.runtimeVersion).toBe(2);
    expect(secondTab.order).toBe(1);
    expect(secondTab.runtimeVersion).toBe(2);
    expect(secondTab.lifecycleState).toBe('ready');
    expect(layout?.activePaneId).toBe(workspace.rootPaneId);
    expect(layout?.root.type).toBe('pane');
    if (layout?.root.type === 'pane') {
      expect(layout.root.activeTabId).toBe(secondTab.id);
      expect(layout.root.tabs.map((tab) => ({ id: tab.id, order: tab.order }))).toEqual([
        { id: firstTab.id, order: 0 },
        { id: secondTab.id, order: 1 },
      ]);
      expect(layout.root.tabs.every((tab) => tab.runtimeVersion === 2)).toBe(true);
      expect(layout.root.tabs[0].sessionName).toMatch(/^rtv2-ws-/);
    }

    expect(() => repo.finalizeTerminalTab({ id: 'tab-missing' })).toThrow(expect.objectContaining({
      code: 'runtime-v2-pending-tab-not-found',
      retryable: false,
    }));
    expect(() => repo.finalizeTerminalTab({ id: secondTab.id })).toThrow(expect.objectContaining({
      code: 'runtime-v2-pending-tab-not-found',
      retryable: false,
    }));
  });

  it('rejects terminal tabs for panes outside the supplied workspace', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);

    const workspace = repo.createWorkspace({ name: 'Runtime', defaultCwd: dir });
    const otherWorkspace = repo.createWorkspace({ name: 'Other', defaultCwd: dir });

    expect(() => repo.createPendingTerminalTab({
      id: 'tab-runtime',
      workspaceId: workspace.id,
      paneId: otherWorkspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${otherWorkspace.rootPaneId}-tab-runtime`,
      cwd: dir,
    })).toThrow(expect.objectContaining({
      code: 'runtime-v2-pane-workspace-mismatch',
      retryable: false,
    }));

    expect(repo.listPendingTerminalTabs()).toEqual([]);
  });

  it('ensures legacy workspace and pane ids before creating v2 terminal tabs', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);

    expect(repo.ensureWorkspacePane({
      workspaceId: 'ws-legacy',
      paneId: 'pane-legacy',
      name: 'Legacy',
      defaultCwd: dir,
    })).toEqual({ workspaceId: 'ws-legacy', paneId: 'pane-legacy' });

    const pending = repo.createPendingTerminalTab({
      id: 'tab-runtime',
      workspaceId: 'ws-legacy',
      paneId: 'pane-legacy',
      sessionName: 'rtv2-ws-legacy-pane-legacy-tab-runtime',
      cwd: dir,
    });
    const tab = repo.finalizeTerminalTab({ id: pending.id });
    const layout = repo.getWorkspaceLayout('ws-legacy');

    expect(tab).toMatchObject({ id: 'tab-runtime', runtimeVersion: 2 });
    expect(layout?.root.type).toBe('pane');
    if (layout?.root.type === 'pane') {
      expect(layout.root.id).toBe('pane-legacy');
      expect(layout.root.tabs).toEqual([expect.objectContaining({ id: 'tab-runtime', runtimeVersion: 2 })]);
    }
  });

  it('records mutation events', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);

    repo.createWorkspace({ name: 'Runtime', defaultCwd: dir });

    expect(repo.listMutationEvents()).toEqual([
      expect.objectContaining({ entityType: 'workspace', eventType: 'workspace.created' }),
    ]);
  });

  it('lists persisted workspaces for reload smoke', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);

    const workspace = repo.createWorkspace({ name: 'Runtime', defaultCwd: dir });

    expect(repo.listWorkspaces()).toEqual([
      expect.objectContaining({ id: workspace.id, name: 'Runtime', defaultCwd: dir }),
    ]);
  });

  it('renames workspaces in SQLite and records a mutation event', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);

    const workspace = repo.createWorkspace({ name: 'Runtime', defaultCwd: dir });

    const renamed = repo.renameWorkspace({ workspaceId: workspace.id, name: '  Core owner  ' });

    expect(renamed).toEqual(expect.objectContaining({
      id: workspace.id,
      name: 'Core owner',
      defaultCwd: dir,
    }));
    expect(repo.listWorkspaces()).toEqual([
      expect.objectContaining({ id: workspace.id, name: 'Core owner' }),
    ]);
    expect(repo.renameWorkspace({ workspaceId: 'ws-missing', name: 'Missing' })).toBeNull();
    expect(repo.listMutationEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'workspace', entityId: workspace.id, eventType: 'workspace.renamed' }),
    ]));
  });

  it('owns workspace groups and workspace ordering in SQLite', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);

    const first = repo.createWorkspace({ name: 'First', defaultCwd: dir });
    const second = repo.createWorkspace({ name: 'Second', defaultCwd: dir });
    const group = repo.createWorkspaceGroup({ name: '  Core group  ' });
    const otherGroup = repo.createWorkspaceGroup({ name: 'Other group' });

    expect(group).toEqual(expect.objectContaining({ id: expect.stringMatching(/^grp-/), name: 'Core group', collapsed: false }));
    expect(repo.setWorkspaceGroup({ workspaceId: first.id, groupId: group.id })).toBe(true);
    expect(repo.reorderWorkspaces({
      items: [
        { id: second.id, groupId: otherGroup.id },
        { id: first.id, groupId: group.id },
      ],
    })).toBe(true);
    expect(repo.reorderWorkspaceGroups({ groupIds: [otherGroup.id, group.id] })).toBe(true);

    let snapshot = repo.getWorkspaceSnapshot();
    expect(snapshot.groups?.map((item) => item.id)).toEqual([otherGroup.id, group.id]);
    expect(snapshot.workspaces.map((item) => ({ id: item.id, groupId: item.groupId }))).toEqual([
      { id: second.id, groupId: otherGroup.id },
      { id: first.id, groupId: group.id },
    ]);

    expect(repo.renameWorkspaceGroup({ groupId: group.id, name: 'Renamed group' })).toEqual({
      id: group.id,
      name: 'Renamed group',
      collapsed: false,
    });
    expect(repo.setWorkspaceGroupCollapsed({ groupId: group.id, collapsed: true })).toBe(true);
    expect(repo.deleteWorkspaceGroup({ groupId: otherGroup.id })).toBe(true);

    snapshot = repo.getWorkspaceSnapshot();
    expect(snapshot.groups).toEqual([
      { id: group.id, name: 'Renamed group', collapsed: true },
    ]);
    expect(snapshot.workspaces.find((item) => item.id === second.id)?.groupId).toBeUndefined();
    expect(repo.reorderWorkspaces({ items: [{ id: first.id }] })).toBe(false);
    expect(repo.reorderWorkspaceGroups({ groupIds: [group.id, 'grp-missing'] })).toBe(false);
  });

  it('owns layout pane split, tab reorder, tab move, pane patch, tab patch, and pane close in SQLite', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);

    const workspace = repo.createWorkspace({ name: 'Runtime', defaultCwd: dir });
    const firstPending = repo.createPendingTerminalTab({
      id: 'tab-first',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-first`,
      cwd: dir,
    });
    repo.finalizeTerminalTab({ id: firstPending.id });

    const split = repo.splitPane({
      workspaceId: workspace.id,
      sourcePaneId: workspace.rootPaneId,
      newPaneId: 'pane-second',
      orientation: 'horizontal',
      tab: {
        id: 'tab-second',
        sessionName: `rtv2-${workspace.id}-pane-second-tab-second`,
        name: 'Second',
        cwd: dir,
        panelType: 'terminal',
      },
    });

    expect(split?.activePaneId).toBe('pane-second');
    expect(split?.root.type).toBe('split');

    const thirdPending = repo.createPendingTerminalTab({
      id: 'tab-third',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-third`,
      cwd: dir,
    });
    repo.finalizeTerminalTab({ id: thirdPending.id });

    expect(repo.reorderTabs({ workspaceId: workspace.id, paneId: workspace.rootPaneId, tabIds: ['tab-third', 'tab-first'] })?.root)
      .toEqual(expect.any(Object));
    expect(repo.moveTab({
      workspaceId: workspace.id,
      tabId: 'tab-third',
      fromPaneId: workspace.rootPaneId,
      toPaneId: 'pane-second',
      toIndex: 1,
    })?.activePaneId).toBe('pane-second');
    expect(repo.patchPane({ workspaceId: workspace.id, paneId: 'pane-second', activeTabId: 'tab-third' })?.root)
      .toEqual(expect.any(Object));
    expect(repo.patchTab({
      workspaceId: workspace.id,
      paneId: 'pane-second',
      tabId: 'tab-third',
      patch: {
        name: 'Patched',
        title: 'Patched title',
        cwd: `${dir}\\nested`,
        lastCommand: 'codex',
        terminalRatio: 42,
        terminalCollapsed: true,
      },
    })?.root).toEqual(expect.any(Object));
    expect(repo.patchLayout({ workspaceId: workspace.id, activePaneId: workspace.rootPaneId, ratioUpdate: { path: [], ratio: 67 } })?.activePaneId)
      .toBe(workspace.rootPaneId);

    const layout = repo.getWorkspaceLayout(workspace.id);
    expect(layout?.root.type).toBe('split');
    if (layout?.root.type === 'split') {
      expect(layout.root.ratio).toBe(67);
      const left = layout.root.children[0];
      const right = layout.root.children[1];
      expect(left.type).toBe('pane');
      expect(right.type).toBe('pane');
      if (left.type === 'pane' && right.type === 'pane') {
        expect(left.tabs.map((tab) => ({ id: tab.id, order: tab.order }))).toEqual([{ id: 'tab-first', order: 0 }]);
        expect(right.activeTabId).toBe('tab-third');
        expect(right.tabs.map((tab) => ({ id: tab.id, order: tab.order }))).toEqual([
          { id: 'tab-second', order: 0 },
          { id: 'tab-third', order: 1 },
        ]);
        expect(right.tabs[1]).toEqual(expect.objectContaining({
          name: 'Patched',
          title: 'Patched title',
          cwd: `${dir}\\nested`,
          lastCommand: 'codex',
          terminalRatio: 42,
          terminalCollapsed: true,
        }));
      }
    }

    const closed = repo.closePane({ workspaceId: workspace.id, paneId: 'pane-second' });
    expect(closed).toEqual({
      layout: expect.objectContaining({ activePaneId: workspace.rootPaneId }),
      sessions: [
        { sessionName: `rtv2-${workspace.id}-pane-second-tab-second` },
        { sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-third` },
      ],
    });
    expect(repo.getWorkspaceLayout(workspace.id)?.root.type).toBe('pane');
  });

  it('updates tab status and timeline metadata by session name in SQLite', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);
    const workspace = repo.createWorkspace({ name: 'Runtime', defaultCwd: dir });
    const sessionName = `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-status`;
    repo.createPendingTerminalTab({
      id: 'tab-status',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName,
      cwd: dir,
    });
    repo.finalizeTerminalTab({ id: 'tab-status' });

    expect(repo.patchTabStatusMetadata({
      sessionName,
      agentSessionId: 'agent-a',
      agentJsonlPath: '/tmp/agent-a.jsonl',
      agentSummary: 'summary',
      lastUserMessage: '작업 시작',
      cliState: 'needs-input',
      dismissedAt: 123,
    })).toEqual({ updated: true, workspaceId: workspace.id, tabId: 'tab-status' });

    expect(repo.getTabStatusMetadataBySession(sessionName)).toEqual(expect.objectContaining({
      workspaceId: workspace.id,
      tabId: 'tab-status',
      agentSessionId: 'agent-a',
      agentJsonlPath: '/tmp/agent-a.jsonl',
      agentSummary: 'summary',
      lastUserMessage: '작업 시작',
      cliState: 'needs-input',
      dismissedAt: 123,
    }));

    const layout = repo.getWorkspaceLayout(workspace.id);
    expect(layout?.root.type).toBe('pane');
    if (layout?.root.type === 'pane') {
      expect(layout.root.tabs[0]).toEqual(expect.objectContaining({
        agentSessionId: 'agent-a',
        agentJsonlPath: '/tmp/agent-a.jsonl',
        agentSummary: 'summary',
        lastUserMessage: '작업 시작',
        cliState: 'needs-input',
        dismissedAt: 123,
      }));
    }
  });

  it('marks pending terminal tabs failed for reconciliation', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);

    const workspace = repo.createWorkspace({ name: 'Runtime', defaultCwd: dir });
    const pending = repo.createPendingTerminalTab({
      id: 'tab-runtime',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-runtime`,
      cwd: dir,
    });

    expect(repo.listPendingTerminalTabs()).toEqual([
      expect.objectContaining({ id: pending.id, lifecycleState: 'pending_terminal' }),
    ]);

    repo.failPendingTerminalTab({ id: pending.id, reason: 'terminal create failed' });

    expect(repo.listPendingTerminalTabs()).toEqual([]);

    expect(() => repo.failPendingTerminalTab({ id: 'tab-missing', reason: 'missing' })).toThrow(expect.objectContaining({
      code: 'runtime-v2-pending-tab-not-found',
      retryable: false,
    }));

    const finalized = repo.createPendingTerminalTab({
      id: 'tab-finalized',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-finalized`,
      cwd: dir,
    });
    repo.finalizeTerminalTab({ id: finalized.id });
    expect(() => repo.failPendingTerminalTab({ id: finalized.id, reason: 'already finalized' })).toThrow(expect.objectContaining({
      code: 'runtime-v2-pending-tab-not-found',
      retryable: false,
    }));
  });

  it('deletes a workspace and returns cleanup sessions from the delete transaction', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);

    const workspace = repo.createWorkspace({ name: 'Runtime', defaultCwd: dir });
    const readyPending = repo.createPendingTerminalTab({
      id: 'tab-ready',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-ready`,
      cwd: dir,
    });
    const stillPending = repo.createPendingTerminalTab({
      id: 'tab-pending',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-pending`,
      cwd: dir,
    });
    const failedPending = repo.createPendingTerminalTab({
      id: 'tab-failed',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-failed`,
      cwd: dir,
    });
    repo.finalizeTerminalTab({ id: readyPending.id });
    repo.failPendingTerminalTab({ id: failedPending.id, reason: 'already reconciled' });

    expect(repo.deleteWorkspace({ workspaceId: workspace.id })).toEqual({
      deleted: true,
      sessions: [
        { sessionName: readyPending.sessionName },
        { sessionName: stillPending.sessionName },
      ],
    });
    expect(repo.listWorkspaces()).toEqual([]);
    expect(repo.getWorkspaceLayout(workspace.id)).toBeNull();
    expect(repo.listMutationEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'workspace', entityId: workspace.id, eventType: 'workspace.deleted' }),
    ]));

    const eventCount = repo.listMutationEvents().length;
    db.pragma('foreign_keys = OFF');
    db.prepare(`
      insert into tabs (id, workspace_id, pane_id, session_name, panel_type, name, lifecycle_state, order_index, created_at, updated_at)
      values (?, ?, ?, ?, 'terminal', '', 'ready', 0, ?, ?)
    `).run(
      'tab-orphan',
      'ws-missing',
      'pane-missing',
      'rtv2-ws-missing-pane-missing-tab-orphan',
      new Date().toISOString(),
      new Date().toISOString(),
    );
    db.pragma('foreign_keys = ON');
    expect(repo.deleteWorkspace({ workspaceId: 'ws-missing' })).toEqual({ deleted: false, sessions: [] });
    expect(repo.listMutationEvents()).toHaveLength(eventCount);
  });

  it('deletes terminal tabs, returns cleanup sessions, reorders tabs, and updates active tab', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);
    const workspace = repo.createWorkspace({ name: 'Runtime', defaultCwd: dir });
    const firstPending = repo.createPendingTerminalTab({
      id: 'tab-first',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-first`,
      cwd: dir,
    });
    const secondPending = repo.createPendingTerminalTab({
      id: 'tab-second',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-second`,
      cwd: dir,
    });
    const thirdPending = repo.createPendingTerminalTab({
      id: 'tab-third',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-third`,
      cwd: dir,
    });
    repo.finalizeTerminalTab({ id: firstPending.id });
    repo.finalizeTerminalTab({ id: secondPending.id });
    repo.finalizeTerminalTab({ id: thirdPending.id });

    expect(repo.deleteTerminalTab({ id: secondPending.id })).toEqual({
      deleted: true,
      workspaceId: workspace.id,
      session: { sessionName: secondPending.sessionName },
    });

    const layout = repo.getWorkspaceLayout(workspace.id);
    expect(layout?.root.type).toBe('pane');
    if (layout?.root.type === 'pane') {
      expect(layout.root.activeTabId).toBe(firstPending.id);
      expect(layout.root.tabs.map((tab) => ({ id: tab.id, order: tab.order }))).toEqual([
        { id: firstPending.id, order: 0 },
        { id: thirdPending.id, order: 1 },
      ]);
    }
    expect(repo.getReadyTerminalTabBySession(secondPending.sessionName)).toBeNull();
    expect(repo.listMutationEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'tab', entityId: secondPending.id, eventType: 'tab.deleted' }),
    ]));
  });

  it('deletes failed or missing terminal tabs without cleanup sessions', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);
    const workspace = repo.createWorkspace({ name: 'Runtime', defaultCwd: dir });
    const failedPending = repo.createPendingTerminalTab({
      id: 'tab-failed',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-failed`,
      cwd: dir,
    });
    repo.failPendingTerminalTab({ id: failedPending.id, reason: 'terminal create failed' });

    expect(repo.deleteTerminalTab({ id: failedPending.id })).toEqual({
      deleted: true,
      workspaceId: workspace.id,
      session: null,
    });
    expect(repo.deleteTerminalTab({ id: 'tab-missing' })).toEqual({
      deleted: false,
      session: null,
    });
  });

  it('finds only finalized ready terminal tabs by session name', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);
    const workspace = repo.createWorkspace({ name: 'Runtime', defaultCwd: dir });
    const pending = repo.createPendingTerminalTab({
      id: 'tab-runtime',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-runtime`,
      cwd: dir,
    });

    expect(repo.getReadyTerminalTabBySession(pending.sessionName)).toBeNull();
    repo.finalizeTerminalTab({ id: pending.id });
    expect(repo.getReadyTerminalTabBySession(pending.sessionName)).toEqual(
      expect.objectContaining({ id: pending.id, lifecycleState: 'ready', runtimeVersion: 2 }),
    );
    expect(repo.getReadyTerminalTabBySession('rtv2-ws-missing-pane-missing-tab-missing')).toBeNull();
  });

  it('lists ready terminal tabs and marks stale ready terminal tabs failed', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);
    const workspace = repo.createWorkspace({ name: 'Runtime', defaultCwd: dir });
    const readyPending = repo.createPendingTerminalTab({
      id: 'tab-ready',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-ready`,
      cwd: dir,
    });
    const stillPending = repo.createPendingTerminalTab({
      id: 'tab-pending',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-pending`,
      cwd: dir,
    });
    const failedPending = repo.createPendingTerminalTab({
      id: 'tab-failed',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-failed`,
      cwd: dir,
    });
    const ready = repo.finalizeTerminalTab({ id: readyPending.id });
    repo.failPendingTerminalTab({ id: failedPending.id, reason: 'terminal create failed' });

    expect(repo.listReadyTerminalTabs()).toEqual([
      expect.objectContaining({ id: ready.id, lifecycleState: 'ready', runtimeVersion: 2 }),
    ]);

    repo.failReadyTerminalTab({
      id: ready.id,
      reason: 'startup reconciliation: tmux session missing',
    });

    expect(repo.listReadyTerminalTabs()).toEqual([]);
    const layout = repo.getWorkspaceLayout(workspace.id);
    if (layout?.root.type === 'pane') {
      expect(layout.root.tabs).toEqual([]);
    }
    expect(repo.listMutationEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityType: 'tab',
        entityId: ready.id,
        eventType: 'tab.ready-reconciliation-failed',
      }),
    ]));

    for (const id of [ready.id, stillPending.id, failedPending.id, 'tab-missing']) {
      expect(() => repo.failReadyTerminalTab({ id, reason: 'not ready' })).toThrow(expect.objectContaining({
        code: 'runtime-v2-ready-tab-not-found',
        retryable: false,
      }));
    }
  });

  it('reports a clear error when optional better-sqlite3 is unavailable', () => {
    expect(() => openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'), {
      loadDatabase: () => {
        throw new Error('Cannot find module better-sqlite3');
      },
    })).toThrow(expect.objectContaining({
      code: 'runtime-v2-sqlite-unavailable',
    }));
  });

  it('records schema migration v1 and reopens idempotently', () => {
    const dbPath = path.join(dir, 'runtime-v2', 'state.db');
    const db = openTestDatabase(dbPath);

    expect(db.prepare(`select version from schema_migrations order by version`).all()).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
    ]);
    db.close();

    const reopened = openTestDatabase(dbPath);
    expect(reopened.prepare(`select version, count(*) as count from schema_migrations group by version`).all()).toEqual([
      { version: 1, count: 1 },
      { version: 2, count: 1 },
      { version: 3, count: 1 },
    ]);
  });

  it('applies runtime sqlite pragmas', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));

    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(String(db.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal');
    expect(Number(db.pragma('synchronous', { simple: true }))).toBe(1);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('rejects databases from a newer runtime schema version', () => {
    const dbPath = path.join(dir, 'runtime-v2', 'state.db');
    const db = openTestDatabase(dbPath);
    db.prepare(`insert into schema_migrations(version, applied_at) values(?, ?)`).run(99, new Date().toISOString());
    db.close();

    expect(() => openTestDatabase(dbPath)).toThrow(expect.objectContaining({
      code: 'runtime-v2-schema-too-new',
      retryable: false,
    }));
  });

  it('creates the full foundation schema', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const tables = db.prepare(`
      select name from sqlite_master where type = 'table' order by name asc
    `).all() as Array<{ name: string }>;
    const indexes = db.prepare(`
      select name from sqlite_master where type = 'index' and name not like 'sqlite_autoindex_%' order by name asc
    `).all() as Array<{ name: string }>;

    expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining([
      'schema_migrations',
      'workspaces',
      'workspace_groups',
      'panes',
      'tabs',
      'tab_status',
      'agent_sessions',
      'remote_sources',
      'mutation_events',
      'status_events',
    ]));
    expect(indexes.map((i) => i.name)).toEqual(expect.arrayContaining([
      'idx_runtime_agent_sessions_provider_source',
      'idx_runtime_mutation_events_created_at',
      'idx_runtime_panes_workspace_parent_position',
      'idx_runtime_remote_sources_label_host',
      'idx_runtime_tabs_lifecycle_state_created_at',
      'idx_runtime_status_events_tab_created_at',
      'idx_runtime_tabs_workspace_pane_order',
      'idx_runtime_workspaces_group_order',
    ]));

    const workspaceFks = db.prepare(`pragma foreign_key_list(workspaces)`).all() as Array<{ table: string; from: string }>;
    const paneFks = db.prepare(`pragma foreign_key_list(panes)`).all() as Array<{ table: string; from: string }>;
    const tabStatusFks = db.prepare(`pragma foreign_key_list(tab_status)`).all() as Array<{ table: string; from: string }>;
    const statusEventFks = db.prepare(`pragma foreign_key_list(status_events)`).all() as Array<{ table: string; from: string }>;

    expect(workspaceFks).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'workspace_groups', from: 'group_id' }),
    ]));
    expect(paneFks).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'workspaces', from: 'workspace_id' }),
      expect.objectContaining({ table: 'panes', from: 'parent_id' }),
      expect.objectContaining({ table: 'tabs', from: 'active_tab_id' }),
    ]));
    expect(tabStatusFks).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'tabs', from: 'tab_id' }),
      expect.objectContaining({ table: 'agent_sessions', from: 'agent_session_id' }),
    ]));
    expect(statusEventFks).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'tabs', from: 'tab_id' }),
      expect.objectContaining({ table: 'agent_sessions', from: 'agent_session_id' }),
    ]));
  });
});
