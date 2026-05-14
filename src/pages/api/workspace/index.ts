import os from 'os';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getWorkspaces, createWorkspace } from '@/lib/workspace-store';
import { readLayoutFile, resolveLayoutFile, collectAllTabs, updateTabAgentSessionId } from '@/lib/layout-store';
import { getProviderByPanelType } from '@/lib/providers';
import { sendKeys } from '@/lib/tmux';
import { getStatusManager } from '@/lib/status-manager';
import { createLogger } from '@/lib/logger';
import { isRuntimeV2Enabled } from '@/lib/runtime/env';
import { getRuntimeStatusV2Mode } from '@/lib/runtime/status-mode';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';

const log = createLogger('workspace-api');

const SHELL_READY_DELAY_MS = 500;

const shouldUseRuntimeStatusLive = (): boolean =>
  isRuntimeV2Enabled() && getRuntimeStatusV2Mode() === 'default';

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const data = await getWorkspaces();
    return res.status(200).json(data);
  }

  if (req.method === 'POST') {
    const { directory, name, resumeSessionId, panelType } = req.body ?? {};
    const provider = resumeSessionId ? getProviderByPanelType(panelType ?? 'codex') : null;
    if (resumeSessionId) {
      if (!provider) {
        return res.status(400).json({ error: 'Unknown panel type for resume' });
      }
      if (!provider.isValidSessionId(resumeSessionId)) {
        return res.status(400).json({ error: 'Invalid session ID format' });
      }
    }
    const resolvedDirectory =
      directory && typeof directory === 'string' ? directory : os.homedir();

    try {
      const layoutOptions = provider ? { panelType: provider.panelType } : undefined;
      const workspace = await createWorkspace(resolvedDirectory, name, layoutOptions);

      const layout = await readLayoutFile(resolveLayoutFile(workspace.id));
      const defaultTab = layout ? collectAllTabs(layout.root)[0] : null;

      if (defaultTab && defaultTab.panelType !== 'web-browser') {
        const statusEntry = {
          cliState: 'inactive',
          workspaceId: workspace.id,
          tabName: defaultTab.name,
          tmuxSession: defaultTab.sessionName,
          lastEvent: null,
          eventSeq: 0,
        } as const;
        if (shouldUseRuntimeStatusLive()) {
          getRuntimeSupervisor().registerStatusLiveTab({ tabId: defaultTab.id, entry: statusEntry }).catch((err) => {
            log.warn(`runtime status register tab failed: ${err instanceof Error ? err.message : err}`);
          });
        } else {
          getStatusManager().registerTab(defaultTab.id, statusEntry);
        }
      }

      if (resumeSessionId && provider && defaultTab) {
        await updateTabAgentSessionId(defaultTab.sessionName, provider, resumeSessionId);
        provider.writeSessionId(defaultTab, resumeSessionId);
        setTimeout(async () => {
          try {
            const resumeCmd = await provider.buildResumeCommand(resumeSessionId, { workspaceId: workspace.id });
            await sendKeys(defaultTab.sessionName, resumeCmd);
          } catch (err) {
            log.warn(`resume sendKeys failed: ${err instanceof Error ? err.message : err}`);
          }
        }, SHELL_READY_DELAY_MS);
      }

      return res.status(200).json(workspace);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      const isValidation = ['not exist', 'directory', 'registered'].some((k) => message.includes(k));
      return res.status(isValidation ? 400 : 500).json({ error: message });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
};

export default handler;
