import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { handleRuntimeTimelineConnection } from '@/lib/runtime/timeline-ws';
import type {
  IRuntimeTimelineLiveAppendEvent,
  IRuntimeTimelineLiveSubscribeInput,
  IRuntimeTimelineSessionChangedEvent,
  IRuntimeTimelineSessionWatchSubscribeInput,
} from '@/lib/runtime/contracts';
import type { IRuntimeTimelineAdapter } from '@/lib/runtime/timeline-runtime-adapter';

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: unknown[] = [];
  closed: Array<{ code: number; reason: string }> = [];
  pings = 0;

  send(value: string): void {
    this.sent.push(JSON.parse(value));
  }

  close(code = 1000, reason = ''): void {
    this.readyState = 3;
    this.closed.push({ code, reason });
    this.emit('close');
  }

  ping(): void {
    this.pings += 1;
  }

  receive(value: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(value)));
  }
}

const sessionJsonlPath = `${process.env.HOME}/.codex/sessions/session-a.jsonl`;
const selectedJsonlPath = `${process.env.HOME}/.codex/sessions/session-b.jsonl`;

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

const initMessage = {
  type: 'timeline:init' as const,
  entries: [],
  sessionId: 'session-a',
  totalEntries: 0,
  startByteOffset: 0,
  hasMore: false,
  jsonlPath: sessionJsonlPath,
};

const selectedInitMessage = {
  ...initMessage,
  sessionId: 'session-b',
  jsonlPath: selectedJsonlPath,
};

const createSupervisor = () => {
  let onAppend: ((event: IRuntimeTimelineLiveAppendEvent) => void) | undefined;
  let onError: ((event: { code: string; message: string }) => void) | undefined;
  let onChanged: ((event: IRuntimeTimelineSessionChangedEvent) => void) | undefined;
  const calls: string[] = [];
  const supervisor = {
    subscribeTimelineLive: vi.fn(async (input: IRuntimeTimelineLiveSubscribeInput) => {
      calls.push('subscribe-live');
      onAppend = input.onAppend;
      onError = input.onError;
      return {
        subscriberId: 'sub-live',
        subscribed: true,
        init: initMessage,
      };
    }),
    unsubscribeTimelineLive: vi.fn(async () => ({ subscriberId: 'sub-live', unsubscribed: true })),
    subscribeTimelineSessionWatch: vi.fn(async (input: IRuntimeTimelineSessionWatchSubscribeInput) => {
      calls.push('subscribe-session-watch');
      onChanged = input.onChanged;
      return { subscriberId: 'sub-watch', subscribed: true };
    }),
    unsubscribeTimelineSessionWatch: vi.fn(async () => ({ subscriberId: 'sub-watch', unsubscribed: true })),
  } as unknown as IRuntimeTimelineAdapter;

  return {
    supervisor,
    calls,
    emitAppend: (event: IRuntimeTimelineLiveAppendEvent) => onAppend?.(event),
    emitError: (event: { code: string; message: string }) => onError?.(event),
    emitChanged: (event: IRuntimeTimelineSessionChangedEvent) => onChanged?.(event),
  };
};

const createConnectionInput = (overrides: Partial<Parameters<typeof handleRuntimeTimelineConnection>[1]> = {}) => ({
  sessionName: 'pt-ws-a-pane-b-tab-c',
  panePid: 123,
  panelType: 'codex',
  provider: {
    panelType: 'codex',
    displayName: 'Codex',
    isValidSessionId: () => true,
  } as never,
  detectActiveSession: async () => ({
    status: 'running' as const,
    sessionId: 'session-a',
    jsonlPath: sessionJsonlPath,
    pid: 456,
    startedAt: 1,
    cwd: process.env.HOME ?? '',
  }),
  resolveInitialJsonl: async () => ({
    jsonlPath: sessionJsonlPath,
    sessionId: 'session-a',
  }),
  handleResume: vi.fn(),
  updateTabAgentSessionId: vi.fn(),
  updateTabAgentJsonlPath: vi.fn(),
  ...overrides,
});

