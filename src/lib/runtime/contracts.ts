import type { ILayoutData } from '@/types/terminal';
import type { IChunkReadResult, ISessionInfo, ISessionMeta, ITimelineAppendMessage, ITimelineErrorMessage, ITimelineInitMessage, TCliState } from '@/types/timeline';
import type { IMessageCountResult } from '@/lib/timeline-message-counts';
import type { ITerminalRuntimeSessionInfo } from '@/lib/runtime/terminal/terminal-runtime-contract';
import type { ICodexStateInput, IHookStateDecision, IHookStateInput, IStateDecision } from '@/lib/status-state-machine';
import type { IStatusClientEventIntent, IStatusClientEventPolicyInput } from '@/lib/status-client-event-policy';
import type { IStatusSideEffectIntent, IStatusSideEffectPolicyInput } from '@/lib/status-side-effect-policy';
import type {
  IStatusAddSessionHistoryResult,
  IStatusUpdateSessionHistoryDismissedAtResult,
} from '@/lib/runtime/status/session-history-actions';
import type { IStatusSendWebPushInput, IStatusSendWebPushResult } from '@/lib/runtime/status/web-push-actions';
import type { IClientTabStatusEntry, ILastEvent, IRateLimitsData, IStatusUpdateMessage, ITabStatusEntry, TEventName } from '@/types/status';
import type { ISessionHistoryEntry } from '@/types/session-history';

export interface IRuntimeHealth {
  ok: boolean;
  storage: unknown;
  terminal: unknown;
  timeline: unknown;
  status: unknown;
}

