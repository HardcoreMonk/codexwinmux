import os from 'os';
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { verifyRuntimeV2ApiAuth } from '@/lib/runtime/api-auth';
import { parseRuntimeApiBody, sendRuntimeApiError, sendRuntimeDisabled } from '@/lib/runtime/api-handler';
import { isRuntimeV2Enabled } from '@/lib/runtime/env';
import { getCoreRuntimeApi } from '@/lib/core-engine/runtime-api';
import { broadcastSync } from '@/lib/sync-server';

const createTabBodySchema = z.object({
  workspaceId: z.string().min(1),
  paneId: z.string().min(1),
  cwd: z.string().trim().min(1).optional(),
});

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (!isRuntimeV2Enabled()) {
    return sendRuntimeDisabled(res);
  }

  if (!(await verifyRuntimeV2ApiAuth(req))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = parseRuntimeApiBody(createTabBodySchema, req.body ?? {});
    const runtime = getCoreRuntimeApi();
    await runtime.ensureStarted();
    const tab = await runtime.createTerminalTab({
      workspaceId: body.workspaceId,
      paneId: body.paneId,
      cwd: body.cwd ?? os.homedir(),
    });
    broadcastSync({ type: 'layout', workspaceId: body.workspaceId });
    return res.status(200).json(tab);
  } catch (err) {
    return sendRuntimeApiError(res, err);
  }
};

export default handler;
