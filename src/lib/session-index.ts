import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import readline from 'readline';
import os from 'os';
import { createLogger } from '@/lib/logger';
import { shouldUseRuntimeTimelineV2Reads, type IRuntimeTimelineV2ModeOptions } from '@/lib/runtime/timeline-mode';
import type { ISessionMeta } from '@/types/timeline';

const log = createLogger('session-index');

const MAX_CONCURRENCY = 8;
const MAX_FIRST_MESSAGE_LENGTH = 200;
const REFRESH_INTERVAL_MS = 15_000;
const CODEX_THREAD_ID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

interface IIndexedSessionMeta extends ISessionMeta {
  indexKey: string;
  indexJsonlPath: string;
  indexMtimeMs: number;
  indexSize: number;
}

interface ISessionIndexFile {
  version: 1;
  updatedAt: string;
  sessions: IIndexedSessionMeta[];
}

interface ISessionIndexState {
  rootKey: string;
  initialized: boolean;
  sessions: IIndexedSessionMeta[];
  refreshedAt: number;
  refreshPromise: Promise<void> | null;
  refreshTimer: ReturnType<typeof setInterval> | null;
  refreshDebounceTimer: ReturnType<typeof setTimeout> | null;
  lastError: string | null;
  lastBuildMs: number;
  indexedFiles: number;
  cacheHits: number;
  cacheMisses: number;
  persistContentKey: string;
  persistWrites: number;
  persistSkips: number;
  lastPersistedAt: number;
}

interface ICodexJsonlScanResult {
  sessionId: string | null;
  cwd: string | null;
  startedAt: string | null;
  firstMessage: string;
  turnCount: number;
}

export interface IIndexedCodexSessionJsonl {
  sessionId: string;
  jsonlPath: string;
  cwd: string | null;
  startedAt: number | null;
  mtimeMs: number;
}

export interface ISessionIndexPage {
  sessions: ISessionMeta[];
  total: number;
  hasMore: boolean;
}

export interface ISessionIndexPageOptions {
  waitForInitial?: boolean;
  offset?: number;
  limit?: number;
}

export const shouldPrewarmSessionIndexOnStartup = (
  options?: IRuntimeTimelineV2ModeOptions,
): boolean => !shouldUseRuntimeTimelineV2Reads(options);

const getHomeDir = (): string =>
  process.env.HOME || process.env.USERPROFILE || os.homedir() || '/';

const getCodexSessionsDir = (): string =>
  path.join(getHomeDir(), '.codex', 'sessions');

const getIndexFilePath = (): string =>
  path.join(getHomeDir(), '.codexwinmux', 'session-index.json');

const getRootKey = (): string => getCodexSessionsDir();

const g = globalThis as unknown as { __ptSessionIndex?: ISessionIndexState };
const state = g.__ptSessionIndex ??= {
  rootKey: getRootKey(),
  initialized: false,
  sessions: [],
  refreshedAt: 0,
  refreshPromise: null,
  refreshTimer: null,
  refreshDebounceTimer: null,
  lastError: null,
  lastBuildMs: 0,
  indexedFiles: 0,
  cacheHits: 0,
  cacheMisses: 0,
  persistContentKey: '',
  persistWrites: 0,
  persistSkips: 0,
  lastPersistedAt: 0,
};

const ensureCurrentRoot = (): void => {
  const rootKey = getRootKey();
  if (state.rootKey === rootKey) return;
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  if (state.refreshDebounceTimer) clearTimeout(state.refreshDebounceTimer);
  state.rootKey = rootKey;
  state.initialized = false;
  state.sessions = [];
  state.refreshedAt = 0;
  state.refreshPromise = null;
  state.refreshTimer = null;
  state.refreshDebounceTimer = null;
  state.lastError = null;
  state.lastBuildMs = 0;
  state.indexedFiles = 0;
  state.cacheHits = 0;
  state.cacheMisses = 0;
  state.persistContentKey = '';
  state.persistWrites = 0;
  state.persistSkips = 0;
  state.lastPersistedAt = 0;
};

const runWithConcurrency = async <T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<PromiseSettledResult<T>[]> => {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  const runNext = async (): Promise<void> => {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      try {
        results[idx] = { status: 'fulfilled', value: await tasks[idx]() };
      } catch (reason) {
        results[idx] = { status: 'rejected', reason };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => runNext()));
  return results;
};

