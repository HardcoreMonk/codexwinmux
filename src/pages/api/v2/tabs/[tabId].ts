import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { verifyRuntimeV2ApiAuth } from '@/lib/runtime/api-auth';
import { parseRuntimeApiBody, sendRuntimeApiError, sendRuntimeDisabled } from '@/lib/runtime/api-handler';
import { isRuntimeV2Enabled } from '@/lib/runtime/env';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';

const querySchema = z.object({
  tabId: z.string().min(1),
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
    const { tabId } = parseRuntimeApiBody(querySchema, req.query);
    const supervisor = getRuntimeSupervisor();
    await supervisor.ensureStarted();
    const result = await supervisor.deleteTerminalTab(tabId);
    return res.status(200).json(result);
  } catch (err) {
    return sendRuntimeApiError(res, err);
  }
};

export default handler;
