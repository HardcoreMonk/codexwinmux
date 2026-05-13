import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  recordRuntimeTimelineLiveShadowAppend,
  resetRuntimeTimelineLiveShadowForTest,
  startRuntimeTimelineLiveShadow,
  stopRuntimeTimelineLiveShadow,
} from '@/lib/runtime/timeline-live-shadow';
import type { IRuntimeSupervisor } from '@/lib/runtime/supervisor';
import type { IRuntimeTimelineLiveAppendEvent, IRuntimeTimelineLiveSubscribeInput } from '@/lib/runtime/contracts';
import type { ITimelineInitMessage } from '@/types/timeline';

const originalRuntimeV2 = process.env.CODEXWINMUX_RUNTIME_V2;
const originalTimelineMode = process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE;

const initMessage: ITimelineInitMessage = {
  type: 'timeline:init',
  entries: [{ id: 'entry-a', type: 'user-message', timestamp: 1, text: 'secret prompt' }],
  sessionId: 'session-a',
  totalEntries: 1,
  startByteOffset: 0,
  hasMore: false,
  jsonlPath: '/home/test/.codex/sessions/session.jsonl',
};

describe('runtime v2 timeline live shadow', () => {
  beforeEach(() => {
    process.env.CODEXWINMUX_RUNTIME_V2 = '1';
    process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE = 'shadow';
    resetRuntimeTimelineLiveShadowForTest();
  });

  afterEach(() => {
    process.env.CODEXWINMUX_RUNTIME_V2 = originalRuntimeV2;
    process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE = originalTimelineMode;
    resetRuntimeTimelineLiveShadowForTest();
  });

  it('starts a worker live subscription, drains append comparisons, and unsubscribes', async () => {
    let onAppend: ((event: IRuntimeTimelineLiveAppendEvent) => void) | undefined;
    const supervisor = {
      subscribeTimelineLive: vi.fn(async (input: IRuntimeTimelineLiveSubscribeInput) => {
        onAppend = input.onAppend;
        return { subscriberId: 'tlsub-a', subscribed: true, init: initMessage };
      }),
      unsubscribeTimelineLive: vi.fn(async (subscriberId: string) => ({ subscriberId, unsubscribed: true })),
    } as unknown as IRuntimeSupervisor;

    await startRuntimeTimelineLiveShadow({
      jsonlPath: initMessage.jsonlPath!,
      sessionName: 'pt-ws-a-pane-b-tab-c',
      sessionId: 'session-a',
      panelType: 'codex',
      expectedInit: initMessage,
      supervisor,
    });

    expect(supervisor.subscribeTimelineLive).toHaveBeenCalledWith(expect.objectContaining({
      jsonlPath: initMessage.jsonlPath,
      sessionName: 'pt-ws-a-pane-b-tab-c',
      sessionId: 'session-a',
      panelType: 'codex',
    }));

    recordRuntimeTimelineLiveShadowAppend(initMessage.jsonlPath!, initMessage.entries);
    onAppend?.({
      subscriberId: 'tlsub-a',
      jsonlPath: initMessage.jsonlPath!,
      entries: initMessage.entries,
    });

    await stopRuntimeTimelineLiveShadow({ jsonlPath: initMessage.jsonlPath!, supervisor });
    expect(supervisor.unsubscribeTimelineLive).toHaveBeenCalledWith('tlsub-a');
  });

  it('does not start outside shadow mode', async () => {
    process.env.CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE = 'default';
    const supervisor = {
      subscribeTimelineLive: vi.fn(),
    } as unknown as IRuntimeSupervisor;

    await startRuntimeTimelineLiveShadow({
      jsonlPath: initMessage.jsonlPath!,
      sessionName: 'pt-ws-a-pane-b-tab-c',
      panelType: 'codex',
      expectedInit: initMessage,
      supervisor,
    });

    expect(supervisor.subscribeTimelineLive).not.toHaveBeenCalled();
  });
});
