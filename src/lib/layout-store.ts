import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { nanoid } from 'nanoid';
import { createSession, hasSession, killSession, resolveExistingDir, sendKeys, workspaceSessionName } from '@/lib/tmux';
import { broadcastSync } from '@/lib/sync-server';
import { createLogger } from '@/lib/logger';
import { cleanupTabSession } from '@/lib/tab-session-cleanup';
import {
  collectPanes,
  collectAllTabs,
  findPane,
  replacePane,
  removePaneWithFocus,
  updateRatioAtPath,
  equalizeNode,
  isEqualized,
} from '@/lib/layout-tree';
import { isAgentPanelType, normalizePanelType } from '@/lib/panel-type';
import { normalizeAgentFields } from '@/lib/agent-tab-fields';
import { resolveTabRuntimeVersion } from '@/lib/runtime/terminal-mode';
import { mirrorLegacyStorageToRuntimeV2BestEffort } from '@/lib/runtime/storage-mirror';
import { readRuntimeStorageLayout, shouldReadRuntimeStorageV2 } from '@/lib/runtime/storage-read-owner';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';
import type { ITab, TLayoutNode, IPaneNode, ILayoutData, TPanelType } from '@/types/terminal';
import type { TCliState } from '@/types/timeline';
import type { IAgentProvider } from '@/lib/providers/types';

const log = createLogger('layout');

const BASE_DIR = path.join(os.homedir(), '.codexwinmux');

interface ILayoutReconciler {
  reconcileWorkspaceTabs: (wsId: string, validTabIds: readonly string[]) => void;
  removeWorkspaceTabs: (wsId: string) => void;
}

const g = globalThis as unknown as {
  __ptLayoutLock?: Promise<void>;
  __ptLayoutContentCache?: Map<string, string>;
  __ptLayoutReconciler?: ILayoutReconciler | null;
};
if (!g.__ptLayoutLock) g.__ptLayoutLock = Promise.resolve();
if (!g.__ptLayoutContentCache) g.__ptLayoutContentCache = new Map();
if (g.__ptLayoutReconciler === undefined) g.__ptLayoutReconciler = null;

export const setLayoutReconciler = (reconciler: ILayoutReconciler | null): void => {
  g.__ptLayoutReconciler = reconciler;
};

const withLock = async <T>(fn: () => Promise<T>): Promise<T> => {
  let release: () => void;
  const next = new Promise<void>((r) => {
    release = r;
  });
  const prev = g.__ptLayoutLock!;
  g.__ptLayoutLock = next;
  await prev;
  try {
    return await fn();
  } finally {
    release!();
  }
};

export const generatePaneId = (): string => `pane-${nanoid(6)}`;
export const generateTabId = (): string => `tab-${nanoid(6)}`;

export const resolveLayoutDir = (wsId: string): string =>
  path.join(BASE_DIR, 'workspaces', wsId);

export const resolveLayoutFile = (wsId: string): string =>
  path.join(resolveLayoutDir(wsId), 'layout.json');

const normalizeStoredLayout = (node: TLayoutNode): void => {
  if (node.type === 'split') {
    node.children.forEach(normalizeStoredLayout);
    return;
  }

  for (const tab of node.tabs) {
    tab.panelType = normalizePanelType(tab.panelType);
    normalizeAgentFields(tab);
  }
};

const createDefaultTab = (wsId: string, paneId: string, order = 0, cwd?: string): ITab => {
  const tabId = generateTabId();
  const tab: ITab = {
    id: tabId,
    sessionName: workspaceSessionName(wsId, paneId, tabId),
    name: '',
    order,
    runtimeVersion: 1,
  };
  if (cwd) tab.cwd = cwd;
  return tab;
};

const createDefaultPaneNode = (wsId: string, cwd?: string): { pane: IPaneNode; tab: ITab } => {
  const paneId = generatePaneId();
  const tab = createDefaultTab(wsId, paneId, 0, cwd);
  return {
    pane: { type: 'pane', id: paneId, tabs: [tab], activeTabId: tab.id },
    tab,
  };
};

