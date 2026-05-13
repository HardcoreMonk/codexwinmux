import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRuntimeCommand } from '@/lib/runtime/ipc';
import { createStorageWorkerService } from '@/lib/runtime/storage/worker-service';

describe('storage worker service', () => {
  let dir: string;
  const services: Array<ReturnType<typeof createStorageWorkerService>> = [];

  const createTestStorageWorkerService = (...args: Parameters<typeof createStorageWorkerService>) => {
    const service = createStorageWorkerService(...args);
    services.push(service);
    return service;
  };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-storage-worker-'));
  });

  afterEach(async () => {
    for (const service of services.splice(0)) {
      service.close();
    }
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('handles health and workspace creation commands', async () => {
    const service = createTestStorageWorkerService({ dbPath: path.join(dir, 'runtime-v2', 'state.db') });

    const health = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.health',
      payload: {},
    }));

    expect(health.ok).toBe(true);
    expect(health.payload).toEqual({ ok: true });

    const created = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.create-workspace',
      payload: { name: 'Runtime', defaultCwd: dir },
    }));

    expect(created.ok).toBe(true);
    expect(created.payload).toEqual(expect.objectContaining({ id: expect.stringMatching(/^ws-/) }));
  });

  it('handles workspace rename commands through storage ownership', async () => {
    const service = createTestStorageWorkerService({ dbPath: path.join(dir, 'runtime-v2', 'state.db') });
    const created = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.create-workspace',
      payload: { name: 'Runtime', defaultCwd: dir },
    }));
    const workspace = created.payload as { id: string };

    const renamed = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.rename-workspace',
      payload: { workspaceId: workspace.id, name: '  Worker owned  ' },
    }));

    expect(renamed.ok).toBe(true);
    expect(renamed.payload).toEqual(expect.objectContaining({
      id: workspace.id,
      name: 'Worker owned',
      defaultCwd: dir,
    }));

    const missing = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.rename-workspace',
      payload: { workspaceId: 'ws-missing', name: 'Missing' },
    }));
    expect(missing.ok).toBe(true);
    expect(missing.payload).toBeNull();
  });

  it('handles workspace group and order commands through storage ownership', async () => {
    const service = createTestStorageWorkerService({ dbPath: path.join(dir, 'runtime-v2', 'state.db') });
    const firstReply = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.create-workspace',
      payload: { name: 'First', defaultCwd: dir },
    }));
    const secondReply = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.create-workspace',
      payload: { name: 'Second', defaultCwd: dir },
    }));
    const first = firstReply.payload as { id: string };
    const second = secondReply.payload as { id: string };

    const createdGroup = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.create-workspace-group',
      payload: { name: 'Runtime group' },
    }));
    const group = createdGroup.payload as { id: string };

    expect(createdGroup.ok).toBe(true);
    expect(createdGroup.payload).toEqual(expect.objectContaining({ name: 'Runtime group', collapsed: false }));

    await expect(service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.set-workspace-group',
      payload: { workspaceId: first.id, groupId: group.id },
    }))).resolves.toEqual(expect.objectContaining({ ok: true, payload: { ok: true } }));

    await expect(service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.reorder-workspaces',
      payload: { items: [{ id: second.id }, { id: first.id, groupId: group.id }] },
    }))).resolves.toEqual(expect.objectContaining({ ok: true, payload: { ok: true } }));

    await expect(service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.rename-workspace-group',
      payload: { groupId: group.id, name: 'Renamed group' },
    }))).resolves.toEqual(expect.objectContaining({
      ok: true,
      payload: { id: group.id, name: 'Renamed group', collapsed: false },
    }));

    await expect(service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.set-workspace-group-collapsed',
      payload: { groupId: group.id, collapsed: true },
    }))).resolves.toEqual(expect.objectContaining({ ok: true, payload: { ok: true } }));

    await expect(service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.delete-workspace-group',
      payload: { groupId: group.id },
    }))).resolves.toEqual(expect.objectContaining({ ok: true, payload: { deleted: true } }));
  });

  it('handles layout mutation commands through storage ownership', async () => {
    const service = createTestStorageWorkerService({ dbPath: path.join(dir, 'runtime-v2', 'state.db') });
    const created = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.create-workspace',
      payload: { name: 'Runtime', defaultCwd: dir },
    }));
    const workspace = created.payload as { id: string; rootPaneId: string };
    await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.create-pending-terminal-tab',
      payload: {
        id: 'tab-first',
        workspaceId: workspace.id,
        paneId: workspace.rootPaneId,
        sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-first`,
        cwd: dir,
      },
    }));
    await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.finalize-terminal-tab',
      payload: { id: 'tab-first' },
    }));

    const split = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.split-pane',
      payload: {
        workspaceId: workspace.id,
        sourcePaneId: workspace.rootPaneId,
        newPaneId: 'pane-second',
        orientation: 'vertical',
        tab: {
          id: 'tab-second',
          sessionName: `rtv2-${workspace.id}-pane-second-tab-second`,
          name: 'Second',
          cwd: dir,
          panelType: 'terminal',
        },
      },
    }));
    expect(split.ok).toBe(true);
    expect(split.payload).toEqual(expect.objectContaining({ activePaneId: 'pane-second' }));

    await expect(service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.patch-tab',
      payload: {
        workspaceId: workspace.id,
        paneId: 'pane-second',
        tabId: 'tab-second',
        patch: { name: 'Patched', terminalCollapsed: true },
      },
    }))).resolves.toEqual(expect.objectContaining({ ok: true }));

    await expect(service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.patch-layout',
      payload: { workspaceId: workspace.id, activePaneId: workspace.rootPaneId, ratioUpdate: { path: [], ratio: 60 } },
    }))).resolves.toEqual(expect.objectContaining({ ok: true }));

    const closed = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.close-pane',
      payload: { workspaceId: workspace.id, paneId: 'pane-second' },
    }));
    expect(closed.ok).toBe(true);
    expect(closed.payload).toEqual(expect.objectContaining({
      sessions: [{ sessionName: `rtv2-${workspace.id}-pane-second-tab-second` }],
    }));
  });

  it('handles tab status metadata commands through storage ownership', async () => {
    const service = createTestStorageWorkerService({ dbPath: path.join(dir, 'runtime-v2', 'state.db') });
    const created = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.create-workspace',
      payload: { name: 'Runtime', defaultCwd: dir },
    }));
    const workspace = created.payload as { id: string; rootPaneId: string };
    const sessionName = `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-status`;
    await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.create-pending-terminal-tab',
      payload: {
        id: 'tab-status',
        workspaceId: workspace.id,
        paneId: workspace.rootPaneId,
        sessionName,
        cwd: dir,
      },
    }));
    await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.finalize-terminal-tab',
      payload: { id: 'tab-status' },
    }));

    await expect(service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.patch-tab-status-metadata',
      payload: {
        sessionName,
        agentSessionId: 'agent-a',
        agentJsonlPath: '/tmp/agent-a.jsonl',
        agentSummary: 'summary',
        lastUserMessage: '작업 시작',
        cliState: 'needs-input',
        dismissedAt: 123,
      },
    }))).resolves.toEqual(expect.objectContaining({
      ok: true,
      payload: { updated: true, workspaceId: workspace.id, tabId: 'tab-status' },
    }));

    await expect(service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.get-tab-status-metadata',
      payload: { sessionName },
    }))).resolves.toEqual(expect.objectContaining({
      ok: true,
      payload: expect.objectContaining({
        workspaceId: workspace.id,
        tabId: 'tab-status',
        agentJsonlPath: '/tmp/agent-a.jsonl',
        cliState: 'needs-input',
      }),
    }));
  });

  it('returns structured errors for invalid worker commands', async () => {
    const service = createTestStorageWorkerService({ dbPath: path.join(dir, 'runtime-v2', 'state.db') });
    const unknown = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.unknown',
      payload: {},
    }));
    const wrongSource = await service.handleCommand(createRuntimeCommand({
      source: 'browser',
      target: 'storage',
      type: 'storage.health',
      payload: {},
    }));
    const wrongTarget = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'terminal',
      type: 'storage.health',
      payload: {},
    }));
    const wrongNamespace = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'terminal.health',
      payload: {},
    }));

    for (const reply of [unknown, wrongSource, wrongTarget, wrongNamespace]) {
      expect(reply.ok).toBe(false);
      expect(reply.error).toMatchObject({
        code: 'invalid-worker-command',
        retryable: false,
      });
    }
  });

  it('handles pending terminal tab intent lifecycle commands', async () => {
    const service = createTestStorageWorkerService({ dbPath: path.join(dir, 'runtime-v2', 'state.db') });
    const created = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.create-workspace',
      payload: { name: 'Runtime', defaultCwd: dir },
    }));
    const workspace = created.payload as { id: string; rootPaneId: string };

    const pending = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.create-pending-terminal-tab',
      payload: {
        id: 'tab-runtime',
        workspaceId: workspace.id,
        paneId: workspace.rootPaneId,
        sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-runtime`,
        cwd: dir,
      },
    }));

    expect(pending.ok).toBe(true);
    expect(pending.payload).toEqual(expect.objectContaining({ lifecycleState: 'pending_terminal' }));

    const finalized = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.finalize-terminal-tab',
      payload: { id: 'tab-runtime' },
    }));

    expect(finalized.ok).toBe(true);
    expect(finalized.payload).toEqual(expect.objectContaining({ id: 'tab-runtime', lifecycleState: 'ready' }));

    const finalizedAgain = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.finalize-terminal-tab',
      payload: { id: 'tab-runtime' },
    }));

    expect(finalizedAgain.ok).toBe(false);
    expect(finalizedAgain.error).toMatchObject({
      code: 'runtime-v2-pending-tab-not-found',
      retryable: false,
    });

    const missingFinalize = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.finalize-terminal-tab',
      payload: { id: 'tab-missing' },
    }));

    expect(missingFinalize.ok).toBe(false);
    expect(missingFinalize.error).toMatchObject({
      code: 'runtime-v2-pending-tab-not-found',
      retryable: false,
    });
  });

  it('handles legacy workspace pane mirror commands', async () => {
    const service = createTestStorageWorkerService({ dbPath: path.join(dir, 'runtime-v2', 'state.db') });

    const ensured = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.ensure-workspace-pane',
      payload: {
        workspaceId: 'ws-legacy',
        paneId: 'pane-legacy',
        name: 'Legacy',
        defaultCwd: dir,
      },
    }));

    expect(ensured.ok).toBe(true);
    expect(ensured.payload).toEqual({ workspaceId: 'ws-legacy', paneId: 'pane-legacy' });

    const pending = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.create-pending-terminal-tab',
      payload: {
        id: 'tab-runtime',
        workspaceId: 'ws-legacy',
        paneId: 'pane-legacy',
        sessionName: 'rtv2-ws-legacy-pane-legacy-tab-runtime',
        cwd: dir,
      },
    }));

    expect(pending.ok).toBe(true);
    expect(pending.payload).toEqual(expect.objectContaining({
      id: 'tab-runtime',
      runtimeVersion: 2,
      lifecycleState: 'pending_terminal',
    }));
  });

  it('rejects terminal tab intents for panes outside the supplied workspace', async () => {
    const service = createTestStorageWorkerService({ dbPath: path.join(dir, 'runtime-v2', 'state.db') });
    const created = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.create-workspace',
      payload: { name: 'Runtime', defaultCwd: dir },
    }));
    const other = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.create-workspace',
      payload: { name: 'Other', defaultCwd: dir },
    }));
    const workspace = created.payload as { id: string; rootPaneId: string };
    const otherWorkspace = other.payload as { id: string; rootPaneId: string };

    const reply = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.create-pending-terminal-tab',
      payload: {
        id: 'tab-runtime',
        workspaceId: workspace.id,
        paneId: otherWorkspace.rootPaneId,
        sessionName: `rtv2-${workspace.id}-${otherWorkspace.rootPaneId}-tab-runtime`,
        cwd: dir,
      },
    }));

    expect(reply.ok).toBe(false);
    expect(reply.error).toMatchObject({
      code: 'runtime-v2-pane-workspace-mismatch',
      retryable: false,
    });
  });

  it('deletes workspaces and returns cleanup sessions from the delete command', async () => {
    const service = createTestStorageWorkerService({ dbPath: path.join(dir, 'runtime-v2', 'state.db') });
    const created = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.create-workspace',
      payload: { name: 'Runtime', defaultCwd: dir },
    }));
    const workspace = created.payload as { id: string; rootPaneId: string };

    await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.create-pending-terminal-tab',
      payload: {
        id: 'tab-runtime',
        workspaceId: workspace.id,
        paneId: workspace.rootPaneId,
        sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-runtime`,
        cwd: dir,
      },
    }));

    const deleted = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.delete-workspace',
      payload: { workspaceId: workspace.id },
    }));
    expect(deleted.payload).toEqual({
      deleted: true,
      sessions: [{ sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-runtime` }],
    });
  });

  it('deletes terminal tabs and returns cleanup sessions from the delete command', async () => {
    const service = createTestStorageWorkerService({ dbPath: path.join(dir, 'runtime-v2', 'state.db') });
    const created = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.create-workspace',
      payload: { name: 'Runtime', defaultCwd: dir },
    }));
    const workspace = created.payload as { id: string; rootPaneId: string };
    const sessionName = `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-runtime`;

    await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.create-pending-terminal-tab',
      payload: {
        id: 'tab-runtime',
        workspaceId: workspace.id,
        paneId: workspace.rootPaneId,
        sessionName,
        cwd: dir,
      },
    }));
    await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.finalize-terminal-tab',
      payload: { id: 'tab-runtime' },
    }));

    const deleted = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.delete-terminal-tab',
      payload: { id: 'tab-runtime' },
    }));
    expect(deleted.ok).toBe(true);
    expect(deleted.payload).toEqual({
      deleted: true,
      workspaceId: workspace.id,
      session: { sessionName },
    });

    const missing = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.delete-terminal-tab',
      payload: { id: 'tab-missing' },
    }));
    expect(missing.payload).toEqual({ deleted: false, session: null });
  });

  it('returns only ready terminal tabs for attach authorization', async () => {
    const service = createTestStorageWorkerService({ dbPath: path.join(dir, 'runtime-v2', 'state.db') });
    const created = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.create-workspace',
      payload: { name: 'Runtime', defaultCwd: dir },
    }));
    const workspace = created.payload as { id: string; rootPaneId: string };
    const sessionName = `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-runtime`;

    await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.create-pending-terminal-tab',
      payload: {
        id: 'tab-runtime',
        workspaceId: workspace.id,
        paneId: workspace.rootPaneId,
        sessionName,
        cwd: dir,
      },
    }));

    const pendingLookup = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.get-ready-terminal-tab-by-session',
      payload: { sessionName },
    }));
    expect(pendingLookup.payload).toBeNull();

    await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.finalize-terminal-tab',
      payload: { id: 'tab-runtime' },
    }));

    const readyLookup = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.get-ready-terminal-tab-by-session',
      payload: { sessionName },
    }));
    expect(readyLookup.payload).toEqual(expect.objectContaining({ id: 'tab-runtime', lifecycleState: 'ready' }));
  });

  it('lists ready terminal tabs and marks stale ready tabs failed', async () => {
    const service = createTestStorageWorkerService({ dbPath: path.join(dir, 'runtime-v2', 'state.db') });
    const created = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.create-workspace',
      payload: { name: 'Runtime', defaultCwd: dir },
    }));
    const workspace = created.payload as { id: string; rootPaneId: string };
    const sessionName = `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-runtime`;

    await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.create-pending-terminal-tab',
      payload: {
        id: 'tab-runtime',
        workspaceId: workspace.id,
        paneId: workspace.rootPaneId,
        sessionName,
        cwd: dir,
      },
    }));
    await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.finalize-terminal-tab',
      payload: { id: 'tab-runtime' },
    }));

    const readyList = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.list-ready-terminal-tabs',
      payload: {},
    }));
    expect(readyList.ok).toBe(true);
    expect(readyList.payload).toEqual([
      expect.objectContaining({ id: 'tab-runtime', sessionName, lifecycleState: 'ready' }),
    ]);

    const failed = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.fail-ready-terminal-tab',
      payload: {
        id: 'tab-runtime',
        reason: 'startup reconciliation: tmux session missing',
      },
    }));
    expect(failed.ok).toBe(true);
    expect(failed.payload).toEqual({ ok: true });

    const emptyReadyList = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.list-ready-terminal-tabs',
      payload: {},
    }));
    expect(emptyReadyList.payload).toEqual([]);

    const failedAgain = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'storage.fail-ready-terminal-tab',
      payload: { id: 'tab-runtime', reason: 'already failed' },
    }));
    expect(failedAgain.ok).toBe(false);
    expect(failedAgain.error).toMatchObject({
      code: 'runtime-v2-ready-tab-not-found',
      retryable: false,
    });
  });
});
