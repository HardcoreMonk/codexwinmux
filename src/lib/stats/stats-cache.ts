import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import dayjs from 'dayjs';
import {
  collectAgentJsonlFilePaths,
  collectAgentJsonlFiles,
  extractSessionIdFromAgentJsonlPath,
  filterAgentJsonlFilesByDates,
  type IAgentJsonlFile,
} from './agent-jsonl-files';
import { getPerfNow, recordPerfCounter, recordPerfDuration } from '@/lib/perf-metrics';
import type {
  IStatsCache,
  IStatsCacheDailyActivity,
  IStatsCacheDailyTokens,
  IStatsCacheModelUsage,
  IStatsCacheLongestSession,
  ITokenBreakdown,
} from '@/types/stats';

const CACHE_VERSION = 4;
const CACHE_DIR = path.join(os.homedir(), '.codexwinmux', 'stats');
const CACHE_PATH = path.join(CACHE_DIR, 'cache.json');
const CONCURRENCY_LIMIT = 10;

// --- Cache types ---

interface IDailyModelTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  cacheCreation5m: number;
  cacheCreation1h: number;
}

const emptyModelTokens = (): IDailyModelTokens => ({
  input: 0, output: 0, cacheRead: 0, cacheCreation: 0, cacheCreation5m: 0, cacheCreation1h: 0,
});

interface IStatsDailyData {
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
  hourCounts: Record<string, number>;
  modelTokens: Record<string, IDailyModelTokens>;
  sessions: { id: string; start: string; end: string; messages: number }[];
}

interface IStatsFileCache {
  version: number;
  lastComputedDate: string;
  days: Record<string, IStatsDailyData>;
}