const extractWsIdFromPath = (filePath: string): string | null => {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const match = normalizedPath.match(/workspaces\/(ws-[^/]+)\//);
  return match?.[1] ?? null;
};

export const readLayoutFile = async (filePath: string): Promise<ILayoutData | null> => {
  const wsId = extractWsIdFromPath(filePath);
  const runtimeLayout = wsId ? readRuntimeStorageLayout(wsId) : null;
  if (runtimeLayout) return runtimeLayout;

  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }

  try {
    const layout = JSON.parse(raw) as ILayoutData;
    normalizeStoredLayout(layout.root);
    return layout;
  } catch {
    log.warn(`${filePath} parse failed`);
    try {
      await fs.copyFile(filePath, filePath.replace(/\.json$/, '.json.bak'));
    } catch {}
    return null;
  }
};

export const writeLayoutFile = async (data: ILayoutData, filePath: string): Promise<void> => {
  const contentKey = JSON.stringify({ root: data.root, activePaneId: data.activePaneId });
  const cache = g.__ptLayoutContentCache!;

  if (cache.get(filePath) === contentKey) return;

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpFile = filePath + '.tmp';
  try {
    await fs.writeFile(tmpFile, JSON.stringify(data, null, 2), { mode: 0o600 });
    await fs.rename(tmpFile, filePath);
  } catch (err) {
    await fs.unlink(tmpFile).catch(() => {});
    throw err;
  }

  cache.set(filePath, contentKey);

  const wsId = extractWsIdFromPath(filePath);
  if (wsId) {
    const reconciler = g.__ptLayoutReconciler;
    if (reconciler) {
      const validTabIds = collectAllTabs(data.root).map((t) => t.id);
      reconciler.reconcileWorkspaceTabs(wsId, validTabIds);
    }
    broadcastSync({ type: 'layout', workspaceId: wsId });
    await mirrorLegacyStorageToRuntimeV2BestEffort({ reason: 'layout-write' });
  }
};

export const removeLayoutFile = async (wsId: string): Promise<void> => {
  await fs.rm(resolveLayoutDir(wsId), { recursive: true, force: true });
  clearLayoutCache(wsId);
  const reconciler = g.__ptLayoutReconciler;
  if (reconciler) {
    reconciler.removeWorkspaceTabs(wsId);
  }
  broadcastSync({ type: 'layout', workspaceId: wsId });
};

export const clearLayoutCache = (wsId: string): void => {
  const filePath = resolveLayoutFile(wsId);
  g.__ptLayoutContentCache!.delete(filePath);
};

export { collectPanes, collectAllTabs, normalizeTree } from '@/lib/layout-tree';

const syncWorkspaceDirectories = (wsId: string, root: TLayoutNode): void => {
  const cwds = [...new Set(
    collectAllTabs(root)
      .map((t) => t.cwd)
      .filter((c): c is string => !!c),
  )];
  if (cwds.length > 0) {
    import('@/lib/workspace-store').then(({ updateWorkspaceDirectories }) => {
      updateWorkspaceDirectories(wsId, cwds).catch(() => {});
    }).catch(() => {});
  }
};

export const crossCheckLayout = async (
  layout: ILayoutData,
  tmuxSessions: string[],
  wsId: string,
  defaultCwd?: string,
): Promise<boolean> => {
  let changed = false;
  const tmuxSet = new Set(tmuxSessions);
  const panes = collectPanes(layout.root);
  const layoutSessions = new Set<string>();

  for (const pane of panes) {
    for (const tab of pane.tabs) {
      if (tab.panelType === 'web-browser') continue;
      layoutSessions.add(tab.sessionName);

      if (!tmuxSet.has(tab.sessionName) && isAgentPanelType(tab.panelType)) {
        const cwd = tab.cwd || defaultCwd;
        log.debug(`crossCheck: agent tab session recreated: ${tab.sessionName} (cwd: ${cwd})`);
        await createSession(tab.sessionName, 80, 24, cwd);
        changed = true;
      }
    }
  }

  const orphans = tmuxSessions.filter((s) => !layoutSessions.has(s));
  if (orphans.length > 0) {
    changed = true;
    const firstPane = panes[0];
    if (firstPane) {
      let maxOrder = firstPane.tabs.length > 0 ? Math.max(...firstPane.tabs.map((t) => t.order)) : -1;
      for (const sessionName of orphans) {
        maxOrder++;
        firstPane.tabs.push({
          id: generateTabId(),
          sessionName,
          name: '',
          order: maxOrder,
        });
      }
      if (!firstPane.activeTabId && firstPane.tabs.length > 0) {
        firstPane.activeTabId = firstPane.tabs[0].id;
      }
    }
  }

  if (changed) {
    layout.updatedAt = new Date().toISOString();
    const finalPanes = collectPanes(layout.root);
    if (layout.activePaneId && !finalPanes.some((p) => p.id === layout.activePaneId)) {
      layout.activePaneId = finalPanes[0]?.id ?? null;
    }
  }

  return changed;
};

