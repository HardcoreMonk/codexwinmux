import fsPromises from 'fs/promises';
import pathModule from 'path';
import os from 'os';
import type { NextApiRequest, NextApiResponse } from 'next';
import dayjs from 'dayjs';
import { parseTimestampsByDay } from '@/lib/stats/jsonl-parser';
import { getCached, setCached } from '@/lib/stats/cache';
import type { IUptimeResponse, IStreak, IStreakDay } from '@/types/stats';

const SLOT_MS = 60 * 1000;
const ACTIVITY_GAP_MS = 15 * 60 * 1000;
const CACHE_DIR = pathModule.join(os.homedir(), '.codexwinmux', 'stats');
const CACHE_PATH = pathModule.join(CACHE_DIR, 'uptime-cache.json');
const DISK_CACHE_VERSION = 1;

interface IUptimeDiskCache {
  version: number;
  lastComputedDate: string;
  days: Record<string, Record<string, number[]>>;
}

const readDiskCache = async (): Promise<IUptimeDiskCache | null> => {
  try {
    const content = await fsPromises.readFile(CACHE_PATH, 'utf-8');
    const raw = JSON.parse(content) as IUptimeDiskCache;
    if (raw.version !== DISK_CACHE_VERSION) return null;
    return raw;
  } catch {
    return null;
  }
};

const writeDiskCache = async (cache: IUptimeDiskCache): Promise<void> => {
  await fsPromises.mkdir(CACHE_DIR, { recursive: true });
  await fsPromises.writeFile(CACHE_PATH, JSON.stringify(cache), 'utf-8');
};