interface ICodexTokenUsage {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const ensureDay = (
  days: Map<string, IStatsDailyData>,
  sessionsByDay: Map<string, Map<string, { start: string; end: string; messages: number }>>,
  date: string,
): IStatsDailyData => {
  let day = days.get(date);
  if (!day) {
    day = {
      messageCount: 0,
      sessionCount: 0,
      toolCallCount: 0,
      hourCounts: {},
      modelTokens: {},
      sessions: [],
    };
    days.set(date, day);
    sessionsByDay.set(date, new Map());
  }
  return day;
};

const addSessionActivity = (
  sessionsByDay: Map<string, Map<string, { start: string; end: string; messages: number }>>,
  date: string,
  sessionId: string,
  timestamp: string,
  messages: number,
): void => {
  if (!sessionId) return;
  const daySessions = sessionsByDay.get(date);
  if (!daySessions) return;

  const sess = daySessions.get(sessionId);
  if (sess) {
    sess.messages += messages;
    if (timestamp > sess.end) sess.end = timestamp;
    if (timestamp < sess.start) sess.start = timestamp;
  } else {
    daySessions.set(sessionId, { start: timestamp, end: timestamp, messages });
  }
};

const parseCodexUsage = (raw: unknown): ICodexTokenUsage | null => {
  if (!isRecord(raw)) return null;
  return {
    input_tokens: Number(raw.input_tokens ?? 0),
    cached_input_tokens: Number(raw.cached_input_tokens ?? 0),
    output_tokens: Number(raw.output_tokens ?? 0),
  };
};

// --- JSONL parsing ---

export const collectJsonlFiles = collectAgentJsonlFilePaths;

const parseDaysFromFile = async (
  file: IAgentJsonlFile,
  targetDates: Set<string>,
): Promise<Map<string, IStatsDailyData>> => {
  const days = new Map<string, IStatsDailyData>();
  const sessionsByDay = new Map<string, Map<string, { start: string; end: string; messages: number }>>();
  const filePath = file.filePath;
  let codexSessionId = file.source === 'codex'
    ? extractSessionIdFromAgentJsonlPath(filePath) ?? ''
    : '';
  let codexModel = 'codex';
  const previousCodexTotals = new Map<string, ICodexTokenUsage>();

  try {
    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const timestamp = String(entry.timestamp ?? '');
        if (!timestamp) continue;

        const type = String(entry.type ?? '');
        if (file.source === 'codex' && (type === 'session_meta' || type === 'turn_context')) {
          const payload = isRecord(entry.payload) ? entry.payload : null;
          if (payload) {
            if (type === 'session_meta') {
              codexSessionId = String(payload.id ?? codexSessionId);
            }
            const model = String(payload.model ?? '');
            if (model) codexModel = model;
          }
        }

        const date = timestamp.slice(0, 10);
        if (!targetDates.has(date)) continue;

        if (file.source === 'codex') {
          const payload = isRecord(entry.payload) ? entry.payload : null;
          if (type === 'session_meta' || type === 'turn_context') {
            continue;
          }

          if (type === 'response_item' && payload && payload.type === 'function_call') {
            const day = ensureDay(days, sessionsByDay, date);
            day.toolCallCount++;
            addSessionActivity(sessionsByDay, date, codexSessionId, timestamp, 0);
            continue;
          }

          if (type !== 'event_msg' || !payload) continue;

          const eventType = String(payload.type ?? '');
          if (eventType === 'user_message') {
            const day = ensureDay(days, sessionsByDay, date);
            const hour = String(new Date(timestamp).getHours());
            day.messageCount++;
            day.hourCounts[hour] = (day.hourCounts[hour] ?? 0) + 1;
            addSessionActivity(sessionsByDay, date, codexSessionId, timestamp, 1);
            continue;
          }

          if (eventType === 'agent_message') {
            ensureDay(days, sessionsByDay, date);
            addSessionActivity(sessionsByDay, date, codexSessionId, timestamp, 0);
            continue;
          }

          if (eventType === 'token_count') {
            const info = isRecord(payload.info) ? payload.info : null;
            if (!info) continue;

            const model = codexModel || 'codex';
            const lastUsage = parseCodexUsage(info.last_token_usage);
            const totalUsage = parseCodexUsage(info.total_token_usage);
            let usage = lastUsage;

            if (totalUsage) {
              const previous = previousCodexTotals.get(model);
              previousCodexTotals.set(model, totalUsage);
              if (!usage && previous) {
                usage = {
                  input_tokens: Math.max(0, totalUsage.input_tokens - previous.input_tokens),
                  cached_input_tokens: Math.max(0, totalUsage.cached_input_tokens - previous.cached_input_tokens),
                  output_tokens: Math.max(0, totalUsage.output_tokens - previous.output_tokens),
                };
              } else if (!usage) {
                usage = totalUsage;
              }
            }

            if (!usage) continue;

            const day = ensureDay(days, sessionsByDay, date);
            if (!day.modelTokens[model]) {
              day.modelTokens[model] = emptyModelTokens();
            }
            const mt = day.modelTokens[model];
            const cacheRead = Math.min(usage.input_tokens, usage.cached_input_tokens);
            mt.input += Math.max(0, usage.input_tokens - cacheRead);
            mt.output += usage.output_tokens;
            mt.cacheRead += cacheRead;
            addSessionActivity(sessionsByDay, date, codexSessionId, timestamp, 0);
            continue;
          }

          continue;
        }

        if (type !== 'user' && type !== 'assistant') continue;

        const sessionId = String(entry.sessionId ?? '');
        const day = ensureDay(days, sessionsByDay, date);

        if (type === 'user') {
          const hour = String(new Date(timestamp).getHours());
          day.messageCount++;
          day.hourCounts[hour] = (day.hourCounts[hour] ?? 0) + 1;
          addSessionActivity(sessionsByDay, date, sessionId, timestamp, 1);
        }

        if (type === 'assistant') {
          const message = entry.message as Record<string, unknown> | undefined;
          if (!message) continue;

          const content = message.content as unknown[];
          if (Array.isArray(content)) {
            const toolUseCount = content.filter(
              (c) => typeof c === 'object' && c !== null && (c as Record<string, unknown>).type === 'tool_use',
            ).length;
            day.toolCallCount += toolUseCount;
          }

          const model = String(message.model ?? '');
          const usage = message.usage as Record<string, unknown> | undefined;
          if (model && !model.startsWith('<') && usage) {
            if (!day.modelTokens[model]) {
              day.modelTokens[model] = emptyModelTokens();
            }
            const mt = day.modelTokens[model];
            const cc = Number(usage.cache_creation_input_tokens ?? 0);
            const cacheCreation = usage.cache_creation as Record<string, unknown> | undefined;
            const cc1h = Number(cacheCreation?.ephemeral_1h_input_tokens ?? 0);
            const cc5m = cacheCreation?.ephemeral_5m_input_tokens != null
              ? Number(cacheCreation.ephemeral_5m_input_tokens)
              : Math.max(0, cc - cc1h);
            mt.input += Number(usage.input_tokens ?? 0);
            mt.output += Number(usage.output_tokens ?? 0);
            mt.cacheRead += Number(usage.cache_read_input_tokens ?? 0);
            mt.cacheCreation += cc;
            mt.cacheCreation5m += cc5m;
            mt.cacheCreation1h += cc1h;
          }

          addSessionActivity(sessionsByDay, date, sessionId, timestamp, 0);
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // file read error
  }

  for (const [date, daySessions] of sessionsByDay) {
    const day = days.get(date);
    if (!day) continue;
    day.sessionCount = daySessions.size;
    day.sessions = Array.from(daySessions.entries()).map(([id, s]) => ({
      id,
      start: s.start,
      end: s.end,
      messages: s.messages,
    }));
  }

  return days;
};

const runWithConcurrency = async <T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> => {
  const results: T[] = [];
  let index = 0;

  const runNext = async (): Promise<void> => {
    while (index < tasks.length) {
      const current = index++;
      results[current] = await tasks[current]();
    }
  };

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => runNext());
  await Promise.all(workers);
  return results;
};

const mergeDailyData = (target: IStatsDailyData, source: IStatsDailyData): void => {
  target.messageCount += source.messageCount;
  target.toolCallCount += source.toolCallCount;

  for (const [hour, count] of Object.entries(source.hourCounts)) {
    target.hourCounts[hour] = (target.hourCounts[hour] ?? 0) + count;
  }

  for (const [model, tokens] of Object.entries(source.modelTokens)) {
    if (!target.modelTokens[model]) {
      target.modelTokens[model] = emptyModelTokens();
    }
    const t = target.modelTokens[model];
    t.input += tokens.input;
    t.output += tokens.output;
    t.cacheRead += tokens.cacheRead;
    t.cacheCreation += tokens.cacheCreation;
    t.cacheCreation5m += tokens.cacheCreation5m;
    t.cacheCreation1h += tokens.cacheCreation1h;
  }

  const existingIds = new Set(target.sessions.map((s) => s.id));
  for (const sess of source.sessions) {
    if (existingIds.has(sess.id)) {
      const existing = target.sessions.find((s) => s.id === sess.id)!;
      existing.messages += sess.messages;
      if (sess.start < existing.start) existing.start = sess.start;
      if (sess.end > existing.end) existing.end = sess.end;
    } else {
      target.sessions.push(sess);
    }
  }
  target.sessionCount = target.sessions.length;
};

// --- Cache read/write ---

const readCache = async (): Promise<IStatsFileCache | null> => {
  try {
    const content = await fs.readFile(CACHE_PATH, 'utf-8');
    const raw = JSON.parse(content) as IStatsFileCache;
    if (raw.version !== CACHE_VERSION) return null;
    return raw;
  } catch {
    return null;
  }
};

const writeCache = async (cache: IStatsFileCache): Promise<void> => {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(cache), 'utf-8');
};

