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
  coreApi: {
    ensureStarted: vi.fn(),
    restartTerminalTab: vi.fn(),
    deleteTerminalTab: vi.fn(),
    splitPane: vi.fn(),
    closePane: vi.fn(),
    patchLayout: vi.fn(),
    patchPane: vi.fn(),
    reorderTabs: vi.fn(),
    moveTab: vi.fn(),
    patchTab: vi.fn(),
    patchTabStatusMetadata: vi.fn(),
    getTabStatusMetadata: vi.fn(),
  },
  getCoreRuntimeApi: vi.fn(),
}));

vi.mock('@/lib/tmux', () => ({
  createSession: tmuxMocks.createSession,
  hasSession: tmuxMocks.hasSession,
  killSession: tmuxMocks.killSession,
  resolveExistingDir: tmuxMocks.resolveExistingDir,
  sendKeys: tmuxMocks.sendKeys,
  workspaceSessionName: (wsId: string, paneId: string, tabId: string) => `pt-${wsId}-${paneId}-${tabId}`,
}));

vi.mock('@/lib/core-engine/runtime-api', () => ({
  getCoreRuntimeApi: runtimeMocks.getCoreRuntimeApi,
}));

vi.mock('@/lib/sync-server', () => ({
  broadcastSync: vi.fn(),
}));

import {
  addExistingTabToPane,
  createDefaultLayout,
  getLayout,
  splitPaneInLayout,
  closePaneInLayout,
  patchLayout,
  patchPane,
  reorderTabsInPane,
  moveTabBetweenPanes,
  patchTab,
  readTabAgentJsonlPath,
  readLayoutFile,
  restartTabSession,
  resolveLayoutDir,
  resolveLayoutFile,
  updateTabAgentJsonlPath,
  updateTabAgentSessionId,
  updateTabAgentSummary,
  updateTabCliStatus,
  updateTabLastUserMessage,
  writeLayoutFile,
} from '@/lib/layout-store';
import { broadcastSync } from '@/lib/sync-server';
import type { IAgentProvider } from '@/lib/providers';

const broadcastSyncMock = vi.mocked(broadcastSync);

