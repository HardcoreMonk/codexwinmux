import { nanoid } from 'nanoid';
import { createCoreEngineClient, type ICoreEngineClient } from '@/lib/core-engine/client';
import { createCoreEngineTcpClientTransport } from '@/lib/core-engine/tcp-transport';
import {
  resolveCoreEngineBackendTransportConfig,
  type TCoreEngineBackendTransportMode,
} from '@/lib/core-engine/transport-config';
import type {
  IRuntimeCreateWorkspaceResult,
  IRuntimeCreateWorkspaceGroupInput,
  IRuntimeDeleteTerminalTabResult,
  IRuntimeDeleteWorkspaceResult,
  IRuntimeDeleteWorkspaceGroupInput,
  IRuntimeDeleteWorkspaceGroupResult,
  IRuntimeHealth,
  IRuntimeRenameWorkspaceGroupInput,
  IRuntimeRenameWorkspaceInput,
  IRuntimeReorderWorkspaceGroupsInput,
  IRuntimeReorderWorkspacesInput,
  IRuntimeRestartTerminalTabInput,
  IRuntimeSetWorkspaceGroupCollapsedInput,
  IRuntimeSetWorkspaceGroupInput,
  IRuntimeStatusLiveAcceptedResult,
  IRuntimeStatusLiveClientEventInput,
  IRuntimeStatusLiveDeviceVisibilityInput,
  IRuntimeStatusLiveEvent,
  IRuntimeStatusLiveHookEventInput,
  IRuntimeStatusLiveNotifyLastUserMessageInput,
  IRuntimeStatusLivePollResult,
  IRuntimeStatusLiveRegisterTabInput,
  IRuntimeStatusLiveRemoveTabInput,
  IRuntimeStatusLiveSubscribeInput,
  IRuntimeStatusLiveSubscribeResult,
  IRuntimeStatusLiveSyncPayload,
  IRuntimeStatusLiveUnsubscribeResult,
  IRuntimeStatusUpdateSessionHistoryDismissedAtInput,
  IRuntimeTabStatusMetadata,
  IRuntimeTabStatusMetadataPatchInput,
  IRuntimeTabStatusMetadataResult,
  IRuntimeTerminalSessionInfo,
  IRuntimeTerminalTab,
  IRuntimeTimelineEntriesBeforeInput,
  IRuntimeTimelineSessionListInput,
  IRuntimeTimelineSessionPage,
  IRuntimeWorkspace,
  IRuntimeWorkspaceGroup,
  IRuntimeWorkspaceMutationOk,
  TRuntimeLayout,
  TRuntimeStatusAddSessionHistoryResult,
  TRuntimeStatusClientEventInput,
  TRuntimeStatusClientEventIntent,
  TRuntimeStatusSendWebPushInput,
  TRuntimeStatusSendWebPushResult,
  TRuntimeStatusSessionHistoryEntry,
  TRuntimeStatusSideEffectInput,
  TRuntimeStatusSideEffectIntent,
  TRuntimeStatusUpdateSessionHistoryDismissedAtResult,
  TRuntimeTimelineEntriesBeforeResult,
  TRuntimeTimelineMessageCounts,
} from '@/lib/runtime/contracts';
import type { IRuntimeTerminalSupervisor } from '@/lib/runtime/terminal-ws';

