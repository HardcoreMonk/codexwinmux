import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  IRuntimeTimelineLiveSubscribeInput,
  IRuntimeTimelineSessionWatchSubscribeInput,
} from '@/lib/runtime/contracts';

const mocks = vi.hoisted(() => {
  const supervisor = {
    subscribeTimelineLive: vi.fn(),
    unsubscribeTimelineLive: vi.fn(),
    subscribeTimelineSessionWatch: vi.fn(),
    unsubscribeTimelineSessionWatch: vi.fn(),
  };
  return {
    supervisor,
    getRuntimeSupervisor: vi.fn(() => supervisor),
  };
});

vi.mock('@/lib/runtime/supervisor', () => ({
  getRuntimeSupervisor: mocks.getRuntimeSupervisor,
}));

import { getRuntimeTimelineAdapter } from '@/lib/runtime/timeline-runtime-adapter';

describe('runtime timeline adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards live subscribe and unsubscribe calls to the runtime supervisor boundary', async () => {
    const liveInput = {
      jsonlPath: '/tmp/session.jsonl',
      sessionName: 'rtv2-session',
      sessionId: 'session-a',
      panelType: 'codex',
    } satisfies IRuntimeTimelineLiveSubscribeInput;
    mocks.supervisor.subscribeTimelineLive.mockResolvedValueOnce({
      subscriberId: 'live-sub-a',
      subscribed: true,
      init: {
        type: 'timeline:init',
        entries: [],
        sessionId: 'session-a',
        totalEntries: 0,
        startByteOffset: 0,
        hasMore: false,
      },
    });
    mocks.supervisor.unsubscribeTimelineLive.mockResolvedValueOnce({
      subscriberId: 'live-sub-a',
      unsubscribed: true,
    });

    const adapter = getRuntimeTimelineAdapter();
    await expect(adapter.subscribeTimelineLive(liveInput)).resolves.toMatchObject({
      subscriberId: 'live-sub-a',
      subscribed: true,
    });
    await expect(adapter.unsubscribeTimelineLive('live-sub-a')).resolves.toEqual({
      subscriberId: 'live-sub-a',
      unsubscribed: true,
    });

    expect(mocks.supervisor.subscribeTimelineLive).toHaveBeenCalledWith(liveInput);
    expect(mocks.supervisor.unsubscribeTimelineLive).toHaveBeenCalledWith('live-sub-a');
  });

  it('forwards session watch subscribe and unsubscribe calls to the runtime supervisor boundary', async () => {
    const watchInput = {
      sessionName: 'rtv2-session',
      panePid: 123,
      panelType: 'codex',
      skipInitial: true,
    } satisfies IRuntimeTimelineSessionWatchSubscribeInput;
    mocks.supervisor.subscribeTimelineSessionWatch.mockResolvedValueOnce({
      subscriberId: 'watch-sub-a',
      subscribed: true,
    });
    mocks.supervisor.unsubscribeTimelineSessionWatch.mockResolvedValueOnce({
      subscriberId: 'watch-sub-a',
      unsubscribed: true,
    });

    const adapter = getRuntimeTimelineAdapter();
    await expect(adapter.subscribeTimelineSessionWatch(watchInput)).resolves.toEqual({
      subscriberId: 'watch-sub-a',
      subscribed: true,
    });
    await expect(adapter.unsubscribeTimelineSessionWatch('watch-sub-a')).resolves.toEqual({
      subscriberId: 'watch-sub-a',
      unsubscribed: true,
    });

    expect(mocks.supervisor.subscribeTimelineSessionWatch).toHaveBeenCalledWith(watchInput);
    expect(mocks.supervisor.unsubscribeTimelineSessionWatch).toHaveBeenCalledWith('watch-sub-a');
  });
});
