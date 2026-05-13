import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tmuxMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  hasSession: vi.fn(),
  killSession: vi.fn(),
  resolveExistingDir: vi.fn(async (cwd?: string) => cwd ?? '/home/test'),
  sendKeys: vi.fn(),
}));

const runtimeMocks = vi.hoisted(() => ({
  supervisor: {
    ensureStarted: vi.fn(),
    restartTerminalTab: vi.fn(),
    deleteTerminalTab: vi.fn(),
  },
  getRuntimeSupervisor: vi.fn(),
}));

vi.mock('@/lib/tmux', () => ({
  createSession: tmuxMocks.createSession,
  hasSession: tmuxMocks.hasSession,
  killSession: tmuxMocks.killSession,
  resolveExistingDir: tmuxMocks.resolveExistingDir,
  sendKeys: tmuxMocks.sendKeys,
  workspaceSessionName: (wsId: string, paneId: string, tabId: string) => `pt-${wsId}-${paneId}-${tabId}`,
}));

vi.mock('@/lib/runtime/supervisor', () => ({
  getRuntimeSupervisor: runtimeMocks.getRuntimeSupervisor,
}));

vi.mock('@/lib/sync-server', () => ({
  broadcastSync: vi.fn(),
}));

import {
  addExistingTabToPane,
  createDefaultLayout,
  getLayout,
  readLayoutFile,
  restartTabSession,
  resolveLayoutDir,
  resolveLayoutFile,
  writeLayoutFile,
} from '@/lib/layout-store';