const truncateMessage = (text: string): string =>
  text.length <= MAX_FIRST_MESSAGE_LENGTH
    ? text
    : text.slice(0, MAX_FIRST_MESSAGE_LENGTH) + '...';

const extractCodexText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const block = item as Record<string, unknown>;
      return typeof block.text === 'string' ? block.text : '';
    })
    .filter(Boolean)
    .join('\n\n');
};

const collectJsonlFiles = async (dir: string, depth = 0): Promise<string[]> => {
  if (depth > 4) return [];

  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectJsonlFiles(fullPath, depth + 1));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(fullPath);
    }
  }
  return files;
};

const scanCodexJsonl = async (filePath: string): Promise<ICodexJsonlScanResult> => {
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let sessionId = path.basename(filePath, '.jsonl').match(CODEX_THREAD_ID_RE)?.[1] ?? null;
  let cwd: string | null = null;
  let startedAt: string | null = null;
  let firstMessage = '';
  let turnCount = 0;
  let fallbackFirstMessage = '';
  let fallbackTurnCount = 0;

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;

      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }

      const timestamp = typeof record.timestamp === 'string' ? record.timestamp : null;
      if (!startedAt && timestamp) {
        const ts = new Date(timestamp);
        if (!Number.isNaN(ts.getTime())) startedAt = ts.toISOString();
      }

      const payload = record.payload;
      if (!payload || typeof payload !== 'object') continue;
      const data = payload as Record<string, unknown>;

      if (record.type === 'session_meta') {
        if (typeof data.id === 'string') sessionId = data.id;
        if (typeof data.cwd === 'string') cwd = data.cwd;
        if (typeof data.timestamp === 'string') {
          const ts = new Date(data.timestamp);
          if (!Number.isNaN(ts.getTime())) startedAt = ts.toISOString();
        }
        continue;
      }

      if (record.type === 'event_msg' && data.type === 'user_message') {
        const text = typeof data.message === 'string' ? data.message.trim() : '';
        if (text) {
          turnCount++;
          if (!firstMessage) firstMessage = truncateMessage(text);
        }
      } else if (record.type === 'response_item' && data.role === 'user') {
        const text = extractCodexText(data.content).trim();
        if (text && !text.startsWith('<environment_context>')) {
          fallbackTurnCount++;
          if (!fallbackFirstMessage) fallbackFirstMessage = truncateMessage(text);
        }
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  return {
    sessionId,
    cwd,
    startedAt,
    firstMessage: firstMessage || fallbackFirstMessage,
    turnCount: turnCount || fallbackTurnCount,
  };
};

const readStoredIndex = async (): Promise<IIndexedSessionMeta[]> => {
  try {
    const raw = await fs.readFile(getIndexFilePath(), 'utf-8');
    const parsed = JSON.parse(raw) as ISessionIndexFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) return [];
    return parsed.sessions.filter((session) => (session as { source?: string }).source !== 'remote');
  } catch {
    return [];
  }
};

const writeStoredIndex = async (sessions: IIndexedSessionMeta[]): Promise<void> => {
  const filePath = getIndexFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  const payload: ISessionIndexFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    sessions,
  };
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
  await fs.rename(tmp, filePath);
};

const buildPersistContentKey = (sessions: IIndexedSessionMeta[]): string =>
  sessions
    .map((session) => [
      session.indexKey,
      session.indexJsonlPath,
      session.indexMtimeMs,
      session.indexSize,
      session.sessionId,
      session.lastActivityAt,
      session.turnCount,
    ].join('\t'))
    .join('\n');

const persistStoredIndexIfChanged = async (sessions: IIndexedSessionMeta[]): Promise<void> => {
  const contentKey = buildPersistContentKey(sessions);
  if (contentKey === state.persistContentKey) {
    state.persistSkips++;
    return;
  }

  await writeStoredIndex(sessions);
  state.persistContentKey = contentKey;
  state.persistWrites++;
  state.lastPersistedAt = Date.now();
};

const extractThreadId = (value: string | null | undefined): string | null =>
  value?.match(CODEX_THREAD_ID_RE)?.[1] ?? null;

const toStartedAtMs = (value: string): number | null => {
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
};

const toPublicSession = (session: IIndexedSessionMeta): ISessionMeta => {
  const { indexKey, indexJsonlPath, indexMtimeMs, indexSize, ...meta } = session;
  void indexKey;
  void indexMtimeMs;
  void indexSize;
  return {
    ...meta,
    jsonlPath: indexJsonlPath,
  };
};

