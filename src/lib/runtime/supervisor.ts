import fs from 'fs';
import os from 'os';
import path from 'path';
import type {
  IRuntimeCreateWorkspaceResult,
  IRuntimeDeleteTerminalTabResult,
  IRuntimeDeleteTerminalTabStorageResult,
  IRuntimeDeleteWorkspaceResult,
  IRuntimeDeleteWorkspaceStorageResult,
  IRuntimeEnsureWorkspacePaneInput,
  IRuntimeEnsureWorkspacePaneResult,
  IRuntimeHealth,
  IRuntimeStatusNotificationPolicyInput,
  IRuntimeStatusNotificationPolicyResult,
  IRuntimeStatusLiveSubscribeInput,
  IRuntimeStatusLiveSubscribeResult,
  IRuntimeStatusLiveUnsubscribeResult,
  IRuntimeStatusLiveAcceptedResult,
  IRuntimeStatusLiveClientEventInput,
  IRuntimeStatusLiveDeviceVisibilityInput,
  IRuntimeStatusLiveHookEventInput,
  IRuntimeStatusLiveNotifyLastUserMessageInput,
  IRuntimeStatusLivePollResult,
  IRuntimeStatusLiveRegisterTabInput,
  IRuntimeStatusLiveRemoveTabInput,
  IRuntimeStatusLiveSyncPayload,
  IRuntimeStatusUpdateSessionHistoryDismissedAtInput,
  TRuntimeStatusClientEventInput,
  TRuntimeStatusClientEventIntent,
  IRuntimeStatusLiveEvent,
  TRuntimeStatusAddSessionHistoryResult,
  TRuntimeStatusSessionHistoryEntry,
  TRuntimeStatusSendWebPushInput,
  TRuntimeStatusSendWebPushResult,
  TRuntimeStatusSideEffectInput,
  TRuntimeStatusSideEffectIntent,
  TRuntimeStatusUpdateSessionHistoryDismissedAtResult,
  IRuntimeTerminalSessionPresence,
  IRuntimeTerminalTab,
  IRuntimeTimelineEntriesBeforeInput,
  IRuntimeTimelineLiveAppendEvent,
  IRuntimeTimelineLiveErrorEvent,
  IRuntimeTimelineLiveSubscribeInput,
  IRuntimeTimelineLiveSubscribePayload,
  IRuntimeTimelineLiveSubscribeResult,
  IRuntimeTimelineLiveUnsubscribeResult,
  IRuntimeTimelineSessionChangedEvent,
  IRuntimeTimelineSessionListInput,
  IRuntimeTimelineSessionPage,
  IRuntimeTimelineSessionWatchSubscribeInput,
  IRuntimeTimelineSessionWatchSubscribePayload,
  IRuntimeTimelineSessionWatchSubscribeResult,
  IRuntimeTimelineSessionWatchUnsubscribeResult,
  TRuntimeTimelineEntriesBeforeResult,
  TRuntimeTimelineMessageCounts,
  TRuntimeStatusCodexStateInput,
  TRuntimeStatusDecision,
  TRuntimeStatusHookDecision,
  TRuntimeStatusHookStateInput,
  IRuntimeWorkspace,
  TRuntimeLayout,
} from '@/lib/runtime/contracts';
import { createRuntimeId, createRuntimeSessionName, parseRuntimeSessionName } from '@/lib/runtime/session-name';
import { RuntimeWorkerClient } from '@/lib/runtime/worker-client';
import { createRuntimeEvent, type IRuntimeEvent, type TRuntimeMessage } from '@/lib/runtime/ipc';

interface IRuntimeWorkerClientLike {
  start(): void;
  waitUntilReady(): Promise<void>;
  shutdown(): void;
  request<TPayload, TResult>(type: string, payload: TPayload): Promise<TResult>;
}