const computeResponse = (
  sessionTimestamps: Map<string, number[]>,
  periodStart: dayjs.Dayjs,
  nowMs: number,
): IUptimeResponse => {
  const periodStartMs = periodStart.valueOf();
  const totalSlotCount = Math.ceil((nowMs - periodStartMs) / SLOT_MS);
  const slotConcurrency = new Int32Array(totalSlotCount);

  for (const timestamps of sessionTimestamps.values()) {
    if (timestamps.length === 0) continue;
    const sessionSlots = new Set<number>();

    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      const slot = (ts - periodStartMs) / SLOT_MS | 0;
      sessionSlots.add(slot);

      if (i + 1 < timestamps.length) {
        const nextTs = timestamps[i + 1];
        if (nextTs - ts <= ACTIVITY_GAP_MS) {
          const endSlot = (nextTs - periodStartMs) / SLOT_MS | 0;
          for (let s = slot; s <= endSlot; s++) {
            sessionSlots.add(s);
          }
        }
      }
    }

    for (const slot of sessionSlots) {
      if (slot >= 0 && slot < totalSlotCount) {
        slotConcurrency[slot]++;
      }
    }
  }

  // Extract streaks from slotConcurrency
  const streaks: IStreak[] = [];
  let activeSlots = 0;
  let maxConcurrent = 0;
  const comboSlots: Record<number, number> = {};
  let streakStartSlot = -1;
  let streakMaxC = 0;

  for (let i = 0; i <= totalSlotCount; i++) {
    const c = i < totalSlotCount ? slotConcurrency[i] : 0;

    if (c > 0) {
      if (streakStartSlot < 0) {
        streakStartSlot = i;
        streakMaxC = 0;
      }
      activeSlots++;
      if (c > streakMaxC) streakMaxC = c;
      if (c > maxConcurrent) maxConcurrent = c;
      for (let lvl = 2; lvl <= c; lvl++) {
        comboSlots[lvl] = (comboSlots[lvl] ?? 0) + 1;
      }
    } else if (streakStartSlot >= 0) {
      const startMs = periodStartMs + streakStartSlot * SLOT_MS;
      const endMs = periodStartMs + i * SLOT_MS;
      const isActive = i >= totalSlotCount;
      streaks.push({
        startMs,
        endMs: isActive ? nowMs : endMs,
        durationMinutes: i - streakStartSlot,
        maxConcurrent: streakMaxC,
        active: isActive,
      });
      streakStartSlot = -1;
    }
  }

  // Sort streaks by start descending
  streaks.sort((a, b) => b.startMs - a.startMs);

  // Build per-day segments
  const days: IStreakDay[] = [];
  for (let d = 0; d < 7; d++) {
    const dayStartMs = periodStartMs + d * 86_400_000;
    const dayEndMs = dayStartMs + 86_400_000;
    const date = periodStart.add(d, 'day').format('YYYY-MM-DD');
    const segments: IStreakDay['segments'] = [];

    for (const streak of streaks) {
      if (streak.endMs <= dayStartMs || streak.startMs >= dayEndMs) continue;
      const segStart = Math.max(streak.startMs, dayStartMs);
      const segEnd = Math.min(streak.endMs, dayEndMs);
      const startMinute = ((segStart - dayStartMs) / 60_000) | 0;
      const duration = Math.max(1, ((segEnd - segStart) / 60_000) | 0);
      segments.push({ startMinuteOfDay: startMinute, durationMinutes: duration, maxConcurrent: streak.maxConcurrent });
    }

    segments.sort((a, b) => a.startMinuteOfDay - b.startMinuteOfDay);
    days.push({ date, segments });
  }

  // Summary stats
  const totalStreaks = streaks.length;
  const longestStreakMinutes = totalStreaks > 0 ? Math.max(...streaks.map((s) => s.durationMinutes)) : 0;
  const averageStreakMinutes = totalStreaks > 0 ? Math.round(streaks.reduce((sum, s) => sum + s.durationMinutes, 0) / totalStreaks) : 0;

  const currentStreak = streaks.find((s) => s.active);

  return {
    streaks,
    days,
    longestStreakMinutes,
    averageStreakMinutes,
    totalStreaks,
    totalActiveMinutes: activeSlots,
    currentStreak: {
      active: !!currentStreak,
      minutes: currentStreak?.durationMinutes ?? 0,
      maxConcurrent: currentStreak?.maxConcurrent ?? 0,
    },
    comboMinutes: Object.fromEntries(Object.entries(comboSlots).map(([k, v]) => [Number(k), v])),
    maxConcurrent,
  };
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method-not-allowed' });
  }

  const cacheKey = 'stats:uptime:7d';
  const memCached = getCached<IUptimeResponse>(cacheKey);
  if (memCached) return res.status(200).json(memCached);

  const now = dayjs();
  const today = now.format('YYYY-MM-DD');
  const periodStart = now.subtract(6, 'day').startOf('day');

  const allDates: string[] = [];
  for (let d = 0; d < 7; d++) {
    allDates.push(periodStart.add(d, 'day').format('YYYY-MM-DD'));
  }

  const diskCache = await readDiskCache();

  const needDates = new Set<string>();
  needDates.add(today);
  for (const date of allDates) {
    if (date !== today && !diskCache?.days[date]) {
      needDates.add(date);
    }
  }

  const freshData = await parseTimestampsByDay(needDates);

  const updatedCache: IUptimeDiskCache = {
    version: DISK_CACHE_VERSION,
    lastComputedDate: today,
    days: { ...diskCache?.days },
  };

  const pruneThreshold = now.subtract(30, 'day').format('YYYY-MM-DD');
  for (const date of Object.keys(updatedCache.days)) {
    if (date < pruneThreshold) delete updatedCache.days[date];
  }

  for (const [date, daySessions] of freshData) {
    if (date === today) continue;
    const sessionsObj: Record<string, number[]> = {};
    for (const [sessionId, timestamps] of daySessions) {
      sessionsObj[sessionId] = timestamps;
    }
    updatedCache.days[date] = sessionsObj;
  }

  writeDiskCache(updatedCache).catch(() => {});

  const sessionTimestamps = new Map<string, number[]>();

  const mergeInto = (source: Map<string, number[]> | Record<string, number[]>) => {
    const entries = source instanceof Map ? source.entries() : Object.entries(source);
    for (const [sessionId, timestamps] of entries) {
      const existing = sessionTimestamps.get(sessionId);
      if (existing) {
        existing.push(...timestamps);
      } else {
        sessionTimestamps.set(sessionId, [...timestamps]);
      }
    }
  };

  for (const date of allDates) {
    const fresh = freshData.get(date);
    if (fresh) {
      mergeInto(fresh);
    } else if (updatedCache.days[date]) {
      mergeInto(updatedCache.days[date]);
    }
  }

  for (const timestamps of sessionTimestamps.values()) {
    timestamps.sort((a, b) => a - b);
  }

  const response = computeResponse(sessionTimestamps, periodStart, now.valueOf());

  setCached(cacheKey, response);
  return res.status(200).json(response);
};

export default handler;
