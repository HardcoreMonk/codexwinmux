import type { NextApiRequest, NextApiResponse } from 'next';
import { stat } from 'fs/promises';
import { isAllowedJsonlPath } from '@/lib/path-validation';
import { getPerfNow, recordPerfCounter, recordPerfDuration } from '@/lib/perf-metrics';
import { sendRuntimeApiError } from '@/lib/runtime/api-handler';
import { getCoreRuntimeApi } from '@/lib/core-engine/runtime-api';
import { shouldUseRuntimeTimelineV2Reads } from '@/lib/runtime/timeline-mode';
import { countTimelineMessages, emptyMessageCounts, type IMessageCountResult } from '@/lib/timeline-message-counts';

interface ICacheEntry {
  counts: IMessageCountResult;
  mtime: number;
  size: number;
}

const CACHE_LIMIT = 100;

const g = globalThis as unknown as { __cmuxMessageCountsCache?: Map<string, ICacheEntry> };
if (!g.__cmuxMessageCountsCache) g.__cmuxMessageCountsCache = new Map();
const cache = g.__cmuxMessageCountsCache;

const cacheGet = (key: string, mtime: number, size: number): IMessageCountResult | null => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.mtime !== mtime || entry.size !== size) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.counts;
};

const cacheSet = (key: string, counts: IMessageCountResult, mtime: number, size: number) => {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, { counts, mtime, size });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
};

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

  if (shouldUseRuntimeTimelineV2Reads()) {
    try {
      const counts = await getCoreRuntimeApi().getTimelineMessageCounts(jsonlPath);
      return res.status(200).json(counts);
    } catch (err) {
      return sendRuntimeApiError(res, err);
    }
  }

  try {
    const st = await stat(jsonlPath);
    const mtime = Math.floor(st.mtimeMs);
    const size = st.size;

    const cached = cacheGet(jsonlPath, mtime, size);
    if (cached) {
      recordPerfCounter('timeline.message_counts.cache_hit');
      return res.status(200).json(cached);
    }

    recordPerfCounter('timeline.message_counts.cache_miss');
    const startedAt = getPerfNow();
    const counts = await countTimelineMessages(jsonlPath);
    recordPerfDuration('timeline.message_counts.read', getPerfNow() - startedAt);
    cacheSet(jsonlPath, counts, mtime, size);
    return res.status(200).json(counts);
  } catch {
    recordPerfCounter('timeline.message_counts.error');
    return res.status(200).json(emptyMessageCounts());
  }
};

export default handler;