export interface IRuntimeSupervisor {
  ensureStarted(): Promise<void>;
  shutdown(): void;
  health(): Promise<IRuntimeHealth>;
  listWorkspaces(): Promise<IRuntimeWorkspace[]>;
  createWorkspace(input: { name: string; defaultCwd: string }): Promise<IRuntimeCreateWorkspaceResult>;
  deleteWorkspace(workspaceId: string): Promise<IRuntimeDeleteWorkspaceResult>;
  deleteTerminalTab(tabId: string): Promise<IRuntimeDeleteTerminalTabResult>;
  listTimelineSessions(input: IRuntimeTimelineSessionListInput): Promise<IRuntimeTimelineSessionPage>;
  readTimelineEntriesBefore(input: IRuntimeTimelineEntriesBeforeInput): Promise<TRuntimeTimelineEntriesBeforeResult>;
  getTimelineMessageCounts(jsonlPath: string): Promise<TRuntimeTimelineMessageCounts>;
  subscribeTimelineLive(input: IRuntimeTimelineLiveSubscribeInput): Promise<IRuntimeTimelineLiveSubscribeResult>;
  unsubscribeTimelineLive(subscriberId: string): Promise<IRuntimeTimelineLiveUnsubscribeResult>;
  subscribeTimelineSessionWatch(input: IRuntimeTimelineSessionWatchSubscribeInput): Promise<IRuntimeTimelineSessionWatchSubscribeResult>;
  unsubscribeTimelineSessionWatch(subscriberId: string): Promise<IRuntimeTimelineSessionWatchUnsubscribeResult>;
  reduceStatusHookState(input: TRuntimeStatusHookStateInput): Promise<TRuntimeStatusHookDecision>;
  reduceStatusCodexState(input: TRuntimeStatusCodexStateInput): Promise<TRuntimeStatusDecision>;
  evaluateStatusNotificationPolicy(input: IRuntimeStatusNotificationPolicyInput): Promise<IRuntimeStatusNotificationPolicyResult>;
  evaluateStatusSideEffects(input: TRuntimeStatusSideEffectInput): Promise<TRuntimeStatusSideEffectIntent>;
  evaluateStatusClientEvent(input: TRuntimeStatusClientEventInput): Promise<TRuntimeStatusClientEventIntent>;
  addStatusSessionHistoryEntry(entry: TRuntimeStatusSessionHistoryEntry): Promise<TRuntimeStatusAddSessionHistoryResult>;
  updateStatusSessionHistoryDismissedAt(input: IRuntimeStatusUpdateSessionHistoryDismissedAtInput): Promise<TRuntimeStatusUpdateSessionHistoryDismissedAtResult>;
  sendStatusWebPush(input: TRuntimeStatusSendWebPushInput): Promise<TRuntimeStatusSendWebPushResult>;
  startStatusLive(): Promise<{ started: boolean }>;
  requestStatusLiveSync(): Promise<IRuntimeStatusLiveSyncPayload>;
  sendStatusLiveHookEvent(input: IRuntimeStatusLiveHookEventInput): Promise<IRuntimeStatusLiveAcceptedResult>;
  sendStatusLiveClientEvent(input: IRuntimeStatusLiveClientEventInput): Promise<IRuntimeStatusLiveAcceptedResult>;
  notifyStatusLiveLastUserMessage(input: IRuntimeStatusLiveNotifyLastUserMessageInput): Promise<IRuntimeStatusLiveAcceptedResult>;
  registerStatusLiveTab(input: IRuntimeStatusLiveRegisterTabInput): Promise<IRuntimeStatusLiveAcceptedResult>;
  updateStatusLiveDeviceVisibility(input: IRuntimeStatusLiveDeviceVisibilityInput): Promise<IRuntimeStatusLiveAcceptedResult>;
  removeStatusLiveTab(input: IRuntimeStatusLiveRemoveTabInput): Promise<IRuntimeStatusLiveAcceptedResult>;
  pollStatusLive(): Promise<IRuntimeStatusLivePollResult>;
  subscribeStatusLive(input: IRuntimeStatusLiveSubscribeInput): Promise<IRuntimeStatusLiveSubscribeResult>;
  unsubscribeStatusLive(subscriberId: string): Promise<IRuntimeStatusLiveUnsubscribeResult>;
  createTerminalTab(input: {
    workspaceId: string;
    paneId: string;
    cwd: string;
    ensureWorkspacePane?: {
      workspaceName: string;
      defaultCwd: string;
    };
  }): Promise<IRuntimeTerminalTab>;
  restartTerminalTab(input: {
    workspaceId: string;
    paneId: string;
    tabId: string;
    sessionName: string;
    cwd: string;
    ensureWorkspacePane?: {
      workspaceName: string;
      defaultCwd: string;
    };
  }): Promise<IRuntimeTerminalTab>;
  getLayout(workspaceId: string): Promise<TRuntimeLayout>;
  attachTerminal(input: {
    sessionName: string;
    cols: number;
    rows: number;
    send: (data: string) => void;
    close: (code: number, reason: string) => void;
  }): Promise<{ subscriberId: string }>;
  detachTerminal(input: { sessionName: string; subscriberId: string }): Promise<void>;
  writeTerminal(input: { sessionName: string; subscriberId: string; data: string }): Promise<void>;
  resizeTerminal(input: { sessionName: string; subscriberId: string; cols: number; rows: number }): Promise<void>;
}

interface IRuntimeSupervisorGlobalState {
  __ptRuntimeSupervisor?: IRuntimeSupervisor;
  __ptRuntimeSupervisorStartPromise?: Promise<void>;
  __ptRuntimeSupervisorPreparedDbPath?: string | null;
}

interface ITerminalSubscriber {
  send: (data: string) => void;
  close: (code: number, reason: string) => void;
}

interface ITerminalAttachAttempt {
  subscriberIds: Set<string>;
  attachRequested: boolean;
  promise: Promise<void>;
}

interface ITimelineLiveSubscriber {
  onAppend?: (event: IRuntimeTimelineLiveAppendEvent) => void;
  onError?: (event: IRuntimeTimelineLiveErrorEvent) => void;
}

interface ITimelineSessionWatchSubscriber {
  onChanged?: (event: IRuntimeTimelineSessionChangedEvent) => void;
}

interface IStatusLiveSubscriber {
  onEvent?: (event: IRuntimeStatusLiveEvent) => void;
}

interface IRuntimeSupervisorClients {
  storage: IRuntimeWorkerClientLike;
  terminal: IRuntimeWorkerClientLike;
  timeline: IRuntimeWorkerClientLike;
  status: IRuntimeWorkerClientLike;
}

export interface ICreateRuntimeSupervisorForTestOptions {
  storage?: IRuntimeWorkerClientLike;
  terminal?: IRuntimeWorkerClientLike;
  timeline?: IRuntimeWorkerClientLike;
  status?: IRuntimeWorkerClientLike;
  createStorageClient?: () => IRuntimeWorkerClientLike;
  createTerminalClient?: (handlers: { onEvent: (event: TRuntimeMessage) => void; onExit: () => void }) => IRuntimeWorkerClientLike;
  createTimelineClient?: (handlers: { onEvent: (event: TRuntimeMessage) => void; onExit: (err?: Error) => void }) => IRuntimeWorkerClientLike;
  createStatusClient?: (handlers: { onEvent: (event: TRuntimeMessage) => void; onExit: (err?: Error) => void }) => IRuntimeWorkerClientLike;
  captureTerminalEventHandler?: (handler: (event: IRuntimeEvent) => void) => void;
  captureTimelineEventHandler?: (handler: (event: IRuntimeEvent) => void) => void;
  captureStatusEventHandler?: (handler: (event: IRuntimeEvent) => void) => void;
  dbPath?: string;
  runtimeReset?: boolean;
  useGlobal?: boolean;
}