// --- In-memory cache for hot path ---

const MEMORY_TTL = 300_000;
let memoryCache: { data: IStatsCache; expiresAt: number } | null = null;
let inFlightCache: Promise<IStatsCache> | null = null;

// --- Main: build or update cache, return IStatsCache ---

const findFirstDateFromFile = async (filePath: string): Promise<string | null> => {
  try {
    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const ts = String(entry.timestamp ?? '');
        if (ts) return ts.slice(0, 10);
      } catch {
        // skip
      }
    }
  } catch {
    // skip
  }
  return null;
};

const findFirstDate = async (): Promise<string | null> => {
  const files = await collectAgentJsonlFiles();
  if (files.length === 0) return null;

  const tasks = files.map((f) => () => findFirstDateFromFile(f.filePath));
  const results = await runWithConcurrency(tasks, CONCURRENCY_LIMIT);
  const dates = results.filter((d): d is string => d !== null);
  if (dates.length === 0) return null;
  dates.sort();
  return dates[0];
};

const computeMissingDays = async (targetDates: Set<string>): Promise<Map<string, IStatsDailyData>> => {
  if (targetDates.size === 0) return new Map();

  const allFiles = await collectAgentJsonlFiles();
  const files = filterAgentJsonlFilesByDates(allFiles, targetDates);
  recordPerfCounter('stats.cache.files_seen', allFiles.length);
  recordPerfCounter('stats.cache.files_selected', files.length);
  const tasks = files.map((f) => () => parseDaysFromFile(f, targetDates));
  const allResults = await runWithConcurrency(tasks, CONCURRENCY_LIMIT);

  const merged = new Map<string, IStatsDailyData>();
  for (const fileResult of allResults) {
    for (const [date, data] of fileResult) {
      const existing = merged.get(date);
      if (existing) {
        mergeDailyData(existing, data);
      } else {
        merged.set(date, data);
      }
    }
  }

  return merged;
};

