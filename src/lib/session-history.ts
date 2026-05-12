import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createLogger } from '@/lib/logger';
import type { ISessionHistoryEntry, ISessionHistoryData } from '@/types/session-history';

const log = createLogger('session-history');

const MAX_ENTRIES = 200;
const BASE_DIR = path.join(os.homedir(), '.codexwinmux');
const SESSION_HISTORY_FILE = path.join(BASE_DIR, 'session-history.json');

const g = globalThis as unknown as {
  __codexmuxSessionHistoryLock?: Promise<void>;
  __codexmuxSessionHistoryContentCache?: string;
};
if (!g.__codexmuxSessionHistoryLock) g.__codexmuxSessionHistoryLock = Promise.resolve();

const withLock = async <T>(fn: () => Promise<T>): Promise<T> => {
  let release: () => void;
  const next = new Promise<void>((r) => {
    release = r;
  });
  const prev = g.__codexmuxSessionHistoryLock!;
  g.__codexmuxSessionHistoryLock = next;
  await prev;
  try {
    return await fn();
  } finally {
    release!();
  }
};

const emptyData = (): ISessionHistoryData => ({ version: 1, entries: [] });

export const normalizeSessionHistoryData = (data: ISessionHistoryData): ISessionHistoryData => ({
  version: 1,
  entries: data.entries.map((entry) => ({
    ...entry,
    agentSessionId: entry.agentSessionId ?? null,
  })),
});

const readSessionHistory = async (): Promise<ISessionHistoryData> => {
  let raw: string;
  try {
    raw = await fs.readFile(SESSION_HISTORY_FILE, 'utf-8');
  } catch {
    return emptyData();
  }
  try {
    return normalizeSessionHistoryData(JSON.parse(raw) as ISessionHistoryData);
  } catch {
    log.warn('Failed to parse session-history.json, starting empty');
    try {
      await fs.copyFile(SESSION_HISTORY_FILE, SESSION_HISTORY_FILE.replace(/\.json$/, '.json.bak'));
    } catch {}
    return emptyData();
  }
};

const writeSessionHistory = async (data: ISessionHistoryData): Promise<void> => {
  const contentKey = JSON.stringify(data.entries);
  if (g.__codexmuxSessionHistoryContentCache === contentKey) return;

  const tmpFile = SESSION_HISTORY_FILE + '.tmp';
  try {
    await fs.writeFile(tmpFile, JSON.stringify(data, null, 2), { mode: 0o600 });
    await fs.rename(tmpFile, SESSION_HISTORY_FILE);
  } catch (err) {
    await fs.unlink(tmpFile).catch(() => {});
    throw err;
  }

  g.__codexmuxSessionHistoryContentCache = contentKey;
};

export const addSessionHistoryEntry = async (entry: ISessionHistoryEntry): Promise<void> => {
  await withLock(async () => {
    const data = await readSessionHistory();
    data.entries.unshift(entry);
    if (data.entries.length > MAX_ENTRIES) {
      data.entries = data.entries.slice(0, MAX_ENTRIES);
    }
    await writeSessionHistory(data);
  });
};

export const updateSessionHistoryDismissedAt = async (
  tabId: string,
  dismissedAt: number,
): Promise<ISessionHistoryEntry | null> => {
  return await withLock(async () => {
    const data = await readSessionHistory();
    const entry = data.entries.find((e) => e.tabId === tabId && e.dismissedAt === null);
    if (!entry) return null;
    entry.dismissedAt = dismissedAt;
    await writeSessionHistory(data);
    return entry;
  });
};

export const getSessionHistory = async (): Promise<ISessionHistoryEntry[]> => {
  const data = await readSessionHistory();
  return data.entries;
};