type TCoreRuntimeApi = {
  ensureStarted: () => Promise<void>;
  health: () => Promise<IRuntimeHealth>;
  listWorkspaces: () => Promise<IRuntimeWorkspace[]>;
  createWorkspace: (input: { name: string; defaultCwd: string }) => Promise<IRuntimeCreateWorkspaceResult>;
  renameWorkspace: (input: IRuntimeRenameWorkspaceInput) => Promise<IRuntimeWorkspace | null>;
  deleteWorkspace: (workspaceId: string) => Promise<IRuntimeDeleteWorkspaceResult>;
  createWorkspaceGroup: (input: IRuntimeCreateWorkspaceGroupInput) => Promise<IRuntimeWorkspaceGroup>;
  renameWorkspaceGroup: (input: IRuntimeRenameWorkspaceGroupInput) => Promise<IRuntimeWorkspaceGroup | null>;
  setWorkspaceGroupCollapsed: (input: IRuntimeSetWorkspaceGroupCollapsedInput) => Promise<IRuntimeWorkspaceMutationOk>;
  deleteWorkspaceGroup: (input: IRuntimeDeleteWorkspaceGroupInput) => Promise<IRuntimeDeleteWorkspaceGroupResult>;
  reorderWorkspaceGroups: (input: IRuntimeReorderWorkspaceGroupsInput) => Promise<IRuntimeWorkspaceMutationOk>;
  setWorkspaceGroup: (input: IRuntimeSetWorkspaceGroupInput) => Promise<IRuntimeWorkspaceMutationOk>;
  reorderWorkspaces: (input: IRuntimeReorderWorkspacesInput) => Promise<IRuntimeWorkspaceMutationOk>;
  deleteTerminalTab: (tabId: string) => Promise<IRuntimeDeleteTerminalTabResult>;
  getTerminalSessionInfo: (sessionName: string) => Promise<IRuntimeTerminalSessionInfo>;
  createTerminalTab: (input: {
    workspaceId: string;
    paneId: string;
    cwd: string;
    ensureWorkspacePane?: {
      workspaceName: string;
      defaultCwd: string;
    };
  }) => Promise<IRuntimeTerminalTab>;
  restartTerminalTab: (input: IRuntimeRestartTerminalTabInput) => Promise<IRuntimeTerminalTab>;
  getLayout: (workspaceId: string) => Promise<TRuntimeLayout>;
  patchLayout: (input: {
    workspaceId: string;
    activePaneId?: string;
    ratioUpdate?: { path: number[]; ratio: number };
    equalize?: boolean;
  }) => Promise<TRuntimeLayout>;
  patchPane: (input: { workspaceId: string; paneId: string; activeTabId?: string }) => Promise<TRuntimeLayout>;
  splitPane: (input: {
    workspaceId: string;
    sourcePaneId: string;
    orientation: 'horizontal' | 'vertical';
    cwd?: string;
    panelType?: string;
  }) => Promise<TRuntimeLayout>;
  closePane: (input: {
    workspaceId: string;
    paneId: string;
  }) => Promise<{ layout: TRuntimeLayout; killedSessions: string[]; failedKills: Array<{ sessionName: string; error: string }> } | null>;
  reorderTabs: (input: { workspaceId: string; paneId: string; tabIds: string[] }) => Promise<TRuntimeLayout>;
  moveTab: (input: { workspaceId: string; tabId: string; fromPaneId: string; toPaneId: string; toIndex: number }) => Promise<TRuntimeLayout>;
  patchTab: (input: { workspaceId: string; paneId: string; tabId: string; patch: Record<string, unknown> }) => Promise<TRuntimeLayout>;
  patchTabStatusMetadata: (input: IRuntimeTabStatusMetadataPatchInput) => Promise<IRuntimeTabStatusMetadataResult>;
  getTabStatusMetadata: (input: { sessionName: string }) => Promise<IRuntimeTabStatusMetadata | null>;
  listTimelineSessions: (input: IRuntimeTimelineSessionListInput) => Promise<IRuntimeTimelineSessionPage>;
  readTimelineEntriesBefore: (input: IRuntimeTimelineEntriesBeforeInput) => Promise<TRuntimeTimelineEntriesBeforeResult>;
  getTimelineMessageCounts: (jsonlPath: string) => Promise<TRuntimeTimelineMessageCounts>;
  evaluateStatusSideEffects: (input: TRuntimeStatusSideEffectInput) => Promise<TRuntimeStatusSideEffectIntent>;
  evaluateStatusClientEvent: (input: TRuntimeStatusClientEventInput) => Promise<TRuntimeStatusClientEventIntent>;
  addStatusSessionHistoryEntry: (entry: TRuntimeStatusSessionHistoryEntry) => Promise<TRuntimeStatusAddSessionHistoryResult>;
  updateStatusSessionHistoryDismissedAt: (
    input: IRuntimeStatusUpdateSessionHistoryDismissedAtInput,
  ) => Promise<TRuntimeStatusUpdateSessionHistoryDismissedAtResult>;
  sendStatusWebPush: (input: TRuntimeStatusSendWebPushInput) => Promise<TRuntimeStatusSendWebPushResult>;
  startStatusLive: () => Promise<{ started: boolean }>;
  sendStatusLiveHookEvent: (input: IRuntimeStatusLiveHookEventInput) => Promise<IRuntimeStatusLiveAcceptedResult>;
  sendStatusLiveClientEvent: (input: IRuntimeStatusLiveClientEventInput) => Promise<IRuntimeStatusLiveAcceptedResult>;
  notifyStatusLiveLastUserMessage: (input: IRuntimeStatusLiveNotifyLastUserMessageInput) => Promise<IRuntimeStatusLiveAcceptedResult>;
  requestStatusLiveSync: () => Promise<IRuntimeStatusLiveSyncPayload>;
  subscribeStatusLive: (input: IRuntimeStatusLiveSubscribeInput) => Promise<IRuntimeStatusLiveSubscribeResult>;
  unsubscribeStatusLive: (subscriberId: string) => Promise<IRuntimeStatusLiveUnsubscribeResult>;
  pollStatusLive: () => Promise<IRuntimeStatusLivePollResult>;
  registerStatusLiveTab: (input: IRuntimeStatusLiveRegisterTabInput) => Promise<IRuntimeStatusLiveAcceptedResult>;
  removeStatusLiveTab: (input: IRuntimeStatusLiveRemoveTabInput) => Promise<IRuntimeStatusLiveAcceptedResult>;
  updateStatusLiveDeviceVisibility: (input: IRuntimeStatusLiveDeviceVisibilityInput) => Promise<IRuntimeStatusLiveAcceptedResult>;
};