export interface ICreateLayoutOptions {
  panelType?: TPanelType;
}

export const createDefaultLayout = async (wsId: string, cwd: string, options?: ICreateLayoutOptions): Promise<ILayoutData> => {
  const { pane, tab } = createDefaultPaneNode(wsId, cwd);
  if (options?.panelType) tab.panelType = options.panelType;
  await createSession(tab.sessionName, 80, 24, cwd);
  return {
    root: pane,
    activePaneId: pane.id,
    updatedAt: new Date().toISOString(),
  };
};

export const getLayout = async (wsId: string, defaultCwd?: string): Promise<ILayoutData> =>
  withLock(async () => {
    const filePath = resolveLayoutFile(wsId);
    const existing = await readLayoutFile(filePath);
    if (existing) return existing;
    if (shouldReadRuntimeStorageV2()) {
      throw Object.assign(new Error(`runtime v2 layout not found: ${wsId}`), {
        code: 'runtime-v2-layout-not-found',
      });
    }

    const { pane, tab } = createDefaultPaneNode(wsId, defaultCwd);
    await createSession(tab.sessionName, 80, 24, defaultCwd);

    const layout: ILayoutData = {
      root: pane,
      activePaneId: pane.id,
      updatedAt: new Date().toISOString(),
    };
    await writeLayoutFile(layout, filePath);
    return layout;
  });

export const createPane = async (wsId: string, cwd?: string): Promise<{ paneId: string; tab: ITab }> => {
  if (shouldReadRuntimeStorageV2()) {
    throw Object.assign(new Error(`runtime v2 workspace pane not found: ${wsId}`), {
      code: 'runtime-v2-pane-not-found',
    });
  }

  const paneId = generatePaneId();
  const tabId = generateTabId();
  const sessionName = workspaceSessionName(wsId, paneId, tabId);

  await createSession(sessionName, 80, 24, cwd);

  const tab: ITab = { id: tabId, sessionName, name: '', order: 0, runtimeVersion: 1, ...(cwd ? { cwd } : {}) };
  return { paneId, tab };
};

export const deletePane = async (
  paneId: string,
  sessions: string[] = [],
): Promise<void> => {
  for (const session of sessions) {
    try {
      await killSession(session);
    } catch {
      // session already gone
    }
  }
};

export const addTabToPane = async (wsId: string, paneId: string, name?: string, cwd?: string, panelType?: string, command?: string): Promise<ITab | null> =>
  withLock(async () => {
    const filePath = resolveLayoutFile(wsId);
    const layout = await readLayoutFile(filePath);
    if (!layout) return null;

    const pane = collectPanes(layout.root).find((p) => p.id === paneId);
    if (!pane) return null;

    const isWebBrowser = panelType === 'web-browser';
    const tabId = generateTabId();
    const sessionName = workspaceSessionName(wsId, paneId, tabId);
    if (!isWebBrowser) {
      await createSession(sessionName, 80, 24, cwd);
      if (command) {
        await sendKeys(sessionName, command);
      }
    }

    const nextOrder = pane.tabs.length > 0 ? Math.max(...pane.tabs.map((t) => t.order)) + 1 : 0;
    const defaultName = isWebBrowser ? 'Web Browser' : '';
    const tabName = name?.trim() || defaultName;
    const tab: ITab = {
      id: tabId,
      sessionName,
      name: tabName,
      order: nextOrder,
      ...(!isWebBrowser ? { runtimeVersion: 1 as const } : {}),
      ...(cwd ? { cwd } : {}),
      ...(panelType ? { panelType: panelType as ITab['panelType'] } : {}),
    };

    pane.tabs.push(tab);
    pane.activeTabId = tabId;
    layout.updatedAt = new Date().toISOString();
    await writeLayoutFile(layout, filePath);
    syncWorkspaceDirectories(wsId,layout.root);

    return tab;
  });

