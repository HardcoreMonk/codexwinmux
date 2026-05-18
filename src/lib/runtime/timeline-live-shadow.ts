import { createLogger } from '@/lib/logger';
import { getPerfNow, recordPerfCounter, recordPerfDuration } from '@/lib/perf-metrics';
import { shouldRunRuntimeTimelineV2Shadow } from '@/lib/runtime/timeline-mode';
import {
  compareRuntimeTimelineAppend,
  compareRuntimeTimelineInit,
} from '@/lib/runtime/timeline-shadow-compare';
import { getRuntimeTimelineAdapter, type IRuntimeTimelineAdapter } from '@/lib/runtime/timeline-runtime-adapter';
import type { ITimelineEntry, ITimelineInitMessage } from '@/types/timeline';

interface IRuntimeTimelineLiveShadowState {
  jsonlPath: string;
  subscriberId: string | null;
  starting: Promise<void> | null;
  expectedAppends: ITimelineEntry[][];
  actualAppends: ITimelineEntry[][];
}

export interface IStartRuntimeTimelineLiveShadowInput {
  jsonlPath: string;
  sessionName: string;
  sessionId?: string;
  panelType: string;
  expectedInit: ITimelineInitMessage;
  timelineAdapter?: IRuntimeTimelineAdapter;
  runtimeV2Enabled?: boolean;
  timelineMode?: unknown;
}

export interface IStopRuntimeTimelineLiveShadowInput {
  jsonlPath: string;
  timelineAdapter?: IRuntimeTimelineAdapter;
}

const MAX_PENDING_APPENDS = 20;
const log = createLogger('runtime-timeline-shadow');

const g = globalThis as unknown as {
  __ptRuntimeTimelineLiveShadow?: Map<string, IRuntimeTimelineLiveShadowState>;
};

const getStore = (): Map<string, IRuntimeTimelineLiveShadowState> => {
  g.__ptRuntimeTimelineLiveShadow ??= new Map();
  return g.__ptRuntimeTimelineLiveShadow;
};

const emptyState = (jsonlPath: string): IRuntimeTimelineLiveShadowState => ({
  jsonlPath,
  subscriberId: null,
  starting: null,
  expectedAppends: [],
  actualAppends: [],
});

const runtimeShadowEnabled = (input: { runtimeV2Enabled?: boolean; timelineMode?: unknown }): boolean =>
  shouldRunRuntimeTimelineV2Shadow({
    ...(input.runtimeV2Enabled !== undefined ? { runtimeV2Enabled: input.runtimeV2Enabled } : {}),
    ...(input.timelineMode !== undefined ? { timelineMode: input.timelineMode } : {}),
  });

const errorKind = (err: unknown): string =>
  err instanceof Error ? err.name || 'Error' : typeof err;

const compareInit = (expected: ITimelineInitMessage, actual: ITimelineInitMessage): void => {
  const result = compareRuntimeTimelineInit(expected, actual);
  recordPerfCounter(result.ok ? 'runtime_v2.timeline_shadow.init_match' : 'runtime_v2.timeline_shadow.init_mismatch');
  if (!result.ok) {
    log.warn(`timeline live shadow init mismatch: ${JSON.stringify(result.mismatches)}`);
  }
};

const drainAppends = (state: IRuntimeTimelineLiveShadowState): void => {
  while (state.expectedAppends.length > 0 && state.actualAppends.length > 0) {
    const expected = state.expectedAppends.shift() ?? [];
    const actual = state.actualAppends.shift() ?? [];
    const result = compareRuntimeTimelineAppend(expected, actual);
    recordPerfCounter(result.ok ? 'runtime_v2.timeline_shadow.append_match' : 'runtime_v2.timeline_shadow.append_mismatch');
    if (!result.ok) {
      log.warn(`timeline live shadow append mismatch: ${JSON.stringify(result.mismatches)}`);
    }
  }

  while (state.expectedAppends.length > MAX_PENDING_APPENDS) {
    state.expectedAppends.shift();
    recordPerfCounter('runtime_v2.timeline_shadow.expected_append_dropped');
  }
  while (state.actualAppends.length > MAX_PENDING_APPENDS) {
    state.actualAppends.shift();
    recordPerfCounter('runtime_v2.timeline_shadow.actual_append_dropped');
  }
};

export const startRuntimeTimelineLiveShadow = async (input: IStartRuntimeTimelineLiveShadowInput): Promise<void> => {
  if (!runtimeShadowEnabled(input)) return;

  const store = getStore();
  const state = store.get(input.jsonlPath) ?? emptyState(input.jsonlPath);
  store.set(input.jsonlPath, state);
  if (state.subscriberId || state.starting) return state.starting ?? undefined;

  const startedAt = getPerfNow();
  state.starting = (async () => {
    try {
      const timelineAdapter = input.timelineAdapter ?? getRuntimeTimelineAdapter();
      const result = await timelineAdapter.subscribeTimelineLive({
        jsonlPath: input.jsonlPath,
        sessionName: input.sessionName,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        panelType: input.panelType,
        onAppend: (event) => {
          state.actualAppends.push(event.entries);
          drainAppends(state);
        },
        onError: (event) => {
          recordPerfCounter('runtime_v2.timeline_shadow.error');
          log.warn(`timeline live shadow worker error: ${event.code}`);
        },
      });
      state.subscriberId = result.subscriberId;
      compareInit(input.expectedInit, result.init);
      drainAppends(state);
    } catch (err) {
      recordPerfCounter('runtime_v2.timeline_shadow.start_error');
      log.warn(`timeline live shadow start failed: ${errorKind(err)}`);
      store.delete(input.jsonlPath);
    } finally {
      recordPerfDuration('runtime_v2.timeline_shadow.start', getPerfNow() - startedAt);
      state.starting = null;
    }
  })();

  return state.starting;
};

export const recordRuntimeTimelineLiveShadowAppend = (jsonlPath: string, entries: ITimelineEntry[]): void => {
  if (!runtimeShadowEnabled({})) return;
  const state = getStore().get(jsonlPath);
  if (!state) return;
  state.expectedAppends.push(entries);
  drainAppends(state);
};

export const stopRuntimeTimelineLiveShadow = async ({
  jsonlPath,
  timelineAdapter,
}: IStopRuntimeTimelineLiveShadowInput): Promise<void> => {
  const store = getStore();
  const state = store.get(jsonlPath);
  if (!state) return;
  store.delete(jsonlPath);
  await state.starting?.catch(() => undefined);
  if (!state.subscriberId) return;
  try {
    await (timelineAdapter ?? getRuntimeTimelineAdapter()).unsubscribeTimelineLive(state.subscriberId);
  } catch (err) {
    recordPerfCounter('runtime_v2.timeline_shadow.stop_error');
    log.warn(`timeline live shadow stop failed: ${errorKind(err)}`);
  }
};

export const resetRuntimeTimelineLiveShadowForTest = (): void => {
  g.__ptRuntimeTimelineLiveShadow = new Map();
};