const buildLocalSession = async (
  file: string,
  previousByPath: Map<string, IIndexedSessionMeta>,
): Promise<IIndexedSessionMeta | null> => {
  const stat = await fs.stat(file);
  const previous = previousByPath.get(file);
  if (previous && previous.indexMtimeMs === stat.mtimeMs && previous.indexSize === stat.size) {
    return previous;
  }

  const scan = await scanCodexJsonl(file);
  const sessionId = scan.sessionId ?? path.basename(file, '.jsonl').match(CODEX_THREAD_ID_RE)?.[1];
  if (!sessionId) return null;

  return {
    indexKey: `local:${sessionId}`,
    indexJsonlPath: file,
    indexMtimeMs: stat.mtimeMs,
    indexSize: stat.size,
    sessionId,
    startedAt: scan.startedAt || stat.birthtime.toISOString(),
    lastActivityAt: stat.mtime.toISOString(),
    firstMessage: scan.firstMessage,
    turnCount: scan.turnCount,
    cwd: scan.cwd,
  };
};

const replaceDuplicateSessions = (sessions: IIndexedSessionMeta[]): IIndexedSessionMeta[] => {
  const byKey = new Map<string, IIndexedSessionMeta>();
  for (const session of sessions) {
    const previous = byKey.get(session.indexKey);
    if (!previous || new Date(session.lastActivityAt).getTime() >= new Date(previous.lastActivityAt).getTime()) {
      byKey.set(session.indexKey, session);
    }
  }
  return [...byKey.values()].sort(
    (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime(),
  );
};

export const refreshSessionIndex = async (): Promise<void> => {
  ensureCurrentRoot();
  if (state.refreshPromise) return state.refreshPromise;

  state.refreshPromise = (async () => {
    const startedAt = Date.now();
    const previousByPath = new Map(state.sessions.map((session) => [session.indexJsonlPath, session]));
    const localFiles = await collectJsonlFiles(getCodexSessionsDir());
    const tasks = localFiles.map((file) => () => buildLocalSession(file, previousByPath));
    const results = await runWithConcurrency(tasks, MAX_CONCURRENCY);
    const next: IIndexedSessionMeta[] = [];
    let cacheHits = 0;
    let cacheMisses = 0;
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        if (previousByPath.get(result.value.indexJsonlPath) === result.value) {
          cacheHits++;
        } else {
          cacheMisses++;
        }
        next.push(result.value);
      } else if (result.status === 'rejected') {
        log.warn({ err: result.reason }, 'failed to index session JSONL');
      }
    }

    state.sessions = replaceDuplicateSessions(next);
    state.refreshedAt = Date.now();
    state.lastBuildMs = state.refreshedAt - startedAt;
    state.indexedFiles = localFiles.length;
    state.cacheHits = cacheHits;
    state.cacheMisses = cacheMisses;
    state.lastError = null;
    await persistStoredIndexIfChanged(state.sessions).catch((err) => {
      log.warn({ err }, 'failed to persist session index');
    });
  })().catch((err) => {
    state.lastError = err instanceof Error ? err.message : String(err);
    log.warn({ err }, 'session index refresh failed');
  }).finally(() => {
    state.refreshPromise = null;
  });

  return state.refreshPromise;
};

export const requestSessionIndexRefresh = (delayMs = 750): void => {
  ensureCurrentRoot();
  if (state.refreshDebounceTimer) clearTimeout(state.refreshDebounceTimer);
  state.refreshDebounceTimer = setTimeout(() => {
    state.refreshDebounceTimer = null;
    refreshSessionIndex().catch(() => {});
  }, delayMs);
  state.refreshDebounceTimer.unref?.();
};

export const initSessionIndexService = async (): Promise<void> => {
  ensureCurrentRoot();
  if (state.initialized) return;

  state.sessions = replaceDuplicateSessions(await readStoredIndex());
  state.persistContentKey = buildPersistContentKey(state.sessions);
  state.initialized = true;
  requestSessionIndexRefresh(0);

  if (!state.refreshTimer) {
    state.refreshTimer = setInterval(() => {
      refreshSessionIndex().catch(() => {});
    }, REFRESH_INTERVAL_MS);
    state.refreshTimer.unref?.();
  }
};

