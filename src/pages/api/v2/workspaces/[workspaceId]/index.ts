import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { verifyRuntimeV2ApiAuth } from '@/lib/runtime/api-auth';
import { parseRuntimeApiBody, sendRuntimeApiError, sendRuntimeDisabled } from '@/lib/runtime/api-handler';
import { isRuntimeV2Enabled } from '@/lib/runtime/env';
import { getCoreRuntimeApi } from '@/lib/core-engine/runtime-api';
import { broadcastSync } from '@/lib/sync-server';

const querySchema = z.object({
  workspaceId: z.string().min(1),
});

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (!isRuntimeV2Enabled()) {
    return sendRuntimeDisabled(res);
  }

  if (!(await verifyRuntimeV2ApiAuth(req))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'DELETE') {
    res.setHeader('Allow', 'DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { workspaceId } = parseRuntimeApiBody(querySchema, req.query);
    const runtime = getCoreRuntimeApi();
    await runtime.ensureStarted();
    const result = await runtime.deleteWorkspace(workspaceId);
    if (result.deleted) broadcastSync({ type: 'workspace' });
    return res.status(200).json(result);
  } catch (err) {
    return sendRuntimeApiError(res, err);
  }
};

export default handler;
