import type {
  IRuntimeTimelineLiveSubscribeInput,
  IRuntimeTimelineLiveSubscribeResult,
  IRuntimeTimelineLiveUnsubscribeResult,
  IRuntimeTimelineSessionWatchSubscribeInput,
  IRuntimeTimelineSessionWatchSubscribeResult,
  IRuntimeTimelineSessionWatchUnsubscribeResult,
} from '@/lib/runtime/contracts';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';

export interface IRuntimeTimelineAdapter {
  subscribeTimelineLive(input: IRuntimeTimelineLiveSubscribeInput): Promise<IRuntimeTimelineLiveSubscribeResult>;
  unsubscribeTimelineLive(subscriberId: string): Promise<IRuntimeTimelineLiveUnsubscribeResult>;
  subscribeTimelineSessionWatch(input: IRuntimeTimelineSessionWatchSubscribeInput): Promise<IRuntimeTimelineSessionWatchSubscribeResult>;
  unsubscribeTimelineSessionWatch(subscriberId: string): Promise<IRuntimeTimelineSessionWatchUnsubscribeResult>;
}

const runtimeTimelineAdapter: IRuntimeTimelineAdapter = {
  subscribeTimelineLive: (input) => getRuntimeSupervisor().subscribeTimelineLive(input),
  unsubscribeTimelineLive: (subscriberId) => getRuntimeSupervisor().unsubscribeTimelineLive(subscriberId),
  subscribeTimelineSessionWatch: (input) => getRuntimeSupervisor().subscribeTimelineSessionWatch(input),
  unsubscribeTimelineSessionWatch: (subscriberId) => getRuntimeSupervisor().unsubscribeTimelineSessionWatch(subscriberId),
};

export const getRuntimeTimelineAdapter = (): IRuntimeTimelineAdapter => runtimeTimelineAdapter;