export const addExistingTabToPane = async (wsId: string, paneId: string, tab: ITab): Promise<ITab | null> =>
  withLock(async () => {
    const filePath = resolveLayoutFile(wsId);
    const layout = await readLayoutFile(filePath);
    if (!layout) return null;

    const pane = collectPanes(layout.root).find((p) => p.id === paneId);
    if (!pane) return null;

    const nextOrder = pane.tabs.length > 0 ? Math.max(...pane.tabs.map((t) => t.order)) + 1 : 0;
    const nextTab: ITab = {
      ...tab,
      name: tab.name.trim(),
      order: nextOrder,
    };

    pane.tabs.push(nextTab);
    pane.activeTabId = nextTab.id;
    layout.updatedAt = new Date().toISOString();
    await writeLayoutFile(layout, filePath);
    syncWorkspaceDirectories(wsId, layout.root);

    return { ...nextTab };
  });

export const removeTabFromPane = async (wsId: string, paneId: string, tabId: string): Promise<boolean> => {
  const tabInfo = await withLock(async () => {
    const filePath = resolveLayoutFile(wsId);
    const layout = await readLayoutFile(filePath);
    if (!layout) return null;

    const pane = collectPanes(layout.root).find((p) => p.id === paneId);
    if (!pane) return null;

    const tab = pane.tabs.find((t) => t.id === tabId);
    if (!tab) return null;
    return {
      id: tab.id,
      sessionName: tab.sessionName,
      panelType: tab.panelType,
      runtimeVersion: tab.runtimeVersion,
    };
  });

  if (!tabInfo) return false;

  await cleanupTabSession(tabInfo);

  return withLock(async () => {
    const filePath = resolveLayoutFile(wsId);
    const layout = await readLayoutFile(filePath);
    if (!layout) return false;

    const pane = collectPanes(layout.root).find((p) => p.id === paneId);
    if (!pane) return false;

    const idx = pane.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return false;

    pane.tabs.splice(idx, 1);

    if (pane.activeTabId === tabId) {
      pane.activeTabId = pane.tabs[0]?.id ?? null;
    }

    if (pane.tabs.length === 0 && collectPanes(layout.root).length > 1) {
      removePaneWithFocus(layout, paneId);
    }

    pane.tabs.forEach((t, i) => { t.order = i; });
    layout.updatedAt = new Date().toISOString();
    await writeLayoutFile(layout, filePath);
    syncWorkspaceDirectories(wsId, layout.root);

    return true;
  });
};

export const renameTabInPane = async (wsId: string, paneId: string, tabId: string, name: string): Promise<ITab | null> =>
  withLock(async () => {
    const filePath = resolveLayoutFile(wsId);
    const layout = await readLayoutFile(filePath);
    if (!layout) return null;

    const pane = collectPanes(layout.root).find((p) => p.id === paneId);
    if (!pane) return null;

    const tab = pane.tabs.find((t) => t.id === tabId);
    if (!tab) return null;

    tab.name = name;
    layout.updatedAt = new Date().toISOString();
    await writeLayoutFile(layout, filePath);

    return { ...tab };
  });

export const restartTabSession = async (wsId: string, paneId: string, tabId: string, command?: string): Promise<boolean> =>
  withLock(async () => {
    const filePath = resolveLayoutFile(wsId);
    const layout = await readLayoutFile(filePath);
    if (!layout) return false;

    const pane = collectPanes(layout.root).find((p) => p.id === paneId);
    if (!pane) return false;

    const tab = pane.tabs.find((t) => t.id === tabId);
    if (!tab) return false;

    const effectiveCwd = await resolveExistingDir(tab.cwd);
    const cwdLost = Boolean(tab.cwd && tab.cwd !== effectiveCwd);

    if (resolveTabRuntimeVersion(tab) === 2) {
      const supervisor = getRuntimeSupervisor();
      await supervisor.ensureStarted();
      await supervisor.restartTerminalTab({
        workspaceId: wsId,
        paneId,
        tabId,
        sessionName: tab.sessionName,
        cwd: effectiveCwd,
        ensureWorkspacePane: {
          workspaceName: wsId,
          defaultCwd: effectiveCwd,
        },
      });

      if (cwdLost) {
        log.warn(`tab cwd missing, falling back to ${effectiveCwd}: ${tab.sessionName} (was ${tab.cwd})`);
        tab.cwd = effectiveCwd;
        delete tab.lastCommand;
        layout.updatedAt = new Date().toISOString();
        await writeLayoutFile(layout, filePath);
      }
      return true;
    }

    const exists = await hasSession(tab.sessionName);
    if (exists) return true;

    await createSession(tab.sessionName, 80, 24, effectiveCwd);
    if (command && !cwdLost) {
      await sendKeys(tab.sessionName, command);
    }

    if (cwdLost) {
      log.warn(`tab cwd missing, falling back to ${effectiveCwd}: ${tab.sessionName} (was ${tab.cwd})`);
      tab.cwd = effectiveCwd;
      delete tab.lastCommand;
      layout.updatedAt = new Date().toISOString();
      await writeLayoutFile(layout, filePath);
    }
    return true;
  });