export const shutdownSessionIndexService = (): void => {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  if (state.refreshDebounceTimer) clearTimeout(state.refreshDebounceTimer);
  state.refreshTimer = null;
  state.refreshDebounceTimer = null;
};

export const getSessionIndexSnapshot = async (options?: { waitForInitial?: boolean }): Promise<ISessionMeta[]> => {
  ensureCurrentRoot();
  if (!state.initialized) {
    await initSessionIndexService();
  }
  if (options?.waitForInitial && state.sessions.length === 0) {
    await refreshSessionIndex();
  }
  return state.sessions.map(toPublicSession);
};

export const getSessionIndexPage = async (options?: ISessionIndexPageOptions): Promise<ISessionIndexPage> => {
  ensureCurrentRoot();
  if (!state.initialized) {
    await initSessionIndexService();
  }
  if (options?.waitForInitial && state.sessions.length === 0) {
    await refreshSessionIndex();
  }

  const total = state.sessions.length;
  const offset = Math.max(0, Math.floor(options?.offset ?? 0));
  const limit = options?.limit;
  const end = typeof limit === 'number'
    ? offset + Math.max(0, Math.floor(limit))
    : total;

  return {
    sessions: state.sessions.slice(offset, end).map(toPublicSession),
    total,
    hasMore: end < total,
  };
};

export const findIndexedCodexSessionJsonl = async (
  sessionId?: string | null,
  cwd?: string | null,
  options: { processStartedAt?: number | null; allowCwdFallback?: boolean } = {},
): Promise<IIndexedCodexSessionJsonl | null> => {
  ensureCurrentRoot();
  if (!state.initialized) {
    await initSessionIndexService();
  }
  if (state.sessions.length === 0) {
    await refreshSessionIndex();
  }

  const metas = state.sessions
    .map((session): IIndexedCodexSessionJsonl => ({
      sessionId: session.sessionId,
      jsonlPath: session.indexJsonlPath,
      cwd: session.cwd ?? null,
      startedAt: toStartedAtMs(session.startedAt),
      mtimeMs: session.indexMtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const normalizedSessionId = extractThreadId(sessionId) ?? sessionId;
  if (normalizedSessionId) {
    const byId = metas.find((meta) => meta.sessionId === normalizedSessionId);
    if (byId) return byId;
  }

  if (cwd && options.processStartedAt !== undefined && options.processStartedAt !== null) {
    const candidates = metas
      .filter((meta) => meta.cwd === cwd && meta.startedAt !== null)
      .map((meta) => ({
        meta,
        delta: Math.abs(meta.startedAt! - options.processStartedAt!),
      }))
      .filter((candidate) => candidate.delta <= 120_000)
      .sort((a, b) => a.delta - b.delta || b.meta.mtimeMs - a.meta.mtimeMs);
    if (candidates[0]) return candidates[0].meta;
  }

  if (!options.allowCwdFallback) return null;

  const candidates = cwd
    ? metas.filter((meta) => meta.cwd === cwd)
    : metas;
  return candidates[0] ?? null;
};

export const parseCodexSessionMeta = async (jsonlPath: string): Promise<ISessionMeta | null> => {
  try {
    const stat = await fs.stat(jsonlPath);
    const scan = await scanCodexJsonl(jsonlPath);
    const sessionId = scan.sessionId ?? path.basename(jsonlPath, '.jsonl').match(CODEX_THREAD_ID_RE)?.[1];
    if (!sessionId) return null;
    return {
      sessionId,
      startedAt: scan.startedAt || stat.birthtime.toISOString(),
      lastActivityAt: stat.mtime.toISOString(),
      firstMessage: scan.firstMessage,
      turnCount: scan.turnCount,
      cwd: scan.cwd,
    };
  } catch (err) {
    log.warn({ err }, `failed to parse Codex session meta: ${jsonlPath}`);
    return null;
  }
};

export const getSessionIndexPerfSnapshot = () => {
  ensureCurrentRoot();
  return {
    sessions: state.sessions.length,
    indexedFiles: state.indexedFiles,
    refreshedAt: state.refreshedAt,
    refreshing: !!state.refreshPromise,
    lastBuildMs: state.lastBuildMs,
    cacheHits: state.cacheHits,
    cacheMisses: state.cacheMisses,
    persistWrites: state.persistWrites,
    persistSkips: state.persistSkips,
    lastPersistedAt: state.lastPersistedAt,
    lastError: state.lastError,
  };
};