const buildStatsCacheFromFiles = async (): Promise<IStatsCache> => {
  const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
  const today = dayjs().format('YYYY-MM-DD');

  let cache = await readCache();

  const missingDates = new Set<string>();
  missingDates.add(today);

  if (!cache) {
    cache = { version: CACHE_VERSION, lastComputedDate: '', days: {} };
    const firstDate = await findFirstDate();
    if (!firstDate) {
      return buildStatsCache(cache, today);
    }
    let d = dayjs(firstDate);
    const end = dayjs(yesterday);
    while (d.isBefore(end) || d.isSame(end)) {
      missingDates.add(d.format('YYYY-MM-DD'));
      d = d.add(1, 'day');
    }
  } else {
    if (cache.lastComputedDate < yesterday) {
      let d = dayjs(cache.lastComputedDate).add(1, 'day');
      const end = dayjs(yesterday);
      while (d.isBefore(end) || d.isSame(end)) {
        const dateStr = d.format('YYYY-MM-DD');
        if (!cache.days[dateStr]) {
          missingDates.add(dateStr);
        }
        d = d.add(1, 'day');
      }
    }
  }

  const newDays = await computeMissingDays(missingDates);

  for (const [date, data] of newDays) {
    if (date === today) continue;
    cache.days[date] = data;
  }

  cache.lastComputedDate = yesterday;
  await writeCache(cache);

  const todayData = newDays.get(today) ?? null;
  const result = buildStatsCache(cache, today, todayData);

  memoryCache = { data: result, expiresAt: Date.now() + MEMORY_TTL };
  return result;
};