export const reconcileTabCwd = async (sessionName: string): Promise<void> =>
  withLock(async () => {
    const parsed = parseSessionName(sessionName);
    if (!parsed) return;

    const filePath = resolveLayoutFile(parsed.wsId);
    const layout = await readLayoutFile(filePath);
    if (!layout) return;

    const pane = collectPanes(layout.root).find((p) => p.id === parsed.paneId);
    if (!pane) return;
    const tab = pane.tabs.find((t) => t.id === parsed.tabId);
    if (!tab || !tab.cwd) return;

    const effectiveCwd = await resolveExistingDir(tab.cwd);
    if (effectiveCwd === tab.cwd) return;

    log.warn(`tab cwd missing, clearing: ${sessionName} (was ${tab.cwd})`);
    tab.cwd = effectiveCwd;
    delete tab.lastCommand;
    layout.updatedAt = new Date().toISOString();
    await writeLayoutFile(layout, filePath);
  });

export const getFirstPaneTabs = async (wsId: string): Promise<{ tabs: ITab[]; activeTabId: string | null }> =>
  withLock(async () => {
    const layout = await readLayoutFile(resolveLayoutFile(wsId));
    if (!layout) return { tabs: [], activeTabId: null };
    const first = collectPanes(layout.root)[0];
    if (!first) return { tabs: [], activeTabId: null };
    return {
      tabs: [...first.tabs].sort((a, b) => a.order - b.order),
      activeTabId: first.activeTabId,
    };
  });

export const parseSessionName = (sessionName: string): { wsId: string; paneId: string; tabId: string } | null => {
  const match = sessionName.match(/^pt-(ws-.*?)-(pane-.*?)-(tab-.+)$/);
  if (!match) return null;
  return { wsId: match[1], paneId: match[2], tabId: match[3] };
};

const mutateTab = async (
  sessionName: string,
  mutator: (tab: ITab) => boolean,
): Promise<void> => {
  const parsed = parseSessionName(sessionName);
  if (!parsed) return;

  await withLock(async () => {
    const filePath = resolveLayoutFile(parsed.wsId);
    const layout = await readLayoutFile(filePath);
    if (!layout) return;

    const tab = collectAllTabs(layout.root).find((t) => t.sessionName === sessionName);
    if (!tab) return;
    if (!mutator(tab)) return;

    layout.updatedAt = new Date().toISOString();
    await writeLayoutFile(layout, filePath);
  });
};

export const updateTabAgentSessionId = (
  sessionName: string,
  provider: IAgentProvider,
  sessionId: string | null,
): Promise<void> =>
  shouldReadRuntimeStorageV2()
    ? getRuntimeSupervisor().patchTabStatusMetadata({ sessionName, agentSessionId: sessionId }).then(() => undefined)
    : mutateTab(sessionName, (tab) => {
    if (provider.readSessionId(tab) === sessionId) return false;
    provider.writeSessionId(tab, sessionId);
    return true;
  });

export const updateTabAgentSummary = (
  sessionName: string,
  provider: IAgentProvider,
  summary: string | null,
): Promise<void> =>
  shouldReadRuntimeStorageV2()
    ? getRuntimeSupervisor().patchTabStatusMetadata({ sessionName, agentSummary: summary }).then(() => undefined)
    : mutateTab(sessionName, (tab) => {
    if (provider.readSummary(tab) === summary) return false;
    provider.writeSummary(tab, summary);
    return true;
  });

export const updateTabAgentJsonlPath = (
  sessionName: string,
  provider: IAgentProvider,
  jsonlPath: string | null,
): Promise<void> =>
  shouldReadRuntimeStorageV2()
    ? getRuntimeSupervisor().patchTabStatusMetadata({ sessionName, agentJsonlPath: jsonlPath }).then(() => undefined)
    : mutateTab(sessionName, (tab) => {
    if (provider.readJsonlPath(tab) === jsonlPath) return false;
    provider.writeJsonlPath(tab, jsonlPath);
    return true;
  });

