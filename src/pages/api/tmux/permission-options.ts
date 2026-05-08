import type { NextApiRequest, NextApiResponse } from 'next';
import { hasSession } from '@/lib/tmux';
import { capturePaneAtWidth } from '@/lib/capture-at-width';
import { createLogger } from '@/lib/logger';
import { createEmptyApprovalPromptMetadata, parsePermissionOptions } from '@/lib/permission-prompt';

const log = createLogger('tmux');

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = req.query.session as string | undefined;
  if (!session) {
    return res.status(400).json({ error: 'session parameter required' });
  }

  const exists = await hasSession(session);
  if (!exists) {
    return res.status(404).json({ error: 'Session not found' });
  }

  try {
    const content = await capturePaneAtWidth(session, 120, 50);
    if (!content) {
      return res.status(200).json({
        options: [],
        focusedIndex: 0,
        captureEmpty: true,
        metadata: createEmptyApprovalPromptMetadata(),
      });
    }

    const { options, focusedIndex, metadata } = parsePermissionOptions(content);
    const isBypassPrompt = content.includes('Bypass Permissions');
    return res.status(200).json({
      options,
      focusedIndex,
      metadata,
      ...(isBypassPrompt && { isBypassPrompt: true }),
    });
  } catch (err) {
    log.error(`permission-options query failed: ${err instanceof Error ? err.name : 'unknown error'}`);
    return res.status(200).json({
      options: [],
      focusedIndex: 0,
      captureEmpty: false,
      captureFailed: true,
      fallbackReason: 'capture-failed',
      metadata: createEmptyApprovalPromptMetadata(),
    });
  }
};

export default handler;