export const getStatsCache = async (): Promise<IStatsCache> => {
  if (memoryCache && Date.now() < memoryCache.expiresAt) {
    recordPerfCounter('stats.cache.memory_hit');
    return memoryCache.data;
  }

  if (inFlightCache) {
    recordPerfCounter('stats.cache.inflight_join');
    return inFlightCache;
  }

  recordPerfCounter('stats.cache.miss');
  const startedAt = getPerfNow();
  inFlightCache = buildStatsCacheFromFiles()
    .finally(() => {
      recordPerfDuration('stats.cache.build', getPerfNow() - startedAt);
      inFlightCache = null;
    });
  return inFlightCache;
};

const buildStatsCache = (
  cache: IStatsFileCache,
  today: string,
  todayData?: IStatsDailyData | null,
): IStatsCache => {
  const dailyActivity: IStatsCacheDailyActivity[] = [];
  const dailyModelTokens: IStatsCacheDailyTokens[] = [];
  const modelUsage: Record<string, IStatsCacheModelUsage> = {};
  const hourCounts: Record<string, number> = {};
  const dayHourCounts: Record<string, number> = {};
  let totalSessions = 0;
  let totalMessages = 0;
  let firstSessionDate = '';
  let longestSession: IStatsCacheLongestSession = { sessionId: '', duration: 0, messageCount: 0, timestamp: '' };

  const allDays: [string, IStatsDailyData][] = Object.entries(cache.days);
  if (todayData) {
    allDays.push([today, todayData]);
  }
  allDays.sort((a, b) => a[0].localeCompare(b[0]));

  for (const [date, day] of allDays) {
    if (!firstSessionDate && day.messageCount > 0) {
      firstSessionDate = date;
    }

    dailyActivity.push({
      date,
      messageCount: day.messageCount,
      sessionCount: day.sessionCount,
      toolCallCount: day.toolCallCount,
    });

    const tokensByModel: Record<string, ITokenBreakdown> = {};
    for (const [model, tokens] of Object.entries(day.modelTokens)) {
      tokensByModel[model] = {
        input: tokens.input,
        output: tokens.output,
        cacheRead: tokens.cacheRead,
        cacheCreation: tokens.cacheCreation,
        cacheCreation5m: tokens.cacheCreation5m,
        cacheCreation1h: tokens.cacheCreation1h,
      };

      if (!modelUsage[model]) {
        modelUsage[model] = {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheCreation5mInputTokens: 0,
          cacheCreation1hInputTokens: 0,
          webSearchRequests: 0,
          costUSD: 0,
          contextWindow: 0,
          maxOutputTokens: 0,
        };
      }
      const mu = modelUsage[model];
      mu.inputTokens += tokens.input;
      mu.outputTokens += tokens.output;
      mu.cacheReadInputTokens += tokens.cacheRead;
      mu.cacheCreationInputTokens += tokens.cacheCreation;
      mu.cacheCreation5mInputTokens += tokens.cacheCreation5m;
      mu.cacheCreation1hInputTokens += tokens.cacheCreation1h;
    }

    dailyModelTokens.push({ date, tokensByModel });

    const dow = new Date(date).getDay();
    for (const [hour, count] of Object.entries(day.hourCounts)) {
      hourCounts[hour] = (hourCounts[hour] ?? 0) + count;
      const dhKey = `${dow}-${hour}`;
      dayHourCounts[dhKey] = (dayHourCounts[dhKey] ?? 0) + count;
    }

    totalSessions += day.sessionCount;
    totalMessages += day.messageCount;

    for (const sess of day.sessions) {
      const duration = new Date(sess.end).getTime() - new Date(sess.start).getTime();
      if (duration > longestSession.duration) {
        longestSession = {
          sessionId: sess.id,
          duration,
          messageCount: sess.messages,
          timestamp: sess.start,
        };
      }
    }
  }

  return {
    version: CACHE_VERSION,
    lastComputedDate: today,
    dailyActivity,
    dailyModelTokens,
    modelUsage,
    totalSessions,
    totalMessages,
    longestSession,
    firstSessionDate,
    hourCounts,
    dayHourCounts,
    totalSpeculationTimeSavedMs: 0,
  };
};
