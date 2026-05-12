import type { NextApiRequest, NextApiResponse } from 'next';
import { isAllowedJsonlPath } from '@/lib/path-validation';
import { verifyRuntimeV2ApiAuth } from '@/lib/runtime/api-auth';
import { sendRuntimeApiError, sendRuntimeDisabled } from '@/lib/runtime/api-handler';
import { isRuntimeV2Enabled } from '@/lib/runtime/env';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';

const firstQueryValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

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

  const jsonlPath = firstQueryValue(req.query.jsonlPath);
  if (!jsonlPath) {
    return res.status(400).json({ error: 'jsonlPath parameter required' });
  }

  if (!isAllowedJsonlPath(jsonlPath)) {
    return res.status(403).json({ error: 'Path not allowed' });
  }

  try {
    const supervisor = getRuntimeSupervisor();
    const counts = await supervisor.getTimelineMessageCounts(jsonlPath);
    return res.status(200).json(counts);
  } catch (err) {
    return sendRuntimeApiError(res, err);
  }
};

export default handler;
