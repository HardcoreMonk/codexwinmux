import { describe, expect, it } from 'vitest';

import { computeInitMeta } from '@/lib/timeline-file-watcher-service';
import { isTimelineResumeSessionIdValid } from '@/lib/timeline-resume-service';
import { getTimelineSessionConnections } from '@/lib/timeline-subscription-service';

describe('timeline server extracted boundaries', () => {
  it('keeps file watcher init metadata behind a file watcher service', () => {
    expect(computeInitMeta([
      { id: 'u1', type: 'user-message', timestamp: 1_800_000_000_000, text: 'Hi' },
      { id: 'a1', type: 'assistant-message', timestamp: 1_800_000_001_000, markdown: 'Hello' },
    ], 128)).toMatchObject({
      fileSize: 128,
      userCount: 1,
      assistantCount: 1,
      lastTimestamp: 1_800_000_001_000,
    });
  });

  it('keeps resume validation behind a resume service', () => {
    expect(isTimelineResumeSessionIdValid({ isValidSessionId: (id) => id === 'session-ok' }, 'session-ok')).toBe(true);
    expect(isTimelineResumeSessionIdValid({ isValidSessionId: (id) => id === 'session-ok' }, 'bad')).toBe(false);
  });

  it('keeps connection lookup behind a subscription service', () => {
    const ws = {} as never;
    const conn = { ws, sessionName: 'pt-ws', cleaned: false };
    expect(getTimelineSessionConnections(new Map([[ws, conn]]), 'pt-ws')).toEqual([conn]);
    expect(getTimelineSessionConnections(new Map([[ws, conn]]), 'other')).toEqual([]);
  });
});
