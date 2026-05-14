import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempHome: string;

const jsonLine = (value: unknown): string => JSON.stringify(value);

const writeSession = async (message = 'Start work'): Promise<string> => {
  const dir = path.join(tempHome, '.codex', 'sessions', '2026', '05', '02');
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, 'rollout-2026-05-02T01-00-00-019dd001-3a02-73a0-a79e-8703b99a2f30.jsonl');
  await fs.writeFile(
    filePath,
    [
      jsonLine({
        timestamp: '2026-05-02T01:00:01.000Z',
        type: 'session_meta',
        payload: {
          id: '019dd001-3a02-73a0-a79e-8703b99a2f30',
          timestamp: '2026-05-02T01:00:00.000Z',
          cwd: '/work/project',
        },
      }),
      jsonLine({
        timestamp: '2026-05-02T01:00:02.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message },
      }),
    ].join('\n'),
  );
  return filePath;
};

describe('session-index', () => {
  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-session-index-'));
    vi.resetModules();
    vi.stubEnv('HOME', tempHome);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  it('skips persisted index writes when refresh output is unchanged', async () => {
    const jsonlPath = await writeSession();
    const { refreshSessionIndex, getSessionIndexPerfSnapshot } = await import('@/lib/session-index');

    await refreshSessionIndex();
    expect(getSessionIndexPerfSnapshot()).toMatchObject({
      sessions: 1,
      persistWrites: 1,
      persistSkips: 0,
    });

    await refreshSessionIndex();
    expect(getSessionIndexPerfSnapshot()).toMatchObject({
      sessions: 1,
      persistWrites: 1,
      persistSkips: 1,
    });

    await fs.appendFile(
      jsonlPath,
      `\n${jsonLine({
        timestamp: '2026-05-02T01:01:00.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Continue work' },
      })}`,
    );

    await refreshSessionIndex();
    expect(getSessionIndexPerfSnapshot()).toMatchObject({
      sessions: 1,
      persistWrites: 2,
      persistSkips: 1,
    });
  });

  it('drops legacy persisted remote rows from the session index', async () => {
    const indexDir = path.join(tempHome, '.codexwinmux');
    await fs.mkdir(indexDir, { recursive: true });
    await fs.writeFile(
      path.join(indexDir, 'session-index.json'),
      JSON.stringify({
        version: 1,
        updatedAt: '2026-05-02T00:00:00.000Z',
        sessions: [
          {
            indexKey: 'remote:win11:019dcf70-3a02-73a0-a79e-8703b99a2f38:/remote/win11.jsonl',
            indexJsonlPath: '/remote/win11.jsonl',
            indexMtimeMs: 1,
            indexSize: 1,
            sessionId: '019dcf70-3a02-73a0-a79e-8703b99a2f38',
            startedAt: '2026-05-02T00:00:00.000Z',
            lastActivityAt: '2026-05-02T00:00:01.000Z',
            firstMessage: 'Legacy Windows row',
            turnCount: 1,
            source: 'remote',
            sourceLabel: 'WIN11 / pwsh',
          },
        ],
      }),
    );

    const { getSessionIndexPage } = await import('@/lib/session-index');
    const page = await getSessionIndexPage({ waitForInitial: false });

    expect(page.total).toBe(0);
    expect(page.sessions).toEqual([]);
  });

  it('exposes local jsonlPath so the session list can open a timeline without resume fallback', async () => {
    const jsonlPath = await writeSession('Open this transcript');
    const { refreshSessionIndex, getSessionIndexPage } = await import('@/lib/session-index');

    await refreshSessionIndex();
    const page = await getSessionIndexPage({ waitForInitial: false });

    expect(page.sessions[0]).toMatchObject({
      firstMessage: 'Open this transcript',
      jsonlPath,
    });
  });

  it('prewarms the legacy session index only while legacy timeline reads own session lists', async () => {
    const { shouldPrewarmSessionIndexOnStartup } = await import('@/lib/session-index');

    expect(shouldPrewarmSessionIndexOnStartup({
      runtimeV2Enabled: false,
      timelineMode: 'default',
    })).toBe(true);
    expect(shouldPrewarmSessionIndexOnStartup({
      runtimeV2Enabled: true,
      timelineMode: undefined,
    })).toBe(false);
    expect(shouldPrewarmSessionIndexOnStartup({
      runtimeV2Enabled: true,
      timelineMode: 'default',
    })).toBe(false);
    expect(shouldPrewarmSessionIndexOnStartup({
      runtimeV2Enabled: true,
      timelineMode: 'shadow',
    })).toBe(true);
    expect(shouldPrewarmSessionIndexOnStartup({
      runtimeV2Enabled: true,
      timelineMode: 'off',
    })).toBe(true);
  });
});