interface ICoreEngineBackendState {
  __codexwinmuxCoreEngineClient?: ICoreEngineClient;
  __codexwinmuxCoreEngineClientMode?: TCoreEngineBackendTransportMode;
  __codexwinmuxCoreRuntimeApi?: TCoreRuntimeApi;
  __codexwinmuxCoreTerminalSupervisor?: IRuntimeTerminalSupervisor;
}

const g = globalThis as unknown as ICoreEngineBackendState;

export const createTcpCoreEngineClient = ({
  host,
  port,
  requestTimeoutMs,
}: {
  host: string;
  port: number;
  requestTimeoutMs: number;
}): ICoreEngineClient => {
  const transport = createCoreEngineTcpClientTransport({ host, port });
  const client = createCoreEngineClient({
    transport,
    requestTimeoutMs,
  });
  return {
    ...client,
    dispose: (): void => {
      client.dispose();
      transport.dispose();
    },
  };
};

export const getCoreEngineClient = (): ICoreEngineClient => {
  if (!g.__codexwinmuxCoreEngineClient) {
    const config = resolveCoreEngineBackendTransportConfig();
    g.__codexwinmuxCoreEngineClientMode = config.mode;
    g.__codexwinmuxCoreEngineClient = createTcpCoreEngineClient(config);
  }
  return g.__codexwinmuxCoreEngineClient;
};

export const resetCoreEngineBackendForTest = (): void => {
  g.__codexwinmuxCoreTerminalSupervisor = undefined;
  g.__codexwinmuxCoreRuntimeApi = undefined;
  g.__codexwinmuxCoreEngineClient?.dispose();
  g.__codexwinmuxCoreEngineClient = undefined;
  g.__codexwinmuxCoreEngineClientMode = undefined;
};

export const shutdownCoreEngineClient = (): void => {
  const mode = g.__codexwinmuxCoreEngineClientMode;
  g.__codexwinmuxCoreTerminalSupervisor = undefined;
  g.__codexwinmuxCoreRuntimeApi = undefined;
  g.__codexwinmuxCoreEngineClient?.dispose();
  g.__codexwinmuxCoreEngineClient = undefined;
  g.__codexwinmuxCoreEngineClientMode = undefined;
  void mode;
};

