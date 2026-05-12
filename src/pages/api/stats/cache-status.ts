import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { collectAgentJsonlFiles } from '@/lib/stats/agent-jsonl-files';

const CACHE_PATH = path.join(os.homedir(), '.codexwinmux', 'stats', 'cache.json');

const countJsonlFiles = async (): Promise<number> => {
  const files = await collectAgentJsonlFiles();
  return files.length;
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method-not-allowed' });
  }

  try {
    await fs.access(CACHE_PATH);
    return res.status(200).json({ exists: true, fileCount: 0 });
  } catch {
    const fileCount = await countJsonlFiles();
    return res.status(200).json({ exists: false, fileCount });
  }
};

export default handler;