const g = globalThis as unknown as IRuntimeSupervisorGlobalState;

const getDbPath = (): string =>
  process.env.CODEXMUX_RUNTIME_DB || path.join(process.env.HOME || os.homedir(), '.codexwinmux', 'runtime-v2', 'state.db');

const runtimeDbFiles = (dbPath: string): string[] => [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];

const hasRuntimeDbFiles = (dbPath: string): boolean =>
  runtimeDbFiles(dbPath).some((filePath) => fs.existsSync(filePath));

const backupRuntimeDbFiles = (dbPath: string): void => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const filePath of runtimeDbFiles(dbPath)) {
    if (!fs.existsSync(filePath)) continue;
    fs.renameSync(filePath, `${filePath}.${stamp}.bak`);
  }
};

const tabId = (): string => createRuntimeId('tab');

const sessionNameFor = (workspaceId: string, paneId: string, tab: string): string =>
  createRuntimeSessionName({ workspaceId, paneId, tabId: tab });

const parseRuntimeSessionNameOrNull = (sessionName: string): string | null => {
  try {
    return parseRuntimeSessionName(sessionName);
  } catch {
    return null;
  }
};

export const createRuntimeSupervisorForTest = (
  options: ICreateRuntimeSupervisorForTestOptions = {},
): IRuntimeSupervisor => {
  if (options.useGlobal && g.__ptRuntimeSupervisor) return g.__ptRuntimeSupervisor;

  let started = false;
  let startPromise: Promise<void> | undefined;
  let preparedDbPath: string | null = null;
  let reconciledTerminalTabs = false;
  let statusLiveRetained = false;
  let clients: IRuntimeSupervisorClients | null = null;
  const terminalSubscribers = new Map<string, Map<string, ITerminalSubscriber>>();
  const terminalAttachAttempts = new Map<string, ITerminalAttachAttempt>();
  const terminalDetachPromises = new Map<string, Promise<void>>();
  const timelineLiveSubscribers = new Map<string, ITimelineLiveSubscriber>();
  const timelineSessionWatchSubscribers = new Map<string, ITimelineSessionWatchSubscriber>();
  const statusLiveSubscribers = new Map<string, IStatusLiveSubscriber>();

  const prepareRuntimeDbPath = (): string => {
    if (options.useGlobal && g.__ptRuntimeSupervisorPreparedDbPath) return g.__ptRuntimeSupervisorPreparedDbPath;
    if (preparedDbPath) return preparedDbPath;

    const dbPath = options.dbPath ?? getDbPath();
    const reset = options.runtimeReset ?? process.env.CODEXMUX_RUNTIME_V2_RESET === '1';
    if (reset && hasRuntimeDbFiles(dbPath)) backupRuntimeDbFiles(dbPath);
    preparedDbPath = dbPath;
    if (options.useGlobal) g.__ptRuntimeSupervisorPreparedDbPath = dbPath;
    return dbPath;
  };

  const closeTerminalSubscribers = (sessionName: string, code: number, reason: string): void => {
    const sessionSubscribers = terminalSubscribers.get(sessionName);
    sessionSubscribers?.forEach((subscriber) => subscriber.close(code, reason));
    terminalSubscribers.delete(sessionName);
  };

  const onTerminalWorkerEvent = (event: IRuntimeEvent): void => {
    const payload = event.payload as { sessionName?: string; data?: string };
    const sessionName = payload.sessionName;
    if (!sessionName) return;
    if (event.type === 'terminal.stdout') {
      if (typeof payload.data !== 'string') return;
      terminalSubscribers.get(sessionName)?.forEach((subscriber) => subscriber.send(payload.data as string));
      return;
    }
    if (event.type === 'terminal.backpressure') {
      closeTerminalSubscribers(sessionName, 1011, 'Terminal output backpressure');
    }
  };

  const onTerminalWorkerMessage = (message: TRuntimeMessage): void => {
    if (message.kind !== 'event') return;
    onTerminalWorkerEvent(message);
  };

  const onTerminalWorkerExit = (): void => {
    for (const sessionSubscribers of terminalSubscribers.values()) {
      sessionSubscribers.forEach((subscriber) => subscriber.close(1001, 'Terminal worker exited'));
    }
    terminalSubscribers.clear();
    terminalAttachAttempts.clear();
    terminalDetachPromises.clear();
  };

  options.captureTerminalEventHandler?.(onTerminalWorkerEvent);

  const onTimelineWorkerEvent = (event: IRuntimeEvent): void => {
    const payload = event.payload as { subscriberId?: string };
    if (event.type === 'timeline.live-append') {
      const subscriberId = payload.subscriberId;
      if (!subscriberId) return;
      timelineLiveSubscribers.get(subscriberId)?.onAppend?.(event.payload as IRuntimeTimelineLiveAppendEvent);
      return;
    }
    if (event.type === 'timeline.live-error') {
      const subscriberId = payload.subscriberId;
      if (subscriberId) {
        timelineLiveSubscribers.get(subscriberId)?.onError?.(event.payload as IRuntimeTimelineLiveErrorEvent);
        return;
      }
      timelineLiveSubscribers.forEach((subscriber) => {
        subscriber.onError?.(event.payload as IRuntimeTimelineLiveErrorEvent);
      });
      return;
    }
    if (event.type === 'timeline.session-changed') {
      const subscriberId = payload.subscriberId;
      if (!subscriberId) return;
      timelineSessionWatchSubscribers.get(subscriberId)?.onChanged?.(event.payload as IRuntimeTimelineSessionChangedEvent);
    }
  };

  const onTimelineWorkerMessage = (message: TRuntimeMessage): void => {
    if (message.kind !== 'event') return;
    onTimelineWorkerEvent(message);
  };

  const onTimelineWorkerExit = (err?: Error): void => {
    const event: IRuntimeTimelineLiveErrorEvent = {
      code: 'timeline-worker-exited',
      message: err?.message ?? 'Timeline worker exited',
    };
    timelineLiveSubscribers.forEach((subscriber) => {
      subscriber.onError?.(event);
    });
    timelineLiveSubscribers.clear();
    timelineSessionWatchSubscribers.clear();
  };

  options.captureTimelineEventHandler?.(onTimelineWorkerEvent);

  const isStatusLiveEvent = (type: string): boolean =>
    type === 'status.sync'
    || type === 'status.update'
    || type === 'status.session-history-update'
    || type === 'status.hook-event'
    || type === 'status.error'
    || type === 'status.rate-limits-update';

  const onStatusWorkerEvent = (event: IRuntimeEvent): void => {
    if (!isStatusLiveEvent(event.type)) return;
    statusLiveSubscribers.forEach((subscriber) => {
      subscriber.onEvent?.(event as IRuntimeStatusLiveEvent);
    });
  };

  const onStatusWorkerMessage = (message: TRuntimeMessage): void => {
    if (message.kind !== 'event') return;
    onStatusWorkerEvent(message);
  };

  const onStatusWorkerExit = (err?: Error): void => {
    const event = createRuntimeEvent({
      source: 'status',
      target: 'supervisor',
      type: 'status.error',
      delivery: 'realtime',
      payload: {
        code: 'status-worker-exited',
        message: err?.message ?? 'Status worker exited',
      },
    });
    statusLiveSubscribers.forEach((subscriber) => {
      subscriber.onEvent?.(event as IRuntimeStatusLiveEvent);
    });
    statusLiveSubscribers.clear();
  };

  options.captureStatusEventHandler?.(onStatusWorkerEvent);

  const createClients = (): IRuntimeSupervisorClients => ({
    storage: options.storage ?? options.createStorageClient?.() ?? new RuntimeWorkerClient({
      name: 'storage',
      workerName: 'storage-worker',
      readinessCommand: 'storage.health',
    }),
    terminal: options.terminal ?? options.createTerminalClient?.({
      onEvent: onTerminalWorkerMessage,
      onExit: onTerminalWorkerExit,
    }) ?? new RuntimeWorkerClient({
      name: 'terminal',
      workerName: 'terminal-worker',
      readinessCommand: 'terminal.health',
      onEvent: onTerminalWorkerMessage,
      onExit: onTerminalWorkerExit,
    }),
    timeline: options.timeline ?? options.createTimelineClient?.({
      onEvent: onTimelineWorkerMessage,
      onExit: onTimelineWorkerExit,
    }) ?? new RuntimeWorkerClient({
      name: 'timeline',
      workerName: 'timeline-worker',
      readinessCommand: 'timeline.health',
      onEvent: onTimelineWorkerMessage,
      onExit: onTimelineWorkerExit,
    }),
    status: options.status ?? options.createStatusClient?.({
      onEvent: onStatusWorkerMessage,
      onExit: onStatusWorkerExit,
    }) ?? new RuntimeWorkerClient({
      name: 'status',
      workerName: 'status-worker',
      readinessCommand: 'status.health',
      onEvent: onStatusWorkerMessage,
      onExit: onStatusWorkerExit,
    }),
  });

  const getClients = (): IRuntimeSupervisorClients => {
    clients ??= createClients();
    return clients;
  };

  const shutdownClients = (): void => {
    clients?.terminal.shutdown();
    clients?.timeline.shutdown();
    clients?.status.shutdown();
    clients?.storage.shutdown();
    clients = null;
  };

  const getTerminalSubscriberCount = (sessionName: string): number =>
    terminalSubscribers.get(sessionName)?.size ?? 0;

  const addTerminalSubscriber = (
    sessionName: string,
    subscriber: ITerminalSubscriber,
  ): { subscriberId: string; shouldAttach: boolean } => {
    const subscriberId = createRuntimeId('sub');
    const sessionSubscribers = terminalSubscribers.get(sessionName) ?? new Map<string, ITerminalSubscriber>();
    const shouldAttach = sessionSubscribers.size === 0;
    sessionSubscribers.set(subscriberId, subscriber);
    terminalSubscribers.set(sessionName, sessionSubscribers);
    return { subscriberId, shouldAttach };
  };

  const removeTerminalSubscribers = (sessionName: string, subscriberIds: Iterable<string>): void => {
    const sessionSubscribers = terminalSubscribers.get(sessionName);
    if (!sessionSubscribers) return;
    for (const subscriberId of subscriberIds) {
      sessionSubscribers.delete(subscriberId);
    }
    if (sessionSubscribers.size === 0) terminalSubscribers.delete(sessionName);
  };

  const waitForTerminalAttachAttempt = async (sessionName: string): Promise<void> => {
    await terminalAttachAttempts.get(sessionName)?.promise.catch(() => undefined);
  };

  const waitForTerminalDetach = async (sessionName: string): Promise<void> => {
    await terminalDetachPromises.get(sessionName)?.catch(() => undefined);
  };

  const requestTerminalDetach = (sessionName: string): Promise<void> => {
    const existing = terminalDetachPromises.get(sessionName);
    if (existing) return existing;
    const promise = getClients().terminal.request('terminal.detach', { sessionName })
      .catch(() => undefined)
      .then(() => undefined);
    terminalDetachPromises.set(sessionName, promise);
    void promise.finally(() => {
      if (terminalDetachPromises.get(sessionName) === promise) {
        terminalDetachPromises.delete(sessionName);
      }
    });
    return promise;
  };

  const assertActiveTerminalSubscriber = (input: { sessionName: string; subscriberId: string }): string => {
    const sessionName = parseRuntimeSessionName(input.sessionName);
    if (terminalSubscribers.get(sessionName)?.has(input.subscriberId)) return sessionName;
    throw Object.assign(
      new Error(`runtime v2 terminal subscriber is not active: ${input.subscriberId}`),
      { code: 'runtime-v2-terminal-subscriber-not-found', retryable: false },
    );
  };

  const assertReadyTerminalSession = async (sessionName: string): Promise<string> => {
    const parsedSessionName = parseRuntimeSessionName(sessionName);
    const { storage } = getClients();
    const tab = await storage.request<{ sessionName: string }, IRuntimeTerminalTab | null>(
      'storage.get-ready-terminal-tab-by-session',
      { sessionName: parsedSessionName },
    );
    if (!tab) {
      throw Object.assign(
        new Error(`runtime v2 terminal session is not ready: ${parsedSessionName}`),
        { code: 'runtime-v2-terminal-session-not-found', retryable: false },
      );
    }
    return parsedSessionName;
  };

  const reconcilePendingTerminalTabs = async (): Promise<void> => {
    const { storage, terminal } = getClients();
    const pendingTabs = await storage.request<Record<string, never>, Array<{ id: string; sessionName: string }>>(
      'storage.list-pending-terminal-tabs',
      {},
    );
    for (const tab of pendingTabs) {
      const sessionName = parseRuntimeSessionNameOrNull(tab.sessionName);
      if (sessionName) {
        await terminal.request('terminal.kill-session', { sessionName }).catch(() => undefined);
      }
      await storage.request('storage.fail-pending-terminal-tab', {
        id: tab.id,
        reason: sessionName ? 'startup reconciliation' : 'startup reconciliation: invalid session name',
      });
    }
  };

  const reconcileReadyTerminalTabs = async (): Promise<void> => {
    const { storage, terminal } = getClients();
    const readyTabs = await storage.request<Record<string, never>, IRuntimeTerminalTab[]>(
      'storage.list-ready-terminal-tabs',
      {},
    );
    for (const tab of readyTabs) {
      const sessionName = parseRuntimeSessionNameOrNull(tab.sessionName);
      if (!sessionName) {
        await storage.request('storage.fail-ready-terminal-tab', {
          id: tab.id,
          reason: 'startup reconciliation: invalid session name',
        });
        continue;
      }
      let exists = false;
      try {
        const presence = await terminal.request<{ sessionName: string }, IRuntimeTerminalSessionPresence>(
          'terminal.has-session',
          { sessionName },
        );
        exists = presence.exists;
      } catch (err) {
        const maybeStructured = err as { code?: string } | null;
        if (maybeStructured?.code !== 'runtime-v2-terminal-session-not-found') throw err;
      }
      if (!exists) {
        await storage.request('storage.fail-ready-terminal-tab', {
          id: tab.id,
          reason: 'startup reconciliation: tmux session missing',
        });
      }
    }
  };

  const reconcileTerminalTabs = async (): Promise<void> => {
    if (reconciledTerminalTabs) return;
    await reconcilePendingTerminalTabs();
    await reconcileReadyTerminalTabs();
    reconciledTerminalTabs = true;
  };

  const startInternal = async (): Promise<void> => {
    if (started) return;
    process.env.CODEXMUX_RUNTIME_DB = prepareRuntimeDbPath();
    const { storage, terminal, timeline, status } = getClients();
    try {
      storage.start();
      await storage.waitUntilReady();
      terminal.start();
      await terminal.waitUntilReady();
      timeline.start();
      await timeline.waitUntilReady();
      status.start();
      await status.waitUntilReady();
      await reconcileTerminalTabs();
      started = true;
    } catch (err) {
      started = false;
      reconciledTerminalTabs = false;
      shutdownClients();
      throw err;
    }
  };

  const supervisor: IRuntimeSupervisor = {
    async ensureStarted() {
      if (started) return;
      const readStartPromise = (): Promise<void> | undefined =>
        options.useGlobal ? g.__ptRuntimeSupervisorStartPromise : startPromise;
      const writeStartPromise = (value: Promise<void> | undefined): void => {
        if (options.useGlobal) g.__ptRuntimeSupervisorStartPromise = value;
        else startPromise = value;
      };
      if (!readStartPromise()) {
        writeStartPromise(startInternal().catch((err) => {
          if (!started) writeStartPromise(undefined);
          throw err;
        }));
      }
      await readStartPromise();
    },

    shutdown() {
      shutdownClients();
      started = false;
      reconciledTerminalTabs = false;
      startPromise = undefined;
      if (options.useGlobal) g.__ptRuntimeSupervisorStartPromise = undefined;
      terminalSubscribers.clear();
      terminalAttachAttempts.clear();
      terminalDetachPromises.clear();
      timelineLiveSubscribers.clear();
      timelineSessionWatchSubscribers.clear();
      statusLiveSubscribers.clear();
      statusLiveRetained = false;
    },

    async health() {
      await this.ensureStarted();
      const { storage, terminal, timeline, status } = getClients();
      const [storageHealth, terminalHealth, timelineHealth, statusHealth] = await Promise.all([
        storage.request('storage.health', {}),
        terminal.request('terminal.health', {}),
        timeline.request('timeline.health', {}),
        status.request('status.health', {}),
      ]);
      return { ok: true, storage: storageHealth, terminal: terminalHealth, timeline: timelineHealth, status: statusHealth };
    },

    async listWorkspaces() {
      await this.ensureStarted();
      return getClients().storage.request<Record<string, never>, IRuntimeWorkspace[]>('storage.list-workspaces', {});
    },

    async createWorkspace(input) {
      await this.ensureStarted();
      return getClients().storage.request<typeof input, IRuntimeCreateWorkspaceResult>('storage.create-workspace', input);
    },

    async deleteWorkspace(workspaceId) {
      await this.ensureStarted();
      const { storage, terminal } = getClients();
      const result = await storage.request<{ workspaceId: string }, IRuntimeDeleteWorkspaceStorageResult>(
        'storage.delete-workspace',
        { workspaceId },
      );
      if (!result.deleted) return { deleted: false, killedSessions: [], failedKills: [] };
      const killedSessions: string[] = [];
      const failedKills: Array<{ sessionName: string; error: string }> = [];
      for (const session of result.sessions) {
        const sessionName = parseRuntimeSessionNameOrNull(session.sessionName);
        if (!sessionName) {
          failedKills.push({ sessionName: session.sessionName, error: 'invalid runtime session name' });
          continue;
        }
        closeTerminalSubscribers(sessionName, 1000, 'Workspace deleted');
        await waitForTerminalAttachAttempt(sessionName);
        try {
          await terminal.request('terminal.kill-session', { sessionName });
          killedSessions.push(sessionName);
        } catch (err) {
          failedKills.push({
            sessionName,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return { deleted: true, killedSessions, failedKills };
    },

    async deleteTerminalTab(tabId) {
      await this.ensureStarted();
      const { storage, terminal } = getClients();
      const result = await storage.request<{ id: string }, IRuntimeDeleteTerminalTabStorageResult>(
        'storage.delete-terminal-tab',
        { id: tabId },
      );
      if (!result.deleted || !result.session) {
        return { deleted: result.deleted, killedSession: null, failedKill: null };
      }

      const sessionName = parseRuntimeSessionNameOrNull(result.session.sessionName);
      if (!sessionName) {
        return {
          deleted: true,
          killedSession: null,
          failedKill: {
            sessionName: result.session.sessionName,
            error: 'invalid runtime session name',
          },
        };
      }

      closeTerminalSubscribers(sessionName, 1000, 'Tab deleted');
      await waitForTerminalAttachAttempt(sessionName);
      try {
        await terminal.request('terminal.kill-session', { sessionName });
        return { deleted: true, killedSession: sessionName, failedKill: null };
      } catch (err) {
        return {
          deleted: true,
          killedSession: null,
          failedKill: {
            sessionName,
            error: err instanceof Error ? err.message : String(err),
          },
        };
      }
    },

    async listTimelineSessions(input) {
      await this.ensureStarted();
      return getClients().timeline.request<IRuntimeTimelineSessionListInput, IRuntimeTimelineSessionPage>(
        'timeline.list-sessions',
        input,
      );
    },

    async readTimelineEntriesBefore(input) {
      await this.ensureStarted();
      return getClients().timeline.request<IRuntimeTimelineEntriesBeforeInput, TRuntimeTimelineEntriesBeforeResult>(
        'timeline.read-entries-before',
        input,
      );
    },

    async getTimelineMessageCounts(jsonlPath) {
      await this.ensureStarted();
      return getClients().timeline.request<{ jsonlPath: string }, TRuntimeTimelineMessageCounts>(
        'timeline.message-counts',
        { jsonlPath },
      );
    },

    async subscribeTimelineLive(input) {
      await this.ensureStarted();
      const subscriberId = createRuntimeId('sub');
      timelineLiveSubscribers.set(subscriberId, {
        onAppend: input.onAppend,
        onError: input.onError,
      });
      const payload: IRuntimeTimelineLiveSubscribePayload = {
        subscriberId,
        jsonlPath: input.jsonlPath,
        sessionName: input.sessionName,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        panelType: input.panelType,
      };

      try {
        return await getClients().timeline.request<
          IRuntimeTimelineLiveSubscribePayload,
          IRuntimeTimelineLiveSubscribeResult
        >('timeline.live-subscribe', payload);
      } catch (err) {
        timelineLiveSubscribers.delete(subscriberId);
        throw err;
      }
    },

    async unsubscribeTimelineLive(subscriberId) {
      timelineLiveSubscribers.delete(subscriberId);
      await this.ensureStarted();
      return getClients().timeline.request<{ subscriberId: string }, IRuntimeTimelineLiveUnsubscribeResult>(
        'timeline.live-unsubscribe',
        { subscriberId },
      );
    },

    async subscribeTimelineSessionWatch(input) {
      await this.ensureStarted();
      const subscriberId = createRuntimeId('sub');
      timelineSessionWatchSubscribers.set(subscriberId, {
        onChanged: input.onChanged,
      });
      const payload: IRuntimeTimelineSessionWatchSubscribePayload = {
        subscriberId,
        sessionName: input.sessionName,
        panePid: input.panePid,
        panelType: input.panelType,
        ...(input.skipInitial !== undefined ? { skipInitial: input.skipInitial } : {}),
      };

      try {
        return await getClients().timeline.request<
          IRuntimeTimelineSessionWatchSubscribePayload,
          IRuntimeTimelineSessionWatchSubscribeResult
        >('timeline.session-watch-subscribe', payload);
      } catch (err) {
        timelineSessionWatchSubscribers.delete(subscriberId);
        throw err;
      }
    },

    async unsubscribeTimelineSessionWatch(subscriberId) {
      timelineSessionWatchSubscribers.delete(subscriberId);
      await this.ensureStarted();
      return getClients().timeline.request<{ subscriberId: string }, IRuntimeTimelineSessionWatchUnsubscribeResult>(
        'timeline.session-watch-unsubscribe',
        { subscriberId },
      );
    },

    async reduceStatusHookState(input) {
      await this.ensureStarted();
      return getClients().status.request<TRuntimeStatusHookStateInput, TRuntimeStatusHookDecision>(
        'status.reduce-hook-state',
        input,
      );
    },

    async reduceStatusCodexState(input) {
      await this.ensureStarted();
      return getClients().status.request<TRuntimeStatusCodexStateInput, TRuntimeStatusDecision>(
        'status.reduce-codex-state',
        input,
      );
    },

    async evaluateStatusNotificationPolicy(input) {
      await this.ensureStarted();
      return getClients().status.request<IRuntimeStatusNotificationPolicyInput, IRuntimeStatusNotificationPolicyResult>(
        'status.evaluate-notification-policy',
        input,
      );
    },

    async evaluateStatusSideEffects(input) {
      await this.ensureStarted();
      return getClients().status.request<TRuntimeStatusSideEffectInput, TRuntimeStatusSideEffectIntent>(
        'status.evaluate-side-effects',
        input,
      );
    },

    async evaluateStatusClientEvent(input) {
      await this.ensureStarted();
      return getClients().status.request<TRuntimeStatusClientEventInput, TRuntimeStatusClientEventIntent>(
        'status.evaluate-client-event',
        input,
      );
    },

    async addStatusSessionHistoryEntry(entry) {
      await this.ensureStarted();
      return getClients().status.request<
        { entry: TRuntimeStatusSessionHistoryEntry },
        TRuntimeStatusAddSessionHistoryResult
      >('status.add-session-history-entry', { entry });
    },

    async updateStatusSessionHistoryDismissedAt(input) {
      await this.ensureStarted();
      return getClients().status.request<
        IRuntimeStatusUpdateSessionHistoryDismissedAtInput,
        TRuntimeStatusUpdateSessionHistoryDismissedAtResult
      >('status.update-session-history-dismissed-at', input);
    },

    async sendStatusWebPush(input) {
      await this.ensureStarted();
      return getClients().status.request<TRuntimeStatusSendWebPushInput, TRuntimeStatusSendWebPushResult>(
        'status.send-web-push',
        input,
      );
    },

    async startStatusLive() {
      await this.ensureStarted();
      const result = await getClients().status.request<Record<string, never>, { started: boolean }>('status.live-start', {});
      statusLiveRetained = true;
      return result;
    },

    async requestStatusLiveSync() {
      await this.ensureStarted();
      return getClients().status.request<Record<string, never>, IRuntimeStatusLiveSyncPayload>(
        'status.live-request-sync',
        {},
      );
    },

    async sendStatusLiveHookEvent(input) {
      await this.ensureStarted();
      return getClients().status.request<IRuntimeStatusLiveHookEventInput, IRuntimeStatusLiveAcceptedResult>(
        'status.live-hook-event',
        input,
      );
    },

    async sendStatusLiveClientEvent(input) {
      await this.ensureStarted();
      return getClients().status.request<IRuntimeStatusLiveClientEventInput, IRuntimeStatusLiveAcceptedResult>(
        'status.live-client-event',
        input,
      );
    },

    async notifyStatusLiveLastUserMessage(input) {
      await this.ensureStarted();
      return getClients().status.request<IRuntimeStatusLiveNotifyLastUserMessageInput, IRuntimeStatusLiveAcceptedResult>(
        'status.live-notify-last-user-message',
        input,
      );
    },

    async registerStatusLiveTab(input) {
      await this.ensureStarted();
      return getClients().status.request<IRuntimeStatusLiveRegisterTabInput, IRuntimeStatusLiveAcceptedResult>(
        'status.live-register-tab',
        input,
      );
    },

    async updateStatusLiveDeviceVisibility(input) {
      await this.ensureStarted();
      return getClients().status.request<IRuntimeStatusLiveDeviceVisibilityInput, IRuntimeStatusLiveAcceptedResult>(
        'status.live-device-visibility',
        input,
      );
    },

    async removeStatusLiveTab(input) {
      await this.ensureStarted();
      return getClients().status.request<IRuntimeStatusLiveRemoveTabInput, IRuntimeStatusLiveAcceptedResult>(
        'status.live-remove-tab',
        input,
      );
    },

    async pollStatusLive() {
      await this.ensureStarted();
      return getClients().status.request<Record<string, never>, IRuntimeStatusLivePollResult>('status.live-poll', {});
    },

    async subscribeStatusLive(input) {
      await this.ensureStarted();
      const subscriberId = createRuntimeId('sub');
      const shouldStart = statusLiveSubscribers.size === 0;
      statusLiveSubscribers.set(subscriberId, { onEvent: input.onEvent });
      try {
        if (shouldStart) {
          await getClients().status.request<Record<string, never>, { started: boolean }>('status.live-start', {});
        }
        const sync = await this.requestStatusLiveSync();
        return { subscriberId, subscribed: true, sync };
      } catch (err) {
        statusLiveSubscribers.delete(subscriberId);
        if (shouldStart || statusLiveSubscribers.size === 0) {
          await getClients().status.request<Record<string, never>, { stopped: boolean }>('status.live-stop', {})
            .catch(() => undefined);
        }
        throw err;
      }
    },

    async unsubscribeStatusLive(subscriberId) {
      statusLiveSubscribers.delete(subscriberId);
      await this.ensureStarted();
      if (statusLiveSubscribers.size === 0 && !statusLiveRetained) {
        await getClients().status.request<Record<string, never>, { stopped: boolean }>('status.live-stop', {});
      }
      return { subscriberId, unsubscribed: true };
    },

    async createTerminalTab(input) {
      await this.ensureStarted();
      const { storage, terminal } = getClients();
      const id = tabId();
      const sessionName = sessionNameFor(input.workspaceId, input.paneId, id);
      if (input.ensureWorkspacePane) {
        await storage.request<IRuntimeEnsureWorkspacePaneInput, IRuntimeEnsureWorkspacePaneResult>(
          'storage.ensure-workspace-pane',
          {
            workspaceId: input.workspaceId,
            paneId: input.paneId,
            name: input.ensureWorkspacePane.workspaceName,
            defaultCwd: input.ensureWorkspacePane.defaultCwd,
          },
        );
      }
      const storageInput = { ...input, id, sessionName };
      await storage.request<typeof storageInput, { id: string; sessionName: string }>(
        'storage.create-pending-terminal-tab',
        storageInput,
      );
      try {
        await terminal.request('terminal.create-session', {
          sessionName,
          cols: 80,
          rows: 24,
          cwd: input.cwd,
        });
        return await storage.request<{ id: string }, IRuntimeTerminalTab>('storage.finalize-terminal-tab', { id });
      } catch (err) {
        await terminal.request('terminal.kill-session', { sessionName }).catch(() => undefined);
        await storage.request('storage.fail-pending-terminal-tab', {
          id,
          reason: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },

    async restartTerminalTab(input) {
      await this.ensureStarted();
      const { storage, terminal } = getClients();
      const sessionName = parseRuntimeSessionName(input.sessionName);
      if (input.ensureWorkspacePane) {
        await storage.request<IRuntimeEnsureWorkspacePaneInput, IRuntimeEnsureWorkspacePaneResult>(
          'storage.ensure-workspace-pane',
          {
            workspaceId: input.workspaceId,
            paneId: input.paneId,
            name: input.ensureWorkspacePane.workspaceName,
            defaultCwd: input.ensureWorkspacePane.defaultCwd,
          },
        );
      }

      closeTerminalSubscribers(sessionName, 1001, 'Terminal restarted');
      await waitForTerminalAttachAttempt(sessionName);

      const deleted = await storage.request<{ id: string }, IRuntimeDeleteTerminalTabStorageResult>(
        'storage.delete-terminal-tab',
        { id: input.tabId },
      );
      const sessionsToKill = new Set<string>([sessionName]);
      const deletedSession = deleted.session ? parseRuntimeSessionNameOrNull(deleted.session.sessionName) : null;
      if (deletedSession) sessionsToKill.add(deletedSession);
      await Promise.all(Array.from(sessionsToKill).map((target) =>
        terminal.request('terminal.kill-session', { sessionName: target }).catch(() => undefined),
      ));

      const storageInput = {
        id: input.tabId,
        workspaceId: input.workspaceId,
        paneId: input.paneId,
        sessionName,
        cwd: input.cwd,
      };
      await storage.request<typeof storageInput, { id: string; sessionName: string }>(
        'storage.create-pending-terminal-tab',
        storageInput,
      );
      try {
        await terminal.request('terminal.create-session', {
          sessionName,
          cols: 80,
          rows: 24,
          cwd: input.cwd,
        });
        return await storage.request<{ id: string }, IRuntimeTerminalTab>('storage.finalize-terminal-tab', { id: input.tabId });
      } catch (err) {
        await terminal.request('terminal.kill-session', { sessionName }).catch(() => undefined);
        await storage.request('storage.fail-pending-terminal-tab', {
          id: input.tabId,
          reason: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },

    async getLayout(workspaceId) {
      await this.ensureStarted();
      return getClients().storage.request<{ workspaceId: string }, TRuntimeLayout>('storage.get-layout', { workspaceId });
    },

    async attachTerminal(input) {
      await this.ensureStarted();
      const { terminal } = getClients();
      const sessionName = await assertReadyTerminalSession(input.sessionName);
      const existingAttachAttempt = terminalAttachAttempts.get(sessionName);
      const { subscriberId, shouldAttach } = addTerminalSubscriber(sessionName, {
        send: input.send,
        close: input.close,
      });
      const ownsAttachAttempt = !existingAttachAttempt && shouldAttach;
      const attachAttempt = existingAttachAttempt ?? (ownsAttachAttempt
        ? { subscriberIds: new Set<string>(), attachRequested: false, promise: Promise.resolve() }
        : null);
      attachAttempt?.subscriberIds.add(subscriberId);
      if (ownsAttachAttempt && attachAttempt) {
        attachAttempt.promise = (async () => {
          await waitForTerminalDetach(sessionName);
          attachAttempt.attachRequested = true;
          await terminal.request('terminal.attach', {
            sessionName,
            cols: input.cols,
            rows: input.rows,
          });
        })();
        terminalAttachAttempts.set(sessionName, attachAttempt);
      }
      try {
        await attachAttempt?.promise;
        return { subscriberId };
      } catch (err) {
        removeTerminalSubscribers(sessionName, attachAttempt?.subscriberIds ?? [subscriberId]);
        if (ownsAttachAttempt && attachAttempt?.attachRequested) {
          await requestTerminalDetach(sessionName);
        }
        throw err;
      } finally {
        if (ownsAttachAttempt && terminalAttachAttempts.get(sessionName) === attachAttempt) {
          terminalAttachAttempts.delete(sessionName);
        }
      }
    },

    async detachTerminal(input) {
      const sessionName = parseRuntimeSessionName(input.sessionName);
      const sessionSubscribers = terminalSubscribers.get(sessionName);
      if (!sessionSubscribers) return;
      sessionSubscribers.delete(input.subscriberId);
      const remaining = getTerminalSubscriberCount(sessionName);
      if (remaining > 0) return;
      terminalSubscribers.delete(sessionName);
      await requestTerminalDetach(sessionName);
    },

    async writeTerminal(input) {
      await this.ensureStarted();
      const sessionName = assertActiveTerminalSubscriber(input);
      await getClients().terminal.request('terminal.write-stdin', {
        sessionName,
        data: input.data,
      });
    },

    async resizeTerminal(input) {
      await this.ensureStarted();
      const sessionName = assertActiveTerminalSubscriber(input);
      await getClients().terminal.request('terminal.resize', {
        sessionName,
        cols: input.cols,
        rows: input.rows,
      });
    },
  };

  if (options.useGlobal) g.__ptRuntimeSupervisor = supervisor;
  return supervisor;
};

export const getRuntimeSupervisor = (): IRuntimeSupervisor => {
  if (g.__ptRuntimeSupervisor) return g.__ptRuntimeSupervisor;
  return createRuntimeSupervisorForTest({ useGlobal: true });
};