export const readTabAgentJsonlPath = async (
  sessionName: string,
  provider: IAgentProvider,
): Promise<string | null> => {
  if (shouldReadRuntimeStorageV2()) {
    const metadata = await getRuntimeSupervisor().getTabStatusMetadata({ sessionName });
    return metadata?.agentJsonlPath ?? null;
  }

  const parsed = parseSessionName(sessionName);
  if (!parsed) return null;

  const layout = await readLayoutFile(resolveLayoutFile(parsed.wsId));
  if (!layout) return null;

  const tab = collectAllTabs(layout.root).find((t) => t.sessionName === sessionName);
  return tab ? provider.readJsonlPath(tab) : null;
};

export const updateTabLastUserMessage = (
  sessionName: string,
  lastUserMessage: string | null,
): Promise<void> =>
  shouldReadRuntimeStorageV2()
    ? getRuntimeSupervisor().patchTabStatusMetadata({ sessionName, lastUserMessage }).then(() => undefined)
    : mutateTab(sessionName, (tab) => {
    if (tab.lastUserMessage === lastUserMessage) return false;
    tab.lastUserMessage = lastUserMessage;
    return true;
  });

export const updateTabCliStatus = (
  sessionName: string,
  cliState: TCliState,
  dismissedAt?: number | null,
): Promise<void> =>
  shouldReadRuntimeStorageV2()
    ? getRuntimeSupervisor().patchTabStatusMetadata({
      sessionName,
      cliState,
      ...(dismissedAt !== undefined ? { dismissedAt } : {}),
    }).then(() => undefined)
    : mutateTab(sessionName, (tab) => {
    if (tab.cliState === cliState && tab.dismissedAt === dismissedAt) return false;
    tab.cliState = cliState;
    tab.dismissedAt = dismissedAt;
    return true;
  });

const mutate = async (
  wsId: string,
  fn: (layout: ILayoutData) => ILayoutData | null,
): Promise<ILayoutData | null> =>
  withLock(async () => {
    const filePath = resolveLayoutFile(wsId);
    const layout = await readLayoutFile(filePath);
    if (!layout) return null;

    const result = fn(layout);
    if (!result) return null;

    result.updatedAt = new Date().toISOString();
    await writeLayoutFile(result, filePath);
    syncWorkspaceDirectories(wsId, result.root);
    return result;
  });

export const patchLayout = async (
  wsId: string,
  patch: { activePaneId?: string; ratioUpdate?: { path: number[]; ratio: number }; equalize?: boolean },
): Promise<ILayoutData | null> =>
  shouldReadRuntimeStorageV2()
    ? withLock(async () => {
      const result = await getRuntimeSupervisor().patchLayout({ workspaceId: wsId, ...patch });
      if (result) broadcastSync({ type: 'layout', workspaceId: wsId });
      return result;
    })
    : mutate(wsId, (layout) => {
    if (patch.activePaneId !== undefined) {
      const pane = findPane(layout.root, patch.activePaneId);
      if (!pane) return null;
      layout.activePaneId = patch.activePaneId;
    }
    if (patch.ratioUpdate) {
      layout.root = updateRatioAtPath(layout.root, patch.ratioUpdate.path, patch.ratioUpdate.ratio);
    }
    if (patch.equalize) {
      layout.root = equalizeNode(layout.root);
    }
    return layout;
  });

export const patchPane = async (
  wsId: string,
  paneId: string,
  patch: { activeTabId?: string },
): Promise<ILayoutData | null> =>
  shouldReadRuntimeStorageV2()
    ? withLock(async () => {
      const result = await getRuntimeSupervisor().patchPane({ workspaceId: wsId, paneId, ...patch });
      if (result) broadcastSync({ type: 'layout', workspaceId: wsId });
      return result;
    })
    : mutate(wsId, (layout) => {
    const pane = findPane(layout.root, paneId);
    if (!pane) return null;
    if (patch.activeTabId !== undefined) {
      if (!pane.tabs.some((t) => t.id === patch.activeTabId)) return null;
      pane.activeTabId = patch.activeTabId;
    }
    return layout;
  });