export interface IRuntimeWorkspace {
  id: string;
  name: string;
  defaultCwd: string;
  active: boolean | number;
  groupId?: string | null;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface IRuntimeCreateWorkspaceResult {
  id: string;
  rootPaneId: string;
}

export interface IRuntimeRenameWorkspaceInput {
  workspaceId: string;
  name: string;
}

export interface IRuntimeWorkspaceGroup {
  id: string;
  name: string;
  collapsed: boolean;
}

export interface IRuntimeWorkspaceMutationOk {
  ok: boolean;
}

export interface IRuntimeCreateWorkspaceGroupInput {
  name: string;
}

export interface IRuntimeRenameWorkspaceGroupInput {
  groupId: string;
  name: string;
}

export interface IRuntimeSetWorkspaceGroupCollapsedInput {
  groupId: string;
  collapsed: boolean;
}

export interface IRuntimeDeleteWorkspaceGroupInput {
  groupId: string;
}

export interface IRuntimeDeleteWorkspaceGroupResult {
  deleted: boolean;
}

export interface IRuntimeSetWorkspaceGroupInput {
  workspaceId: string;
  groupId: string | null;
}

export interface IRuntimeReorderWorkspaceItem {
  id: string;
  groupId?: string | null;
}

export interface IRuntimeReorderWorkspacesInput {
  items: IRuntimeReorderWorkspaceItem[];
}

export interface IRuntimeReorderWorkspaceGroupsInput {
  groupIds: string[];
}

export interface IRuntimeEnsureWorkspacePaneInput {
  workspaceId: string;
  paneId: string;
  name: string;
  defaultCwd: string;
}

export interface IRuntimeEnsureWorkspacePaneResult {
  workspaceId: string;
  paneId: string;
}

export interface IRuntimeWorkspaceList {
  workspaces: IRuntimeWorkspace[];
}

export interface IRuntimeWorkspaceTerminalSession {
  sessionName: string;
}

export interface IRuntimeTerminalSessionPresence {
  sessionName: string;
  exists: boolean;
}

export type IRuntimeTerminalSessionInfo = ITerminalRuntimeSessionInfo;

export interface IRuntimeDeleteWorkspaceStorageResult {
  deleted: boolean;
  sessions: IRuntimeWorkspaceTerminalSession[];
}

export interface IRuntimeDeleteWorkspaceResult {
  deleted: boolean;
  killedSessions: string[];
  failedKills: Array<{ sessionName: string; error: string }>;
}

export interface IRuntimeDeleteTerminalTabStorageResult {
  deleted: boolean;
  workspaceId?: string | null;
  session: IRuntimeWorkspaceTerminalSession | null;
}

export interface IRuntimeDeleteTerminalTabResult {
  deleted: boolean;
  workspaceId?: string | null;
  killedSession: string | null;
  failedKill: { sessionName: string; error: string } | null;
}

export interface IRuntimeTabStatusMetadataPatchInput {
  sessionName: string;
  agentSessionId?: string | null;
  agentJsonlPath?: string | null;
  agentSummary?: string | null;
  lastUserMessage?: string | null;
  cliState?: TCliState;
  dismissedAt?: number | null;
}

export interface IRuntimeTabStatusMetadataResult {
  updated: boolean;
  workspaceId: string | null;
  tabId: string | null;
}

export interface IRuntimeTabStatusMetadata {
  workspaceId: string;
  tabId: string;
  agentSessionId: string | null;
  agentJsonlPath: string | null;
  agentSummary: string | null;
  lastUserMessage: string | null;
  cliState: TCliState | null;
  dismissedAt: number | null;
}

export interface IRuntimeTerminalTab {
  id: string;
  sessionName: string;
  name: string;
  order: number;
  cwd?: string;
  panelType: 'terminal';
  runtimeVersion: 2;
  lifecycleState: 'pending_terminal' | 'ready' | 'failed';
}

export interface IRuntimePendingTerminalTab {
  id: string;
  sessionName: string;
  workspaceId: string;
  paneId: string;
  cwd: string;
  runtimeVersion: 2;
  lifecycleState: 'pending_terminal';
  createdAt: string;
}

export type TRuntimeLayout = ILayoutData | null;

export interface IRuntimeTimelineSessionPage {
  sessions: ISessionMeta[];
  total: number;
  hasMore: boolean;
}

export interface IRuntimeTimelineSessionListInput {
  tmuxSession: string;
  cwd?: string;
  panelType: string;
  offset: number;
  limit: number;
}

export interface IRuntimeTimelineEntriesBeforeInput {
  jsonlPath: string;
  beforeByte: number;
  limit: number;
  panelType: string;
}

export type TRuntimeTimelineEntriesBeforeResult = Pick<IChunkReadResult, 'entries' | 'startByteOffset' | 'hasMore'>;

export type TRuntimeTimelineMessageCounts = IMessageCountResult;

export interface IRuntimeTimelineLiveSubscribeInput {
  jsonlPath: string;
  sessionName: string;
  sessionId?: string;
  panelType: string;
  onAppend?: (event: IRuntimeTimelineLiveAppendEvent) => void;
  onError?: (event: IRuntimeTimelineLiveErrorEvent) => void;
}

export interface IRuntimeTimelineLiveSubscribePayload {
  subscriberId: string;
  jsonlPath: string;
  sessionName: string;
  sessionId?: string;
  panelType: string;
}

export interface IRuntimeTimelineLiveSubscribeResult {
  subscriberId: string;
  subscribed: boolean;
  init: ITimelineInitMessage;
}

export interface IRuntimeTimelineLiveUnsubscribeResult {
  subscriberId: string;
  unsubscribed: boolean;
}

export interface IRuntimeTimelineLiveAppendEvent extends Omit<ITimelineAppendMessage, 'type'> {
  subscriberId: string;
  jsonlPath: string;
}

export interface IRuntimeTimelineLiveErrorEvent extends Omit<ITimelineErrorMessage, 'type'> {
  subscriberId?: string;
  jsonlPath?: string;
}

export interface IRuntimeTimelineSessionWatchSubscribeInput {
  sessionName: string;
  panePid: number;
  panelType: string;
  skipInitial?: boolean;
  onChanged?: (event: IRuntimeTimelineSessionChangedEvent) => void;
}

export interface IRuntimeTimelineSessionWatchSubscribePayload {
  subscriberId: string;
  sessionName: string;
  panePid: number;
  panelType: string;
  skipInitial?: boolean;
}

export interface IRuntimeTimelineSessionWatchSubscribeResult {
  subscriberId: string;
  subscribed: boolean;
}

export interface IRuntimeTimelineSessionWatchUnsubscribeResult {
  subscriberId: string;
  unsubscribed: boolean;
}

export interface IRuntimeTimelineSessionChangedEvent {
  subscriberId: string;
  sessionName: string;
  info: ISessionInfo;
}

export type TRuntimeStatusHookStateInput = IHookStateInput;

export type TRuntimeStatusHookDecision = IHookStateDecision;

export type TRuntimeStatusCodexStateInput = ICodexStateInput;

export type TRuntimeStatusDecision = IStateDecision;

export interface IRuntimeStatusNotificationPolicyInput {
  eventName: TEventName;
  notificationType?: string;
  newState: string;
  silent?: boolean;
}

export interface IRuntimeStatusNotificationPolicyResult {
  processHookEvent: boolean;
  sendReviewNotification: boolean;
  sendNeedsInputNotification: boolean;
}

export type TRuntimeStatusSideEffectInput = IStatusSideEffectPolicyInput;

export type TRuntimeStatusSideEffectIntent = IStatusSideEffectIntent;

export type TRuntimeStatusClientEventInput = IStatusClientEventPolicyInput;

export type TRuntimeStatusClientEventIntent = IStatusClientEventIntent;

export type TRuntimeStatusAddSessionHistoryResult = IStatusAddSessionHistoryResult;

export type TRuntimeStatusUpdateSessionHistoryDismissedAtResult = IStatusUpdateSessionHistoryDismissedAtResult;

export interface IRuntimeStatusUpdateSessionHistoryDismissedAtInput {
  tabId: string;
  dismissedAt: number;
}

export type TRuntimeStatusSessionHistoryEntry = ISessionHistoryEntry;

export type TRuntimeStatusSendWebPushInput = IStatusSendWebPushInput;

export type TRuntimeStatusSendWebPushResult = IStatusSendWebPushResult;

export interface IRuntimeStatusLiveSyncPayload {
  tabs: Record<string, IClientTabStatusEntry>;
}

export type TRuntimeStatusLiveUpdatePayload = Omit<IStatusUpdateMessage, 'type'>;

export interface IRuntimeStatusSessionHistoryUpdatePayload {
  entry: ISessionHistoryEntry;
}

export interface IRuntimeStatusHookEventPayload {
  tabId: string;
  event: ILastEvent;
}

export interface IRuntimeStatusErrorPayload {
  code: string;
  message: string;
}

export interface IRuntimeStatusRateLimitsUpdatePayload {
  data: IRateLimitsData;
}

export type TRuntimeStatusLiveEventPayload =
  | IRuntimeStatusLiveSyncPayload
  | TRuntimeStatusLiveUpdatePayload
  | IRuntimeStatusSessionHistoryUpdatePayload
  | IRuntimeStatusHookEventPayload
  | IRuntimeStatusErrorPayload
  | IRuntimeStatusRateLimitsUpdatePayload;

export type TRuntimeStatusLiveEventType =
  | 'status.sync'
  | 'status.update'
  | 'status.session-history-update'
  | 'status.hook-event'
  | 'status.error'
  | 'status.rate-limits-update';

interface IRuntimeStatusLiveEventBase {
  kind: 'event';
  id: string;
  source: 'status';
  target: 'supervisor';
  sentAt: string;
  delivery: 'realtime';
}

export type IRuntimeStatusLiveEvent =
  | (IRuntimeStatusLiveEventBase & { type: 'status.sync'; payload: IRuntimeStatusLiveSyncPayload })
  | (IRuntimeStatusLiveEventBase & { type: 'status.update'; payload: TRuntimeStatusLiveUpdatePayload })
  | (IRuntimeStatusLiveEventBase & { type: 'status.session-history-update'; payload: IRuntimeStatusSessionHistoryUpdatePayload })
  | (IRuntimeStatusLiveEventBase & { type: 'status.hook-event'; payload: IRuntimeStatusHookEventPayload })
  | (IRuntimeStatusLiveEventBase & { type: 'status.error'; payload: IRuntimeStatusErrorPayload })
  | (IRuntimeStatusLiveEventBase & { type: 'status.rate-limits-update'; payload: IRuntimeStatusRateLimitsUpdatePayload });

export interface IRuntimeStatusLiveSubscribeInput {
  onEvent?: (event: IRuntimeStatusLiveEvent) => void;
}

export interface IRuntimeStatusLiveSubscribeResult {
  subscriberId: string;
  subscribed: boolean;
  sync: IRuntimeStatusLiveSyncPayload;
}

export interface IRuntimeStatusLiveUnsubscribeResult {
  subscriberId: string;
  unsubscribed: boolean;
}

export interface IRuntimeStatusLiveHookEventInput {
  tmuxSession: string;
  event: string;
  notificationType?: string;
}

export interface IRuntimeStatusLiveClientEventInput {
  eventType: 'dismiss-tab' | 'ack-notification';
  tabId: string;
  seq?: number;
}

export interface IRuntimeStatusLiveNotifyLastUserMessageInput {
  sessionName: string;
  message: string;
}

export interface IRuntimeStatusLiveRemoveTabInput {
  tabId: string;
}

export interface IRuntimeStatusLiveRegisterTabInput {
  tabId: string;
  entry: ITabStatusEntry;
}

export interface IRuntimeStatusLiveDeviceVisibilityInput {
  deviceId: string;
  visible: boolean;
}

export interface IRuntimeStatusLiveAcceptedResult {
  accepted: boolean;
}

export interface IRuntimeStatusLivePollResult {
  polled: boolean;
}
