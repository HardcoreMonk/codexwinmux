import type { NextApiRequest, NextApiResponse } from 'next';
import { removeTabFromPane, restartTabSession, patchTab } from '@/lib/layout-store';
import { getActiveWorkspaceId, getWorkspaceById } from '@/lib/workspace-store';
import { getStatusManager } from '@/lib/status-manager';
import { createLogger } from '@/lib/logger';
import { isRuntimeV2Enabled } from '@/lib/runtime/env';
import { getRuntimeStatusV2Mode } from '@/lib/runtime/status-mode';
import { getCoreRuntimeApi } from '@/lib/core-engine/runtime-api';
import type { ITab } from '@/types/terminal';
import { collectPanes } from '@/lib/layout-tree';
import { shouldReadRuntimeStorageV2 } from '@/lib/runtime/storage-read-owner';
import { resolveExistingDir } from '@/lib/tmux';
import { broadcastSync } from '@/lib/sync-server';

const log = createLogger('layout');

const shouldUseRuntimeStatusLive = (): boolean =>
  isRuntimeV2Enabled() && getRuntimeStatusV2Mode() === 'default';

const restartRuntimeStorageDefaultTab = async (
  wsId: string,
  paneId: string,
  tabId: string,
): Promise<boolean | null> => {
  if (!shouldReadRuntimeStorageV2()) return null;

  const runtime = getCoreRuntimeApi();
  await runtime.ensureStarted();
  const layout = await runtime.getLayout(wsId);
  if (!layout) return false;

  const pane = collectPanes(layout.root).find((item) => item.id === paneId);
  if (!pane) return false;

  const tab = pane.tabs.find((item) => item.id === tabId);
  if (!tab || tab.runtimeVersion !== 2) return false;

  const workspace = await getWorkspaceById(wsId);
  const effectiveCwd = await resolveExistingDir(tab.cwd ?? workspace?.directories[0]);
  await runtime.restartTerminalTab({
    workspaceId: wsId,
    paneId,
    tabId,
    sessionName: tab.sessionName,
    cwd: effectiveCwd,
    ensureWorkspacePane: {
      workspaceName: workspace?.name ?? wsId,
      defaultCwd: workspace?.directories[0] ?? effectiveCwd,
    },
  });
  broadcastSync({ type: 'layout', workspaceId: wsId });
  return true;
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  const wsId = (req.query.workspace as string) || await getActiveWorkspaceId();
  if (!wsId) {
    return res.status(400).json({ error: 'No workspace found' });
  }

  const paneId = req.query.paneId as string;
  const tabId = req.query.tabId as string;

  if (req.method === 'DELETE') {
    const found = await removeTabFromPane(wsId, paneId, tabId);
    if (!found) {
      return res.status(404).json({ error: 'Tab not found' });
    }
    if (shouldUseRuntimeStatusLive()) {
      getCoreRuntimeApi().removeStatusLiveTab({ tabId }).catch((err) => {
        log.warn(`runtime status remove tab failed: ${err instanceof Error ? err.message : err}`);
      });
    } else {
      getStatusManager().removeTab(tabId);
    }
    return res.status(204).end();
  }

  if (req.method === 'POST') {
    try {
      const { command } = req.body ?? {};
      const runtimeRestarted = await restartRuntimeStorageDefaultTab(wsId, paneId, tabId);
      if (runtimeRestarted !== null) {
        if (!runtimeRestarted) {
          return res.status(404).json({ error: 'Tab not found' });
        }
        return res.status(200).json({ ok: true });
      }
      const ok = await restartTabSession(wsId, paneId, tabId, command);
      if (!ok) {
        return res.status(404).json({ error: 'Tab not found' });
      }
      return res.status(200).json({ ok: true });
    } catch (err) {
      log.error(`tab restart failed: ${err instanceof Error ? err.message : err}`);
      return res.status(500).json({ error: 'Failed to restart session' });
    }
  }

  if (req.method === 'PATCH') {
    const { name, panelType, title, cwd, lastCommand, webUrl, terminalRatio, terminalCollapsed } = req.body ?? {};

    if (
      name !== undefined ||
      panelType !== undefined ||
      title !== undefined ||
      cwd !== undefined ||
      lastCommand !== undefined ||
      webUrl !== undefined ||
      terminalRatio !== undefined ||
      terminalCollapsed !== undefined
    ) {
      const patch: Partial<Pick<ITab, 'name' | 'panelType' | 'title' | 'cwd' | 'lastCommand' | 'webUrl' | 'terminalRatio' | 'terminalCollapsed'>> = {};
      if (name !== undefined) {
        if (typeof name !== 'string') {
          return res.status(400).json({ error: 'name must be a string' });
        }
        patch.name = name.trim();
      }
      if (panelType !== undefined) patch.panelType = panelType;
      if (title !== undefined) patch.title = title;
      if (cwd !== undefined) patch.cwd = cwd;
      if (lastCommand !== undefined) patch.lastCommand = lastCommand;
      if (webUrl !== undefined) patch.webUrl = webUrl;
      if (terminalRatio !== undefined) {
        if (typeof terminalRatio !== 'number' || !Number.isFinite(terminalRatio)) {
          return res.status(400).json({ error: 'terminalRatio must be a number' });
        }
        patch.terminalRatio = Math.max(0, Math.min(100, terminalRatio));
      }
      if (terminalCollapsed !== undefined) {
        if (typeof terminalCollapsed !== 'boolean') {
          return res.status(400).json({ error: 'terminalCollapsed must be a boolean' });
        }
        patch.terminalCollapsed = terminalCollapsed;
      }

      const result = await patchTab(wsId, paneId, tabId, patch);
      if (!result) {
        return res.status(404).json({ error: 'Tab not found' });
      }
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: 'No fields to update' });
  }

  res.setHeader('Allow', 'POST, DELETE, PATCH');
  return res.status(405).json({ error: 'Method not allowed' });
};

export default handler;