export const splitPaneInLayout = async (
  wsId: string,
  sourcePaneId: string,
  orientation: 'horizontal' | 'vertical',
  cwd?: string,
  panelType?: string,
): Promise<ILayoutData | null> => {
  if (shouldReadRuntimeStorageV2()) {
    const result = await getRuntimeSupervisor().splitPane({
      workspaceId: wsId,
      sourcePaneId,
      orientation,
      ...(cwd ? { cwd } : {}),
      ...(panelType ? { panelType: panelType as ITab['panelType'] } : {}),
    });
    if (result) broadcastSync({ type: 'layout', workspaceId: wsId });
    return result;
  }

  const isWebBrowser = panelType === 'web-browser';
  const paneId = generatePaneId();
  const tabId = generateTabId();
  const sessionName = workspaceSessionName(wsId, paneId, tabId);

  if (!isWebBrowser) {
    await createSession(sessionName, 80, 24, cwd);
  }

  const defaultName = isWebBrowser ? 'Web Browser' : '';
  const tab: ITab = { id: tabId, sessionName, name: defaultName, order: 0, ...(cwd ? { cwd } : {}) };
  if (panelType) tab.panelType = panelType as ITab['panelType'];

  const newPane: IPaneNode = { type: 'pane', id: paneId, tabs: [tab], activeTabId: tabId };

  const result = await mutate(wsId, (layout) => {
    const existing = findPane(layout.root, sourcePaneId);
    if (!existing) return null;
    const wasEqualized = isEqualized(layout.root);
    if (cwd) {
      const activeTab = existing.tabs.find((t) => t.id === existing.activeTabId);
      if (activeTab) activeTab.cwd = cwd;
    }
    const splitNode: TLayoutNode = {
      type: 'split',
      orientation,
      ratio: 50,
      children: [{ ...existing }, newPane],
    };
    layout.root = replacePane(layout.root, sourcePaneId, splitNode);
    if (wasEqualized) {
      layout.root = equalizeNode(layout.root);
    }
    layout.activePaneId = paneId;
    return layout;
  });

  if (!result && !isWebBrowser) {
    await killSession(sessionName).catch(() => {});
  }

  return result;
};

export const closePaneInLayout = async (wsId: string, paneId: string): Promise<ILayoutData | null> => {
  if (shouldReadRuntimeStorageV2()) {
    const result = await getRuntimeSupervisor().closePane({ workspaceId: wsId, paneId });
    if (result?.layout) broadcastSync({ type: 'layout', workspaceId: wsId });
    return result?.layout ?? null;
  }

  let tabs: ITab[] = [];

  const result = await withLock(async () => {
    const filePath = resolveLayoutFile(wsId);
    const layout = await readLayoutFile(filePath);
    if (!layout) return null;

    const pane = findPane(layout.root, paneId);
    if (!pane) return null;
    if (collectPanes(layout.root).length <= 1) return null;

    tabs = pane.tabs.filter((t) => t.panelType !== 'web-browser');
    const wasEqualized = isEqualized(layout.root);
    removePaneWithFocus(layout, paneId);
    if (wasEqualized) {
      layout.root = equalizeNode(layout.root);
    }
    layout.updatedAt = new Date().toISOString();
    await writeLayoutFile(layout, filePath);
    syncWorkspaceDirectories(wsId, layout.root);
    return layout;
  });

  await Promise.all(tabs.map((tab) => cleanupTabSession(tab).catch(() => {})));

  return result;
};

export const reorderTabsInPane = async (
  wsId: string,
  paneId: string,
  tabIds: string[],
): Promise<ILayoutData | null> =>
  shouldReadRuntimeStorageV2()
    ? withLock(async () => {
      const result = await getRuntimeSupervisor().reorderTabs({ workspaceId: wsId, paneId, tabIds });
      if (result) broadcastSync({ type: 'layout', workspaceId: wsId });
      return result;
    })
    : mutate(wsId, (layout) => {
    const pane = findPane(layout.root, paneId);
    if (!pane) return null;
    const tabMap = new Map(pane.tabs.map((t) => [t.id, t]));
    const reordered = tabIds
      .map((id, i) => {
        const t = tabMap.get(id);
        return t ? { ...t, order: i } : null;
      })
      .filter((t): t is ITab => t !== null);
    if (reordered.length !== pane.tabs.length) return null;
    pane.tabs = reordered;
    return layout;
  });