describe('layout store normalization', () => {
  beforeEach(() => {
    tmuxMocks.createSession.mockClear();
    tmuxMocks.hasSession.mockReset();
    tmuxMocks.hasSession.mockResolvedValue(false);
    tmuxMocks.killSession.mockClear();
    tmuxMocks.resolveExistingDir.mockClear();
    tmuxMocks.sendKeys.mockClear();
    runtimeMocks.getCoreRuntimeApi.mockReset();
    runtimeMocks.getCoreRuntimeApi.mockReturnValue(runtimeMocks.coreApi);
    runtimeMocks.coreApi.ensureStarted.mockClear();
    runtimeMocks.coreApi.restartTerminalTab.mockReset();
    runtimeMocks.coreApi.restartTerminalTab.mockResolvedValue({
      id: 'tab-runtime',
      sessionName: 'rtv2-ws-layout-store-pane-runtime-tab-runtime',
      name: '',
      order: 0,
      cwd: '/tmp',
      panelType: 'terminal',
      runtimeVersion: 2,
      lifecycleState: 'ready',
    });
    runtimeMocks.coreApi.deleteTerminalTab.mockClear();
    runtimeMocks.coreApi.splitPane.mockReset();
    runtimeMocks.coreApi.closePane.mockReset();
    runtimeMocks.coreApi.patchLayout.mockReset();
    runtimeMocks.coreApi.patchPane.mockReset();
    runtimeMocks.coreApi.reorderTabs.mockReset();
    runtimeMocks.coreApi.moveTab.mockReset();
    runtimeMocks.coreApi.patchTab.mockReset();
    runtimeMocks.coreApi.patchTabStatusMetadata.mockReset();
    runtimeMocks.coreApi.getTabStatusMetadata.mockReset();
    broadcastSyncMock.mockClear();
    const runtimeLayout = {
      root: { type: 'pane' as const, id: 'pane-runtime', tabs: [], activeTabId: null },
      activePaneId: 'pane-runtime',
      updatedAt: new Date(0).toISOString(),
    };
    runtimeMocks.coreApi.splitPane.mockResolvedValue(runtimeLayout);
    runtimeMocks.coreApi.closePane.mockResolvedValue({ layout: runtimeLayout, killedSessions: [], failedKills: [] });
    runtimeMocks.coreApi.patchLayout.mockResolvedValue(runtimeLayout);
    runtimeMocks.coreApi.patchPane.mockResolvedValue(runtimeLayout);
    runtimeMocks.coreApi.reorderTabs.mockResolvedValue(runtimeLayout);
    runtimeMocks.coreApi.moveTab.mockResolvedValue(runtimeLayout);
    runtimeMocks.coreApi.patchTab.mockResolvedValue(runtimeLayout);
    runtimeMocks.coreApi.patchTabStatusMetadata.mockResolvedValue({
      updated: true,
      workspaceId: 'ws-runtime',
      tabId: 'tab-a',
    });
    runtimeMocks.coreApi.getTabStatusMetadata.mockResolvedValue({
      workspaceId: 'ws-runtime',
      tabId: 'tab-a',
      agentSessionId: 'agent-a',
      agentJsonlPath: '/tmp/agent-a.jsonl',
      agentSummary: 'summary',
      lastUserMessage: '작업 시작',
      cliState: 'needs-input',
      dismissedAt: 123,
    });
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

  it('restarts runtime v2 tabs through the core runtime API', async () => {
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
    expect(runtimeMocks.coreApi.ensureStarted).toHaveBeenCalled();
    expect(runtimeMocks.coreApi.restartTerminalTab).toHaveBeenCalledWith({
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

  it('routes layout mutations through the core runtime API in storage default mode', async () => {
    const previousRuntimeV2 = process.env.CODEXWINMUX_RUNTIME_V2;
    const previousStorageMode = process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE;
    process.env.CODEXWINMUX_RUNTIME_V2 = '1';
    process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = 'default';

    try {
      await expect(splitPaneInLayout('ws-runtime', 'pane-a', 'horizontal', '/repo', 'terminal')).resolves.toEqual(
        expect.objectContaining({ activePaneId: 'pane-runtime' }),
      );
      await expect(closePaneInLayout('ws-runtime', 'pane-b')).resolves.toEqual(expect.objectContaining({ activePaneId: 'pane-runtime' }));
      await expect(patchLayout('ws-runtime', { activePaneId: 'pane-a' })).resolves.toEqual(expect.objectContaining({ activePaneId: 'pane-runtime' }));
      await expect(patchPane('ws-runtime', 'pane-a', { activeTabId: 'tab-a' })).resolves.toEqual(expect.objectContaining({ activePaneId: 'pane-runtime' }));
      await expect(reorderTabsInPane('ws-runtime', 'pane-a', ['tab-b', 'tab-a'])).resolves.toEqual(expect.objectContaining({ activePaneId: 'pane-runtime' }));
      await expect(moveTabBetweenPanes('ws-runtime', 'tab-a', 'pane-a', 'pane-b', 0)).resolves.toEqual(expect.objectContaining({ activePaneId: 'pane-runtime' }));
      await expect(patchTab('ws-runtime', 'pane-a', 'tab-a', { name: 'patched', terminalCollapsed: true })).resolves.toEqual(expect.objectContaining({ activePaneId: 'pane-runtime' }));

      expect(runtimeMocks.coreApi.splitPane).toHaveBeenCalledWith({
        workspaceId: 'ws-runtime',
        sourcePaneId: 'pane-a',
        orientation: 'horizontal',
        cwd: '/repo',
        panelType: 'terminal',
      });
      expect(runtimeMocks.coreApi.closePane).toHaveBeenCalledWith({ workspaceId: 'ws-runtime', paneId: 'pane-b' });
      expect(runtimeMocks.coreApi.patchLayout).toHaveBeenCalledWith({ workspaceId: 'ws-runtime', activePaneId: 'pane-a' });
      expect(runtimeMocks.coreApi.patchPane).toHaveBeenCalledWith({ workspaceId: 'ws-runtime', paneId: 'pane-a', activeTabId: 'tab-a' });
      expect(runtimeMocks.coreApi.reorderTabs).toHaveBeenCalledWith({ workspaceId: 'ws-runtime', paneId: 'pane-a', tabIds: ['tab-b', 'tab-a'] });
      expect(runtimeMocks.coreApi.moveTab).toHaveBeenCalledWith({ workspaceId: 'ws-runtime', tabId: 'tab-a', fromPaneId: 'pane-a', toPaneId: 'pane-b', toIndex: 0 });
      expect(runtimeMocks.coreApi.patchTab).toHaveBeenCalledWith({
        workspaceId: 'ws-runtime',
        paneId: 'pane-a',
        tabId: 'tab-a',
        patch: { name: 'patched', terminalCollapsed: true },
      });
      expect(broadcastSyncMock).toHaveBeenCalledWith({ type: 'layout', workspaceId: 'ws-runtime' });
      expect(tmuxMocks.createSession).not.toHaveBeenCalled();
    } finally {
      if (previousRuntimeV2 === undefined) delete process.env.CODEXWINMUX_RUNTIME_V2;
      else process.env.CODEXWINMUX_RUNTIME_V2 = previousRuntimeV2;
      if (previousStorageMode === undefined) delete process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE;
      else process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = previousStorageMode;
    }
  });

  it('routes status and timeline metadata through the core runtime API in storage default mode', async () => {
    const previousRuntimeV2 = process.env.CODEXWINMUX_RUNTIME_V2;
    const previousStorageMode = process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE;
    process.env.CODEXWINMUX_RUNTIME_V2 = '1';
    process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = 'default';
    const provider = {
      readSessionId: vi.fn(),
      writeSessionId: vi.fn(),
      readJsonlPath: vi.fn(),
      writeJsonlPath: vi.fn(),
      readSummary: vi.fn(),
      writeSummary: vi.fn(),
    } as unknown as IAgentProvider;

    try {
      await updateTabAgentSessionId('rtv2-ws-runtime-pane-a-tab-a', provider, 'agent-a');
      await updateTabAgentJsonlPath('rtv2-ws-runtime-pane-a-tab-a', provider, '/tmp/agent-a.jsonl');
      await updateTabAgentSummary('rtv2-ws-runtime-pane-a-tab-a', provider, 'summary');
      await updateTabLastUserMessage('rtv2-ws-runtime-pane-a-tab-a', '작업 시작');
      await updateTabCliStatus('rtv2-ws-runtime-pane-a-tab-a', 'needs-input', 123);
      await expect(readTabAgentJsonlPath('rtv2-ws-runtime-pane-a-tab-a', provider)).resolves.toBe('/tmp/agent-a.jsonl');

      expect(runtimeMocks.coreApi.patchTabStatusMetadata).toHaveBeenCalledWith({
        sessionName: 'rtv2-ws-runtime-pane-a-tab-a',
        agentSessionId: 'agent-a',
      });
      expect(runtimeMocks.coreApi.patchTabStatusMetadata).toHaveBeenCalledWith({
        sessionName: 'rtv2-ws-runtime-pane-a-tab-a',
        agentJsonlPath: '/tmp/agent-a.jsonl',
      });
      expect(runtimeMocks.coreApi.patchTabStatusMetadata).toHaveBeenCalledWith({
        sessionName: 'rtv2-ws-runtime-pane-a-tab-a',
        agentSummary: 'summary',
      });
      expect(runtimeMocks.coreApi.patchTabStatusMetadata).toHaveBeenCalledWith({
        sessionName: 'rtv2-ws-runtime-pane-a-tab-a',
        lastUserMessage: '작업 시작',
      });
      expect(runtimeMocks.coreApi.patchTabStatusMetadata).toHaveBeenCalledWith({
        sessionName: 'rtv2-ws-runtime-pane-a-tab-a',
        cliState: 'needs-input',
        dismissedAt: 123,
      });
      expect(runtimeMocks.coreApi.getTabStatusMetadata).toHaveBeenCalledWith({
        sessionName: 'rtv2-ws-runtime-pane-a-tab-a',
      });
      expect(provider.writeSessionId).not.toHaveBeenCalled();
      expect(provider.writeJsonlPath).not.toHaveBeenCalled();
      expect(provider.writeSummary).not.toHaveBeenCalled();
    } finally {
      if (previousRuntimeV2 === undefined) delete process.env.CODEXWINMUX_RUNTIME_V2;
      else process.env.CODEXWINMUX_RUNTIME_V2 = previousRuntimeV2;
      if (previousStorageMode === undefined) delete process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE;
      else process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = previousStorageMode;
    }
  });
});
