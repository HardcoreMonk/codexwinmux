import os from 'os';
import type { NextApiRequest, NextApiResponse } from 'next';
import { addExistingTabToPane, addTabToPane, updateTabAgentSessionId } from '@/lib/layout-store';
import { getActiveWorkspaceId, getWorkspaceById } from '@/lib/workspace-store';
import { getStatusManager } from '@/lib/status-manager';
import { getProviderByPanelType } from '@/lib/providers';
import { sendKeys } from '@/lib/tmux';
import { createLogger } from '@/lib/logger';
import { isRuntimeV2Enabled } from '@/lib/runtime/env';
import { shouldCreateTerminalTabInRuntimeV2 } from '@/lib/runtime/terminal-mode';
import { getCoreRuntimeApi } from '@/lib/core-engine/runtime-api';
import { getRuntimeStatusV2Mode } from '@/lib/runtime/status-mode';
import { shouldReadRuntimeStorageV2 } from '@/lib/runtime/storage-read-owner';
import { broadcastSync } from '@/lib/sync-server';

const log = createLogger('layout');

const SHELL_READY_DELAY_MS = 500;

const shouldUseRuntimeStatusLive = (): boolean =>
  isRuntimeV2Enabled() && getRuntimeStatusV2Mode() === 'default';

const isPlainTerminalTabRequest = (input: {
  panelType?: unknown;
  command?: unknown;
  resumeSessionId?: unknown;
}): boolean => {
  if (input.command || input.resumeSessionId) return false;
  return input.panelType === undefined || input.panelType === null || input.panelType === '' || input.panelType === 'terminal';
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const wsId = (req.query.workspace as string) || await getActiveWorkspaceId();
  if (!wsId) {
    return res.status(400).json({ error: 'No workspace found' });
  }

  const paneId = req.query.paneId as string;
  const { name, cwd, panelType, command, resumeSessionId } = req.body ?? {};

  const provider = resumeSessionId ? getProviderByPanelType(panelType ?? 'codex') : null;
  if (resumeSessionId) {
    if (!provider) {
      return res.status(400).json({ error: 'Unknown panel type for resume' });
    }
    if (!provider.isValidSessionId(resumeSessionId)) {
      return res.status(400).json({ error: 'Invalid session ID format' });
    }
  }

  try {
    const shouldUseRuntimeV2 = shouldCreateTerminalTabInRuntimeV2() && isPlainTerminalTabRequest({
      panelType,
      command,
      resumeSessionId,
    });
    const workspace = shouldUseRuntimeV2 ? await getWorkspaceById(wsId) : null;
    const effectiveCwd = typeof cwd === 'string' && cwd.trim()
      ? cwd.trim()
      : workspace?.directories[0] ?? os.homedir();
    const tab = shouldUseRuntimeV2
      ? await (async () => {
          const runtime = getCoreRuntimeApi();
          await runtime.ensureStarted();
          const runtimeTab = await runtime.createTerminalTab({
            workspaceId: wsId,
            paneId,
            cwd: effectiveCwd,
            ensureWorkspacePane: {
              workspaceName: workspace?.name ?? wsId,
              defaultCwd: workspace?.directories[0] ?? effectiveCwd,
            },
          });
          if (shouldReadRuntimeStorageV2()) {
            broadcastSync({ type: 'layout', workspaceId: wsId });
            return runtimeTab;
          }

          const added = await addExistingTabToPane(wsId, paneId, {
            id: runtimeTab.id,
            sessionName: runtimeTab.sessionName,
            name: typeof name === 'string' ? name.trim() : runtimeTab.name,
            order: runtimeTab.order,
            cwd: runtimeTab.cwd ?? effectiveCwd,
            panelType: 'terminal',
            runtimeVersion: 2,
          });
          if (!added) {
            await Promise.resolve(runtime.deleteTerminalTab(runtimeTab.id)).catch((err) => {
              log.warn(`runtime v2 tab rollback failed: ${err instanceof Error ? err.message : err}`);
            });
          }
          return added;
        })()
      : await addTabToPane(wsId, paneId, name, cwd, panelType, command);
    if (!tab) {
      return res.status(404).json({ error: 'Pane not found' });
    }
    if (tab.panelType !== 'web-browser') {
      const statusEntry = {
        cliState: 'inactive',
        workspaceId: wsId,
        tabName: tab.name,
        tmuxSession: tab.sessionName,
        lastEvent: null,
        eventSeq: 0,
      } as const;
      if (shouldUseRuntimeStatusLive()) {
        getCoreRuntimeApi().registerStatusLiveTab({ tabId: tab.id, entry: statusEntry }).catch((err) => {
          log.warn(`runtime status register tab failed: ${err instanceof Error ? err.message : err}`);
        });
      } else {
        getStatusManager().registerTab(tab.id, statusEntry);
      }
    }

    if (resumeSessionId && provider && !command) {
      await updateTabAgentSessionId(tab.sessionName, provider, resumeSessionId);
      provider.writeSessionId(tab, resumeSessionId);
      setTimeout(async () => {
        try {
          const resumeCmd = await provider.buildResumeCommand(resumeSessionId, { workspaceId: wsId });
          await sendKeys(tab.sessionName, resumeCmd);
        } catch (err) {
          log.warn(`resume sendKeys failed: ${err instanceof Error ? err.message : err}`);
        }
      }, SHELL_READY_DELAY_MS);
    }

    return res.status(200).json(tab);
  } catch (err) {
    log.error(`tab creation failed: ${err instanceof Error ? err.message : err}`);
    return res.status(500).json({ error: 'Failed to create tab' });
  }
};

export default handler;
