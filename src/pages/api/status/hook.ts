import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCliToken } from '@/lib/cli-token';
import { getStatusManager } from '@/lib/status-manager';
import { createLogger } from '@/lib/logger';
import { isRuntimeV2Enabled } from '@/lib/runtime/env';
import { getRuntimeStatusV2Mode } from '@/lib/runtime/status-mode';
import { getCoreRuntimeApi } from '@/lib/core-engine/runtime-api';

const log = createLogger('hooks');

const shouldUseRuntimeStatusLive = (): boolean =>
  isRuntimeV2Enabled() && getRuntimeStatusV2Mode() === 'default';

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyCliToken(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { event, session, notificationType } = req.body ?? {};
  if (typeof event === 'string' && event !== 'poll' && typeof session === 'string' && session) {
    const type = typeof notificationType === 'string' && notificationType ? notificationType : undefined;
    log.debug({ event, session, notificationType: type }, `received ${event}${type ? `(${type})` : ''}`);
    if (shouldUseRuntimeStatusLive()) {
      try {
        await getCoreRuntimeApi().sendStatusLiveHookEvent({ tmuxSession: session, event, ...(type ? { notificationType: type } : {}) });
        return res.status(204).end();
      } catch (err) {
        log.warn('runtime status hook failed, falling back: %s', err instanceof Error ? err.message : String(err));
      }
    }
    getStatusManager().updateTabFromHook(session, event, type);
  } else {
    log.debug({ body: req.body }, 'poll trigger');
    if (shouldUseRuntimeStatusLive()) {
      try {
        await getCoreRuntimeApi().pollStatusLive();
        return res.status(204).end();
      } catch (err) {
        log.warn('runtime status poll failed, falling back: %s', err instanceof Error ? err.message : String(err));
      }
    }
    getStatusManager().poll().catch((err) => {
      log.error({ err }, 'Poll trigger failed');
    });
  }

  return res.status(204).end();
};

export default handler;