export const getCoreRuntimeApi = (): TCoreRuntimeApi => {
  if (g.__codexwinmuxCoreRuntimeApi) return g.__codexwinmuxCoreRuntimeApi;
  const client = (): ICoreEngineClient => getCoreEngineClient();
  const statusLiveHandlers = new Map<string, (event: IRuntimeStatusLiveEvent) => void>();

  client().onEvent((event) => {
    if (event.type !== 'core.status.live-event') return;
    const payload = event.payload as { subscriberId: string; event: IRuntimeStatusLiveEvent };
    statusLiveHandlers.get(payload.subscriberId)?.(payload.event);
  });

  const runtimeApi: TCoreRuntimeApi = {
    ensureStarted: async () => {
      await client().request('core.health', {});
    },
    health: async () => {
      const health = await client().request('core.health', {});
      return (health.runtime ?? health) as IRuntimeHealth;
    },
    listWorkspaces: async () => {
      const result = await client().request('core.workspace.list', {});
      return result.workspaces as unknown as IRuntimeWorkspace[];
    },
    createWorkspace: async (input) =>
      client().request('core.workspace.create', input) as Promise<IRuntimeCreateWorkspaceResult>,
    renameWorkspace: async (input) =>
      client().request('core.workspace.rename', input) as Promise<IRuntimeWorkspace | null>,
    deleteWorkspace: async (workspaceId) =>
      client().request('core.workspace.delete', { workspaceId }) as Promise<IRuntimeDeleteWorkspaceResult>,
    createWorkspaceGroup: async (input) =>
      client().request('core.workspace-group.create', input) as Promise<IRuntimeWorkspaceGroup>,
    renameWorkspaceGroup: async (input) =>
      client().request('core.workspace-group.rename', input) as Promise<IRuntimeWorkspaceGroup | null>,
    setWorkspaceGroupCollapsed: async (input) =>
      client().request('core.workspace-group.set-collapsed', input) as Promise<IRuntimeWorkspaceMutationOk>,
    deleteWorkspaceGroup: async (input) =>
      client().request('core.workspace-group.delete', input) as Promise<IRuntimeDeleteWorkspaceGroupResult>,
    reorderWorkspaceGroups: async (input) =>
      client().request('core.workspace-group.reorder', input) as Promise<IRuntimeWorkspaceMutationOk>,
    setWorkspaceGroup: async (input) =>
      client().request('core.workspace.set-group', input) as Promise<IRuntimeWorkspaceMutationOk>,
    reorderWorkspaces: async (input) =>
      client().request('core.workspace.reorder', input) as Promise<IRuntimeWorkspaceMutationOk>,
    getLayout: async (workspaceId) => {
      const result = await client().request('core.layout.get', { workspaceId });
      return result.layout as TRuntimeLayout;
    },
    patchLayout: async (input) => client().request('core.layout.patch', input) as Promise<TRuntimeLayout>,
    patchPane: async (input) => client().request('core.layout.pane.patch', input) as Promise<TRuntimeLayout>,
    splitPane: async (input) => client().request('core.layout.pane.split', input) as Promise<TRuntimeLayout>,
    closePane: async (input) =>
      client().request('core.layout.pane.close', input) as Promise<{
        layout: TRuntimeLayout;
        killedSessions: string[];
        failedKills: Array<{ sessionName: string; error: string }>;
      } | null>,
    reorderTabs: async (input) => client().request('core.layout.tabs.reorder', input) as Promise<TRuntimeLayout>,
    moveTab: async (input) => client().request('core.layout.tab.move', input) as Promise<TRuntimeLayout>,
    patchTab: async (input) => client().request('core.layout.tab.patch', input) as Promise<TRuntimeLayout>,
    patchTabStatusMetadata: async (input) =>
      client().request('core.tab-status.patch', input) as Promise<IRuntimeTabStatusMetadataResult>,
    getTabStatusMetadata: async (input) =>
      client().request('core.tab-status.get', input) as Promise<IRuntimeTabStatusMetadata | null>,
    createTerminalTab: async (input) =>
      client().request('core.terminal-tab.create', input) as Promise<IRuntimeTerminalTab>,
    restartTerminalTab: async (input) =>
      client().request('core.terminal-tab.restart', input) as Promise<IRuntimeTerminalTab>,
    deleteTerminalTab: async (tabId) =>
      client().request('core.terminal-tab.delete', { tabId }) as Promise<IRuntimeDeleteTerminalTabResult>,
    getTerminalSessionInfo: async (sessionName) =>
      client().request('core.terminal-session.info', { sessionName }) as Promise<IRuntimeTerminalSessionInfo>,
    listTimelineSessions: async (input) =>
      client().request('core.timeline.list-sessions', input) as unknown as Promise<IRuntimeTimelineSessionPage>,
    readTimelineEntriesBefore: async (input) =>
      client().request('core.timeline.read-entries-before', input) as Promise<TRuntimeTimelineEntriesBeforeResult>,
    getTimelineMessageCounts: async (jsonlPath) =>
      client().request('core.timeline.message-counts', { jsonlPath }) as Promise<TRuntimeTimelineMessageCounts>,
    evaluateStatusSideEffects: async (input) =>
      client().request('core.status.evaluate-side-effects', input) as Promise<TRuntimeStatusSideEffectIntent>,
    evaluateStatusClientEvent: async (input) =>
      client().request('core.status.evaluate-client-event', input) as Promise<TRuntimeStatusClientEventIntent>,
    addStatusSessionHistoryEntry: async (entry) =>
      client().request('core.status.session-history.add', { entry }) as Promise<TRuntimeStatusAddSessionHistoryResult>,
    updateStatusSessionHistoryDismissedAt: async (input) =>
      client().request(
        'core.status.session-history.update-dismissed-at',
        input,
      ) as Promise<TRuntimeStatusUpdateSessionHistoryDismissedAtResult>,
    sendStatusWebPush: async (input) =>
      client().request('core.status.web-push.send', input) as Promise<TRuntimeStatusSendWebPushResult>,
    startStatusLive: async () => client().request('core.status.live-start', {}),
    sendStatusLiveHookEvent: async (input) => client().request('core.status.live-hook-event', input),
    sendStatusLiveClientEvent: async (input) => client().request('core.status.live-client-event', input),
    notifyStatusLiveLastUserMessage: async (input) =>
      client().request('core.status.live-notify-last-user-message', input),
    requestStatusLiveSync: async () =>
      client().request('core.status.live-request-sync', {}) as Promise<IRuntimeStatusLiveSyncPayload>,
    subscribeStatusLive: async (input) => {
      const result = await client().request(
        'core.status.live-subscribe',
        {},
      ) as IRuntimeStatusLiveSubscribeResult;
      if (input.onEvent) statusLiveHandlers.set(result.subscriberId, input.onEvent);
      return result;
    },
    unsubscribeStatusLive: async (subscriberId) => {
      statusLiveHandlers.delete(subscriberId);
      return client().request('core.status.live-unsubscribe', { subscriberId });
    },
    pollStatusLive: async () => client().request('core.status.live-poll', {}),
    registerStatusLiveTab: async (input) => client().request('core.status.live-register-tab', input),
    removeStatusLiveTab: async (input) => client().request('core.status.live-remove-tab', input),
    updateStatusLiveDeviceVisibility: async (input) => client().request('core.status.live-device-visibility', input),
  };
  g.__codexwinmuxCoreRuntimeApi = runtimeApi;
  return runtimeApi;
};

