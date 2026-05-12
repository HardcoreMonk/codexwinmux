import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { existsSync } from 'fs';
import { createLogger } from '@/lib/logger';
import type { ISessionStats } from '@/types/timeline';
import { collectAgentJsonlFiles, extractSessionIdFromAgentJsonlPath } from '@/lib/stats/agent-jsonl-files';

const log = createLogger('session-stats');

const SESSION_STATS_DIR = path.join(os.homedir(), '.codexwinmux', 'session-stats');

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isValidSessionId = (id: string): boolean => SESSION_ID_RE.test(id);

const statsFilePath = (sessionId: string): string =>
  path.join(SESSION_STATS_DIR, `${sessionId}.json`);

export const extractSessionIdFromJsonlPath = (jsonlPath: string): string | null => {
  const id = extractSessionIdFromAgentJsonlPath(jsonlPath);
  return id && isValidSessionId(id) ? id : null;
};

export const readSessionStats = async (sessionId: string): Promise<ISessionStats | null> => {
  if (!isValidSessionId(sessionId)) return null;
  try {
    const raw = await fs.readFile(statsFilePath(sessionId), 'utf-8');
    return JSON.parse(raw) as ISessionStats;
  } catch {
    return null;
  }
};

const writeRaw = async (stats: ISessionStats): Promise<void> => {
  await fs.mkdir(SESSION_STATS_DIR, { recursive: true });
  const target = statsFilePath(stats.sessionId);
  const tmp = `${target}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(stats), { mode: 0o600 });
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    log.debug({ err }, 'failed to write session stats');
  }
};

export const updateSessionStats = async (
  sessionId: string,
  patch: Partial<ISessionStats>,
): Promise<void> => {
  if (!isValidSessionId(sessionId)) return;
  const existing = (await readSessionStats(sessionId)) ?? { sessionId };
  await writeRaw({ ...existing, ...patch, sessionId });
};

export const writeSessionStats = (stats: ISessionStats): Promise<void> =>
  updateSessionStats(stats.sessionId, stats);

export const deleteSessionStats = async (sessionId: string): Promise<void> => {
  if (!isValidSessionId(sessionId)) return;
  await fs.unlink(statsFilePath(sessionId)).catch(() => {});
};

const listStatsSessionIds = async (): Promise<string[]> => {
  try {
    const files = await fs.readdir(SESSION_STATS_DIR);
    return files
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .filter(isValidSessionId);
  } catch {
    return [];
  }
};

const listJsonlSessionIds = async (): Promise<Set<string>> => {
  const ids = new Set<string>();
  const files = await collectAgentJsonlFiles();
  for (const file of files) {
    const id = extractSessionIdFromJsonlPath(file.filePath);
    if (id) ids.add(id);
  }
  return ids;
};

export const cleanupOrphanSessionStats = async (): Promise<void> => {
  if (!existsSync(SESSION_STATS_DIR)) return;
  try {
    const [statsIds, jsonlIds] = await Promise.all([listStatsSessionIds(), listJsonlSessionIds()]);
    const orphans = statsIds.filter((id) => !jsonlIds.has(id));
    if (orphans.length === 0) return;

    await Promise.all(orphans.map((id) => deleteSessionStats(id)));
    log.debug({ count: orphans.length }, 'removed orphan session stats');
  } catch (err) {
    log.debug({ err }, 'orphan cleanup failed');
  }
};
