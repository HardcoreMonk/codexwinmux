import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyRuntimeV2ApiAuth } from '@/lib/runtime/api-auth';
import { sendRuntimeApiError, sendRuntimeDisabled } from '@/lib/runtime/api-handler';
import { isRuntimeV2Enabled } from '@/lib/runtime/env';
import { getCoreRuntimeApi } from '@/lib/core-engine/runtime-api';
import { getRuntimeTerminalV2Mode } from '@/lib/runtime/terminal-mode';
import { getRuntimeStorageV2Mode } from '@/lib/runtime/storage-mode';
import { getRuntimeTimelineV2Mode } from '@/lib/runtime/timeline-mode';
import { getRuntimeStatusV2Mode } from '@/lib/runtime/status-mode';

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (!isRuntimeV2Enabled()) {
    return sendRuntimeDisabled(res);
  }

  if (!(await verifyRuntimeV2ApiAuth(req))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const runtime = getCoreRuntimeApi();
    await runtime.ensureStarted();
    const health = await runtime.health();
    return res.status(200).json({
      ...health,
      terminalV2Mode: getRuntimeTerminalV2Mode(),
      storageV2Mode: getRuntimeStorageV2Mode(),
      timelineV2Mode: getRuntimeTimelineV2Mode(),
      statusV2Mode: getRuntimeStatusV2Mode(),
    });
  } catch (err) {
    return sendRuntimeApiError(res, err);
  }
};

export default handler;