export const createCoreRuntimeTerminalSupervisor = (
  client: ICoreEngineClient = getCoreEngineClient(),
): IRuntimeTerminalSupervisor => {
  const attachments = new Map<string, {
    sessionName: string;
    send: (data: string) => void;
    close: (code: number, reason: string) => void;
  }>();

  client.onEvent((event) => {
    if (event.type === 'core.terminal.stdout') {
      const payload = event.payload as { connectionId: string; sessionName: string; data: string };
      const attachment = attachments.get(payload.connectionId);
      if (attachment?.sessionName === payload.sessionName) attachment.send(payload.data);
      return;
    }
    if (event.type === 'core.terminal.closed') {
      const payload = event.payload as { connectionId: string; sessionName: string; code: number; reason: string };
      const attachment = attachments.get(payload.connectionId);
      if (!attachment || attachment.sessionName !== payload.sessionName) return;
      attachments.delete(payload.connectionId);
      attachment.close(payload.code, payload.reason);
    }
  });

  return {
    attachTerminal: async (input) => {
      const connectionId = `core-terminal-${nanoid()}`;
      attachments.set(connectionId, {
        sessionName: input.sessionName,
        send: input.send,
        close: input.close,
      });
      try {
        await client.request('core.terminal.attach', {
          connectionId,
          sessionName: input.sessionName,
          cols: input.cols,
          rows: input.rows,
        });
        return { subscriberId: connectionId };
      } catch (err) {
        attachments.delete(connectionId);
        throw err;
      }
    },
    detachTerminal: async (input) => {
      attachments.delete(input.subscriberId);
      await client.request('core.terminal.detach', {
        connectionId: input.subscriberId,
        sessionName: input.sessionName,
      });
    },
    writeTerminal: async (input) => {
      await client.request('core.terminal.write', {
        connectionId: input.subscriberId,
        sessionName: input.sessionName,
        data: input.data,
      });
    },
    resizeTerminal: async (input) => {
      await client.request('core.terminal.resize', {
        connectionId: input.subscriberId,
        sessionName: input.sessionName,
        cols: input.cols,
        rows: input.rows,
      });
    },
  };
};

export const getCoreRuntimeTerminalSupervisor = (): IRuntimeTerminalSupervisor => {
  g.__codexwinmuxCoreTerminalSupervisor ??= createCoreRuntimeTerminalSupervisor();
  return g.__codexwinmuxCoreTerminalSupervisor;
};
