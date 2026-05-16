import type { NextApiRequest, NextApiResponse } from 'next';
import { isAllowedJsonlPath } from '@/lib/path-validation';
import { getProviderByPanelType } from '@/lib/providers';
import { sendRuntimeApiError } from '@/lib/runtime/api-handler';
import { getCoreRuntimeApi } from '@/lib/core-engine/runtime-api';
import { shouldUseRuntimeTimelineV2Reads } from '@/lib/runtime/timeline-mode';

const DEFAULT_LIMIT = 64;
const MAX_LIMIT = 200;

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const jsonlPath = req.query.jsonlPath as string;
  if (!jsonlPath) {
    return res.status(400).json({ error: 'jsonlPath parameter required' });
  }

  if (!isAllowedJsonlPath(jsonlPath)) {
    return res.status(403).json({ error: 'Path not allowed' });
  }

  const beforeByte = parseInt(req.query.beforeByte as string, 10);
  if (isNaN(beforeByte) || beforeByte < 0) {
    return res.status(400).json({ error: 'beforeByte parameter required' });
  }

  const limit = parseInt(req.query.limit as string, 10) || DEFAULT_LIMIT;
  const panelType = typeof req.query.panelType === 'string' ? req.query.panelType : 'codex';
  const provider = getProviderByPanelType(panelType);
  if (!provider) {
    return res.status(400).json({ error: 'Unknown panel type' });
  }

  if (shouldUseRuntimeTimelineV2Reads()) {
    try {
      const result = await getCoreRuntimeApi().readTimelineEntriesBefore({
        jsonlPath,
        beforeByte,
        limit: Math.min(MAX_LIMIT, Math.max(1, limit)),
        panelType,
      });
      return res.status(200).json(result);
    } catch (err) {
      return sendRuntimeApiError(res, err);
    }
  }

  const result = await provider.readEntriesBefore(jsonlPath, beforeByte, limit);

  return res.status(200).json({
    entries: result.entries,
    startByteOffset: result.startByteOffset,
    hasMore: result.hasMore,
  });
};

export default handler;