export const moveTabBetweenPanes = async (
  wsId: string,
  tabId: string,
  fromPaneId: string,
  toPaneId: string,
  toIndex: number,
): Promise<ILayoutData | null> => {
  if (shouldReadRuntimeStorageV2()) {
    const result = await getRuntimeSupervisor().moveTab({
      workspaceId: wsId,
      tabId,
      fromPaneId,
      toPaneId,
      toIndex,
    });
    if (result) broadcastSync({ type: 'layout', workspaceId: wsId });
    return result;
  }

  return mutate(wsId, (layout) => {
    const fromPane = findPane(layout.root, fromPaneId);
    const toPane = findPane(layout.root, toPaneId);
    if (!fromPane || !toPane) return null;

    const tabIdx = fromPane.tabs.findIndex((t) => t.id === tabId);
    if (tabIdx === -1) return null;

    const [tab] = fromPane.tabs.splice(tabIdx, 1);
    if (fromPane.activeTabId === tabId) {
      fromPane.activeTabId = fromPane.tabs[0]?.id ?? null;
    }
    fromPane.tabs.forEach((t, i) => { t.order = i; });

    toPane.tabs.splice(toIndex, 0, tab);
    toPane.tabs.forEach((t, i) => { t.order = i; });
    toPane.activeTabId = tabId;

    if (fromPane.tabs.length === 0 && collectPanes(layout.root).length > 1) {
      removePaneWithFocus(layout, fromPaneId);
    }

    layout.activePaneId = toPaneId;
    return layout;
  });
};

export const patchTab = async (
  wsId: string,
  paneId: string,
  tabId: string,
  patch: Partial<Pick<ITab, 'name' | 'panelType' | 'title' | 'cwd' | 'lastCommand' | 'webUrl' | 'terminalRatio' | 'terminalCollapsed'>>,
): Promise<ILayoutData | null> => {
  if (shouldReadRuntimeStorageV2()) {
    const result = await getRuntimeSupervisor().patchTab({ workspaceId: wsId, paneId, tabId, patch });
    if (result) broadcastSync({ type: 'layout', workspaceId: wsId });
    return result;
  }

  let authoritativeCwd: string | null | undefined;
  let authoritativeTitle: string | null | undefined;
  if (patch.cwd !== undefined || patch.title !== undefined) {
    const sessionName = await (async () => {
      const filePath = resolveLayoutFile(wsId);
      const layout = await readLayoutFile(filePath);
      if (!layout) return null;
      return findPane(layout.root, paneId)?.tabs.find((t) => t.id === tabId)?.sessionName ?? null;
    })();
    if (sessionName) {
      const { getSessionCwd, getPaneCurrentCommand } = await import('@/lib/tmux');
      const { formatTabTitle } = await import('@/lib/tab-title');
      if (patch.cwd !== undefined) {
        authoritativeCwd = await getSessionCwd(sessionName);
      }
      if (patch.title !== undefined) {
        const [cmd, cwd] = await Promise.all([
          getPaneCurrentCommand(sessionName),
          authoritativeCwd !== undefined ? Promise.resolve(authoritativeCwd) : getSessionCwd(sessionName),
        ]);
        if (cmd && cwd) {
          authoritativeTitle = formatTabTitle(`${cmd}|${cwd}`);
        }
      }
    }
  }

  return mutate(wsId, (layout) => {
    const pane = findPane(layout.root, paneId);
    if (!pane) return null;
    const tab = pane.tabs.find((t) => t.id === tabId);
    if (!tab) return null;
    const resolvedTitle = patch.title !== undefined ? (authoritativeTitle ?? patch.title) : undefined;
    if (patch.name !== undefined) tab.name = patch.name;
    if (patch.panelType !== undefined) tab.panelType = patch.panelType;
    if (resolvedTitle !== undefined) tab.title = resolvedTitle;
    if (patch.cwd !== undefined) tab.cwd = authoritativeCwd ?? patch.cwd;
    if (patch.lastCommand !== undefined) tab.lastCommand = patch.lastCommand;
    if (patch.webUrl !== undefined) tab.webUrl = patch.webUrl;
    if (patch.terminalRatio !== undefined) tab.terminalRatio = patch.terminalRatio;
    if (patch.terminalCollapsed !== undefined) tab.terminalCollapsed = patch.terminalCollapsed;
    return layout;
  });
};