describe('runtime timeline websocket bridge', () => {
  it('delivers init and append through Runtime v2 live subscription', async () => {
    const fake = createSupervisor();
    const ws = new FakeSocket();

    await handleRuntimeTimelineConnection(ws as never, createConnectionInput({
      timelineAdapter: fake.supervisor,
    }));

    expect(ws.sent).toContainEqual(expect.objectContaining({
      type: 'timeline:session-changed',
      newSessionId: 'session-a',
      reason: 'session-waiting',
    }));
    expect(ws.sent).toContainEqual(expect.objectContaining({
      type: 'timeline:init',
      sessionId: 'session-a',
      jsonlPath: sessionJsonlPath,
    }));

    fake.emitAppend({
      subscriberId: 'sub-live',
      jsonlPath: sessionJsonlPath,
      entries: [{ id: 'entry-a', type: 'user-message', timestamp: 1, text: 'hello' }],
    });

    expect(ws.sent).toContainEqual({
      type: 'timeline:append',
      entries: [{ id: 'entry-a', type: 'user-message', timestamp: 1, text: 'hello' }],
    });
  });

  it('unsubscribes live and session watcher subscriptions once on close', async () => {
    const fake = createSupervisor();
    const ws = new FakeSocket();

    await handleRuntimeTimelineConnection(ws as never, createConnectionInput({
      timelineAdapter: fake.supervisor,
    }));

    ws.close(1000, 'test close');
    ws.emit('close');

    expect(fake.supervisor.unsubscribeTimelineLive).toHaveBeenCalledTimes(1);
    expect(fake.supervisor.unsubscribeTimelineLive).toHaveBeenCalledWith('sub-live');
    expect(fake.supervisor.unsubscribeTimelineSessionWatch).toHaveBeenCalledTimes(1);
    expect(fake.supervisor.unsubscribeTimelineSessionWatch).toHaveBeenCalledWith('sub-watch');
  });

  it('unsubscribes a live subscription that resolves after close', async () => {
    const fake = createSupervisor();
    const ws = new FakeSocket();
    const liveSubscribe = createDeferred<{
      subscriberId: string;
      subscribed: boolean;
      init: typeof initMessage;
    }>();
    vi.mocked(fake.supervisor.subscribeTimelineLive).mockImplementationOnce(async () => liveSubscribe.promise);

    const connection = handleRuntimeTimelineConnection(ws as never, createConnectionInput({
      timelineAdapter: fake.supervisor,
    }));

    await vi.waitFor(() => {
      expect(fake.supervisor.subscribeTimelineLive).toHaveBeenCalledTimes(1);
    });
    ws.close(1000, 'test close');
    ws.emit('close');
    liveSubscribe.resolve({ subscriberId: 'sub-live-late', subscribed: true, init: initMessage });
    await connection;

    expect(fake.supervisor.unsubscribeTimelineLive).toHaveBeenCalledTimes(1);
    expect(fake.supervisor.unsubscribeTimelineLive).toHaveBeenCalledWith('sub-live-late');
    expect(fake.supervisor.unsubscribeTimelineSessionWatch).toHaveBeenCalledTimes(1);
    expect(fake.supervisor.unsubscribeTimelineSessionWatch).toHaveBeenCalledWith('sub-watch');
  });

  it('unsubscribes a session watcher subscription that resolves after close', async () => {
    const fake = createSupervisor();
    const ws = new FakeSocket();
    const sessionWatchSubscribe = createDeferred<{ subscriberId: string; subscribed: boolean }>();
    vi.mocked(fake.supervisor.subscribeTimelineSessionWatch)
      .mockImplementationOnce(async () => sessionWatchSubscribe.promise);

    const connection = handleRuntimeTimelineConnection(ws as never, createConnectionInput({
      timelineAdapter: fake.supervisor,
    }));

    await vi.waitFor(() => {
      expect(fake.supervisor.subscribeTimelineSessionWatch).toHaveBeenCalledTimes(1);
    });
    ws.close(1000, 'test close');
    ws.emit('close');
    sessionWatchSubscribe.resolve({ subscriberId: 'sub-watch-late', subscribed: true });
    await connection;

    expect(fake.supervisor.subscribeTimelineLive).not.toHaveBeenCalled();
    expect(fake.supervisor.unsubscribeTimelineLive).not.toHaveBeenCalled();
    expect(fake.supervisor.unsubscribeTimelineSessionWatch).toHaveBeenCalledTimes(1);
    expect(fake.supervisor.unsubscribeTimelineSessionWatch).toHaveBeenCalledWith('sub-watch-late');
  });

  it('unsubscribes stale overlapping live subscribe results without sending stale init', async () => {
    const fake = createSupervisor();
    const ws = new FakeSocket();
    const updateTabAgentSessionId = vi.fn();
    const updateTabAgentJsonlPath = vi.fn();
    const initialSubscribe = createDeferred<{
      subscriberId: string;
      subscribed: boolean;
      init: typeof initMessage;
    }>();
    const selectedSubscribe = createDeferred<{
      subscriberId: string;
      subscribed: boolean;
      init: typeof selectedInitMessage;
    }>();
    vi.mocked(fake.supervisor.subscribeTimelineLive)
      .mockImplementationOnce(async () => initialSubscribe.promise)
      .mockImplementationOnce(async () => selectedSubscribe.promise);

    const connection = handleRuntimeTimelineConnection(ws as never, createConnectionInput({
      timelineAdapter: fake.supervisor,
      updateTabAgentSessionId,
      updateTabAgentJsonlPath,
    }));

    await vi.waitFor(() => {
      expect(fake.supervisor.subscribeTimelineLive).toHaveBeenCalledTimes(1);
    });
    ws.receive({ type: 'timeline:subscribe', jsonlPath: selectedJsonlPath });
    await vi.waitFor(() => {
      expect(fake.supervisor.subscribeTimelineLive).toHaveBeenCalledTimes(2);
    });

    selectedSubscribe.resolve({ subscriberId: 'sub-live-selected', subscribed: true, init: selectedInitMessage });
    await vi.waitFor(() => {
      expect(ws.sent).toContainEqual(expect.objectContaining({
        type: 'timeline:init',
        sessionId: 'session-b',
        jsonlPath: selectedJsonlPath,
      }));
    });

    initialSubscribe.resolve({ subscriberId: 'sub-live-initial', subscribed: true, init: initMessage });
    await connection;

    const initMessages = ws.sent.filter((msg) => (
      typeof msg === 'object'
      && msg !== null
      && 'type' in msg
      && msg.type === 'timeline:init'
    ));
    expect(initMessages).toHaveLength(1);
    expect(fake.supervisor.unsubscribeTimelineLive).toHaveBeenCalledTimes(1);
    expect(fake.supervisor.unsubscribeTimelineLive).toHaveBeenCalledWith('sub-live-initial');
    expect(updateTabAgentSessionId).toHaveBeenCalledTimes(1);
    expect(updateTabAgentSessionId).toHaveBeenCalledWith('session-b');
    expect(updateTabAgentJsonlPath).toHaveBeenCalledTimes(1);
    expect(updateTabAgentJsonlPath).toHaveBeenCalledWith(selectedJsonlPath);
  });

  it('subscribes the session watcher before sending an unresolved initial init', async () => {
    const fake = createSupervisor();
    const ws = new FakeSocket();
    const sentBeforeWatch: unknown[][] = [];

    vi.mocked(fake.supervisor.subscribeTimelineSessionWatch).mockImplementationOnce(async () => {
      sentBeforeWatch.push([...ws.sent]);
      return { subscriberId: 'sub-watch', subscribed: true };
    });

    await handleRuntimeTimelineConnection(ws as never, createConnectionInput({
      timelineAdapter: fake.supervisor,
      detectActiveSession: async () => ({
        status: 'running' as const,
        sessionId: null,
        jsonlPath: null,
        pid: 456,
        startedAt: 1,
        cwd: process.env.HOME ?? '',
      }),
      resolveInitialJsonl: async () => null,
    }));

    expect(sentBeforeWatch).toEqual([[]]);
    expect(ws.sent).toContainEqual(expect.objectContaining({
      type: 'timeline:init',
      totalEntries: 0,
    }));
  });

  it('switches runtime live subscription when resume resolves a jsonl path', async () => {
    const fake = createSupervisor();
    const ws = new FakeSocket();
    const handleResume = vi.fn(async () => ({
      jsonlPath: selectedJsonlPath,
      sessionId: 'session-b',
    }));

    await handleRuntimeTimelineConnection(ws as never, createConnectionInput({
      timelineAdapter: fake.supervisor,
      handleResume,
    }));

    ws.receive({ type: 'timeline:resume', sessionId: 'session-b', tmuxSession: 'pt-ws-a-pane-b-tab-c' });

    await vi.waitFor(() => {
      expect(handleResume).toHaveBeenCalledWith({
        sessionId: 'session-b',
        tmuxSession: 'pt-ws-a-pane-b-tab-c',
      });
      expect(fake.supervisor.subscribeTimelineLive).toHaveBeenCalledTimes(2);
    });

    expect(fake.supervisor.unsubscribeTimelineLive).toHaveBeenCalledWith('sub-live');
    expect(fake.supervisor.subscribeTimelineLive).toHaveBeenLastCalledWith(expect.objectContaining({
      jsonlPath: selectedJsonlPath,
      sessionId: 'session-b',
      sessionName: 'pt-ws-a-pane-b-tab-c',
      panelType: 'codex',
    }));
  });

  it('sends a classified resume error when runtime resume throws', async () => {
    const fake = createSupervisor();
    const ws = new FakeSocket();

    await handleRuntimeTimelineConnection(ws as never, createConnectionInput({
      timelineAdapter: fake.supervisor,
      handleResume: vi.fn(async () => {
        throw new Error('C:\\Users\\yohan\\private');
      }),
    }));

    ws.receive({ type: 'timeline:resume', sessionId: 'session-b', tmuxSession: 'pt-ws-a-pane-b-tab-c' });

    await vi.waitFor(() => {
      expect(ws.sent).toContainEqual({
        type: 'timeline:resume-error',
        reason: 'unknown',
        message: 'Error during resume',
      });
    });
  });
});
