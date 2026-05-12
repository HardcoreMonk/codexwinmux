import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempHome: string;

const sessionId = '019dcf1f-3a02-73a0-a79e-8703b99a2f30';
const jsonLine = (value: unknown): string => JSON.stringify(value);

const emptyStatsDay = () => ({
  messageCount: 0,
  sessionCount: 0,
  toolCallCount: 0,
  hourCounts: {},
  modelTokens: {},
  sessions: [],
});

const writeCodexSession = async (): Promise<void> => {
  const dir = path.join(tempHome, '.codex', 'sessions', '2026', '04', '27');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `rollout-2026-04-27T01-00-00-${sessionId}.jsonl`),
    [
      jsonLine({
        timestamp: '2026-04-27T01:00:01.000Z',
        type: 'session_meta',
        payload: {
          id: sessionId,
          timestamp: '2026-04-27T01:00:00.000Z',
        },
      }),
      jsonLine({
        timestamp: '2026-04-27T01:00:05.000Z',
        type: 'turn_context',
        payload: {
          cwd: '/work/project-a',
          model: 'gpt-5.5',
        },
      }),
      jsonLine({
        timestamp: '2026-04-27T01:00:10.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Start Codex work' },
      }),
      jsonLine({
        timestamp: '2026-04-27T01:00:20.000Z',
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'Working on it' },
      }),
      jsonLine({
        timestamp: '2026-04-27T01:00:22.000Z',
        type: 'response_item',
        payload: { type: 'function_call', name: 'exec_command' },
      }),
      jsonLine({
        timestamp: '2026-04-27T01:00:30.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 40,
              output_tokens: 25,
              reasoning_output_tokens: 10,
              total_tokens: 125,
            },
            last_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 40,
              output_tokens: 25,
              reasoning_output_tokens: 10,
              total_tokens: 125,
            },
          },
        },
      }),
      jsonLine({
        timestamp: '2026-04-27T01:05:00.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Continue' },
      }),
      jsonLine({
        timestamp: '2026-04-27T01:05:10.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: 150,
              cached_input_tokens: 50,
              output_tokens: 30,
              reasoning_output_tokens: 12,
              total_tokens: 180,
            },
            last_token_usage: {
              input_tokens: 50,
              cached_input_tokens: 10,
              output_tokens: 5,
              reasoning_output_tokens: 2,
              total_tokens: 55,
            },
          },
        },
      }),
    ].join('\n'),
  );
};

const writeCodexSessionForDatePath = async ({
  pathDate,
  timestampDate,
  sessionId: id,
  message,
}: {
  pathDate: string;
  timestampDate: string;
  sessionId: string;
  message: string;
}): Promise<void> => {
  const [year, month, day] = pathDate.split('-');
  const dir = path.join(tempHome, '.codex', 'sessions', year, month, day);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `rollout-${pathDate}T01-00-00-${id}.jsonl`),
    [
      jsonLine({
        timestamp: `${timestampDate}T01:00:00.000Z`,
        type: 'session_meta',
        payload: { id, timestamp: `${timestampDate}T01:00:00.000Z` },
      }),
      jsonLine({
        timestamp: `${timestampDate}T01:00:01.000Z`,
        type: 'event_msg',
        payload: { type: 'user_message', message },
      }),
    ].join('\n'),
  );
};

const writeStatsCacheFile = async (): Promise<void> => {
  const dir = path.join(tempHome, '.codexwinmux', 'stats');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'cache.json'),
    JSON.stringify({
      version: 4,
      lastComputedDate: '2026-04-27',
      days: {
        '2026-04-27': emptyStatsDay(),
      },
    }),
    'utf-8',
  );
};

describe('Codex stats parsing', () => {
  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-stats-'));
    vi.resetModules();
    vi.stubEnv('HOME', tempHome);
    vi.stubEnv('USERPROFILE', tempHome);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-28T12:00:00.000Z'));
    await writeCodexSession();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  it('includes Codex sessions in sessions, projects, uptime, and overview cache', async () => {
    const { parseAllSessions, parseAllProjects, parseTimestampsByDay } = await import('@/lib/stats/jsonl-parser');
    const { getStatsCache } = await import('@/lib/stats/stats-cache');

    const sessions = await parseAllSessions('all');
    expect(sessions).toEqual([
      {
        sessionId,
        project: '/work/project-a',
        startedAt: '2026-04-27T01:00:10.000Z',
        lastActivityAt: '2026-04-27T01:05:10.000Z',
        messageCount: 2,
        totalTokens: 180,
        model: 'gpt-5.5',
      },
    ]);

    const projects = await parseAllProjects('all');
    expect(projects).toEqual([
      {
        project: '/work/project-a',
        sessionCount: 1,
        messageCount: 2,
        totalTokens: 180,
      },
    ]);

    const timestamps = await parseTimestampsByDay(new Set(['2026-04-27']));
    expect(timestamps.get('2026-04-27')?.get(sessionId)).toHaveLength(3);

    const cache = await getStatsCache();
    expect(cache.totalSessions).toBe(1);
    expect(cache.totalMessages).toBe(2);
    expect(cache.dailyActivity).toContainEqual({
      date: '2026-04-27',
      messageCount: 2,
      sessionCount: 1,
      toolCallCount: 1,
    });
    expect(cache.modelUsage['gpt-5.5']).toMatchObject({
      inputTokens: 100,
      cacheReadInputTokens: 50,
      outputTokens: 30,
    });
  });

  it('reuses parsed session stats between project and session summaries', async () => {
    const { parseAllProjects, parseAllSessions } = await import('@/lib/stats/jsonl-parser');
    const { getPerfRuntimeSnapshot } = await import('@/lib/perf-metrics');
    const before = getPerfRuntimeSnapshot().counters;

    const [projects, sessions] = await Promise.all([
      parseAllProjects('7d'),
      parseAllSessions('7d'),
    ]);

    expect(projects).toHaveLength(1);
    expect(sessions).toHaveLength(1);
    const after = getPerfRuntimeSnapshot().counters;
    expect((after['stats.session_parse.miss'] ?? 0) - (before['stats.session_parse.miss'] ?? 0)).toBe(1);
    expect(
      (after['stats.session_parse.inflight_join'] ?? 0) - (before['stats.session_parse.inflight_join'] ?? 0),
    ).toBeGreaterThanOrEqual(1);
  });

  it('uses the path date to exclude old files from a today-only stats cache refresh', async () => {
    await fs.rm(tempHome, { recursive: true, force: true });
    await fs.mkdir(tempHome, { recursive: true });
    vi.resetModules();
    await writeStatsCacheFile();
    await writeCodexSessionForDatePath({
      pathDate: '2026-04-26',
      timestampDate: '2026-04-28',
      sessionId: '019dcf1f-3a02-73a0-a79e-8703b99a2f31',
      message: 'old path should not count as today',
    });
    await writeCodexSessionForDatePath({
      pathDate: '2026-04-28',
      timestampDate: '2026-04-28',
      sessionId: '019dcf1f-3a02-73a0-a79e-8703b99a2f32',
      message: 'today path should count',
    });

    const { getStatsCache } = await import('@/lib/stats/stats-cache');
    const cache = await getStatsCache();

    expect(cache.dailyActivity).toContainEqual({
      date: '2026-04-28',
      messageCount: 1,
      sessionCount: 1,
      toolCallCount: 0,
    });
    expect(cache.totalMessages).toBe(1);
  });
});