describe('layout store normalization', () => {
  beforeEach(() => {
    tmuxMocks.createSession.mockClear();
    tmuxMocks.hasSession.mockReset();
    tmuxMocks.hasSession.mockResolvedValue(false);
    tmuxMocks.killSession.mockClear();
    tmuxMocks.resolveExistingDir.mockClear();
    tmuxMocks.sendKeys.mockClear();
    runtimeMocks.getRuntimeSupervisor.mockReset();
    runtimeMocks.getRuntimeSupervisor.mockReturnValue(runtimeMocks.supervisor);
    runtimeMocks.supervisor.ensureStarted.mockClear();
    runtimeMocks.supervisor.restartTerminalTab.mockReset();
    runtimeMocks.supervisor.restartTerminalTab.mockResolvedValue({
      id: 'tab-runtime',
      sessionName: 'rtv2-ws-layout-store-pane-runtime-tab-runtime',
      name: '',
      order: 0,
      cwd: '/tmp',
      panelType: 'terminal',
      runtimeVersion: 2,
      lifecycleState: 'ready',
    });
    runtimeMocks.supervisor.deleteTerminalTab.mockClear();
  });

  it('marks newly created legacy terminal tabs as runtime 1', async () => {
    const layout = await createDefaultLayout('ws-test', '/tmp');
    const tab = layout.root.type === 'pane' ? layout.root.tabs[0] : null;

    expect(tab).toMatchObject({
      sessionName: expect.stringMatching(/^pt-ws-test-/),
      runtimeVersion: 1,
    });
    expect(tmuxMocks.createSession).toHaveBeenCalledWith(tab?.sessionName, 80, 24, '/tmp');
  });

  it('normalizes stored panel and agent fields on read', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-layout-'));
    const filePath = path.join(dir, 'layout.json');
    await fs.writeFile(filePath, JSON.stringify({
      root: {
        type: 'pane',
        id: 'pane-test',
        activeTabId: 'tab-agent',
        tabs: [
          {
            id: 'tab-agent',
            sessionName: 'pt-ws-pane-tab',
            name: 'codex',
            order: 0,
            panelType: 'codex',
            agentSessionId: 'agent-session',
            agentJsonlPath: '/agent.jsonl',
            agentSummary: 'agent summary',
          },
          {
            id: 'tab-terminal',
            sessionName: 'pt-ws-pane-terminal',
            name: 'terminal',
            order: 1,
          },
        ],
      },
      activePaneId: 'pane-test',
      updatedAt: new Date(0).toISOString(),
    }));

    const layout = await readLayoutFile(filePath);
    const agentTab = layout?.root.type === 'pane' ? layout.root.tabs[0] : null;
    const terminalTab = layout?.root.type === 'pane' ? layout.root.tabs[1] : null;

    expect(agentTab).toMatchObject({
      panelType: 'codex',
      agentSessionId: 'agent-session',
      agentJsonlPath: '/agent.jsonl',
      agentSummary: 'agent summary',
    });
    expect(terminalTab).not.toHaveProperty('agentSessionId');
  });

  it('appends externally-created runtime v2 tabs without creating legacy tmux sessions', async () => {
    const wsId = `ws-layout-store-${process.pid}`;
    const paneId = 'pane-runtime';
    await fs.rm(resolveLayoutDir(wsId), { recursive: true, force: true });
    await fs.mkdir(resolveLayoutDir(wsId), { recursive: true });
    await writeLayoutFile({
      root: {
        type: 'pane',
        id: paneId,
        activeTabId: 'tab-existing',
        tabs: [{
          id: 'tab-existing',
          sessionName: 'pt-ws-layout-store-pane-runtime-tab-existing',
          name: '',
          order: 0,
          runtimeVersion: 1,
        }],
      },
      activePaneId: paneId,
      updatedAt: new Date(0).toISOString(),
    }, resolveLayoutFile(wsId));

    const tab = await addExistingTabToPane(wsId, paneId, {
      id: 'tab-runtime',
      sessionName: 'rtv2-ws-layout-store-pane-runtime-tab-runtime',
      name: '',
      order: 0,
      panelType: 'terminal',
      runtimeVersion: 2,
      cwd: '/tmp',
    });
    const layout = await readLayoutFile(resolveLayoutFile(wsId));

    expect(tab).toMatchObject({
      id: 'tab-runtime',
      order: 1,
      runtimeVersion: 2,
    });
    expect(layout?.root.type).toBe('pane');
    if (layout?.root.type === 'pane') {
      expect(layout.root.activeTabId).toBe('tab-runtime');
      expect(layout.root.tabs.map((item) => item.id)).toEqual(['tab-existing', 'tab-runtime']);
    }
    expect(tmuxMocks.createSession).not.toHaveBeenCalled();

    await fs.rm(resolveLayoutDir(wsId), { recursive: true, force: true });
  });

  it('restarts runtime v2 tabs through the runtime supervisor', async () => {
    const wsId = `ws-layout-store-restart-${process.pid}`;
    const paneId = 'pane-runtime';
    await fs.rm(resolveLayoutDir(wsId), { recursive: true, force: true });
    await fs.mkdir(resolveLayoutDir(wsId), { recursive: true });
    await writeLayoutFile({
      root: {
        type: 'pane',
        id: paneId,
        activeTabId: 'tab-runtime',
        tabs: [{
          id: 'tab-runtime',
          sessionName: 'rtv2-ws-layout-store-restart-pane-runtime-tab-runtime',
          name: '',
          order: 0,
          runtimeVersion: 2,
          cwd: '/tmp',
        }],
      },
      activePaneId: paneId,
      updatedAt: new Date(0).toISOString(),
    }, resolveLayoutFile(wsId));

    const ok = await restartTabSession(wsId, paneId, 'tab-runtime');

    expect(ok).toBe(true);
    expect(runtimeMocks.supervisor.ensureStarted).toHaveBeenCalled();
    expect(runtimeMocks.supervisor.restartTerminalTab).toHaveBeenCalledWith({
      workspaceId: wsId,
      paneId,
      tabId: 'tab-runtime',
      sessionName: 'rtv2-ws-layout-store-restart-pane-runtime-tab-runtime',
      cwd: '/tmp',
      ensureWorkspacePane: {
        workspaceName: wsId,
        defaultCwd: '/tmp',
      },
    });
    expect(tmuxMocks.hasSession).not.toHaveBeenCalled();
    expect(tmuxMocks.createSession).not.toHaveBeenCalled();

    await fs.rm(resolveLayoutDir(wsId), { recursive: true, force: true });
  });

  it('does not create a legacy tmux fallback when runtime v2 storage default has no layout', async () => {
    const previousRuntimeV2 = process.env.CODEXWINMUX_RUNTIME_V2;
    const previousStorageMode = process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE;
    const previousRuntimeDb = process.env.CODEXWINMUX_RUNTIME_DB;
    const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-runtime-empty-layout-'));

    process.env.CODEXWINMUX_RUNTIME_V2 = '1';
    process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = 'default';
    process.env.CODEXWINMUX_RUNTIME_DB = path.join(runtimeRoot, 'state.db');

    try {
      await expect(getLayout('ws-missing-runtime', '/tmp')).rejects.toThrow('runtime v2 layout not found');
      expect(tmuxMocks.createSession).not.toHaveBeenCalled();
    } finally {
      if (previousRuntimeV2 === undefined) delete process.env.CODEXWINMUX_RUNTIME_V2;
      else process.env.CODEXWINMUX_RUNTIME_V2 = previousRuntimeV2;
      if (previousStorageMode === undefined) delete process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE;
      else process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = previousStorageMode;
      if (previousRuntimeDb === undefined) delete process.env.CODEXWINMUX_RUNTIME_DB;
      else process.env.CODEXWINMUX_RUNTIME_DB = previousRuntimeDb;
      await fs.rm(runtimeRoot, { recursive: true, force: true });
    }
  });
});
