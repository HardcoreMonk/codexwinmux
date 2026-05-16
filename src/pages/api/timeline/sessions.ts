import type { NextApiRequest, NextApiResponse } from 'next';
import { hasSession } from '@/lib/tmux';
import { listSessionPage } from '@/lib/session-list';
import { isAgentPanelType, normalizePanelType } from '@/lib/panel-type';
import { sendRuntimeApiError } from '@/lib/runtime/api-handler';
import { getCoreRuntimeApi } from '@/lib/core-engine/runtime-api';
import { shouldUseRuntimeTimelineV2Reads } from '@/lib/runtime/timeline-mode';
import type { TPanelType } from '@/types/terminal';

const DEFAULT_LIMIT = 50;
const parsePanelType = (value: string | string[] | undefined): TPanelType => {
  const candidate = Array.isArray(value) ? value[0] : value;
  return normalizePanelType(candidate) ?? 'codex';
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const tmuxSession = req.query.tmuxSession as string | undefined;
  if (!tmuxSession) {
    return res.status(400).json({ error: 'missing-param', message: 'tmuxSession parameter required' });
  }

  const limit = Math.max(1, parseInt(req.query.limit as string, 10) || DEFAULT_LIMIT);
  const offset = Math.max(0, parseInt(req.query.offset as string, 10) || 0);

  const cwdHint = req.query.cwd as string | undefined;
  const panelType = parsePanelType(req.query.panelType);

  if (!isAgentPanelType(panelType)) {
    const exists = await hasSession(tmuxSession);
    if (!exists) {
      return res.status(404).json({ error: 'tmux-session-not-found', message: `tmux session '${tmuxSession}' not found` });
    }
  }

  if (shouldUseRuntimeTimelineV2Reads()) {
    try {
      const page = await getCoreRuntimeApi().listTimelineSessions({
        tmuxSession,
        cwd: cwdHint,
        panelType,
        offset,
        limit,
      });
      return res.status(200).json(page);
    } catch (err) {
      return sendRuntimeApiError(res, err);
    }
  }

  try {
    const page = await listSessionPage(tmuxSession, cwdHint, panelType, {
      offset,
      limit,
    });
    return res.status(200).json(page);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    if (message === 'cwd-lookup-failed') {
      return res.status(500).json({ error: 'cwd-lookup-failed', message: 'Failed to get cwd from tmux session' });
    }
    return res.status(500).json({ error: 'internal-error', message });
  }
};

export default handler;
