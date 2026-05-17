import {
  createCoreEvent,
  createCoreReply,
  parseCoreCommand,
  type ICoreCommand,
  type ICoreEvent,
  type ICoreReply,
} from '@/lib/core-engine/contracts';

export interface ICoreEngineSupervisorAdapter {
  health(): Promise<unknown>;
  listWorkspaces(): Promise<unknown[]>;
  createWorkspace?(input: { name: string; defaultCwd: string }): Promise<{ id: string; rootPaneId: string }>;
  renameWorkspace?(input: { workspaceId: string; name: string }): Promise<unknown>;
  deleteWorkspace?(workspaceId: string): Promise<unknown>;
  createWorkspaceGroup?(input: { name: string }): Promise<unknown>;
  renameWorkspaceGroup?(input: { groupId: string; name: string }): Promise<unknown>;
  setWorkspaceGroupCollapsed?(input: { groupId: string; collapsed: boolean }): Promise<{ ok: boolean }>;
  deleteWorkspaceGroup?(input: { groupId: string }): Promise<{ deleted: boolean }>;
  reorderWorkspaceGroups?(input: { groupIds: string[] }): Promise<{ ok: boolean }>;
  setWorkspaceGroup?(input: { workspaceId: string; groupId: string | null }): Promise<{ ok: boolean }>;
  reorderWorkspaces?(input: { items: Array<{ id: string; groupId?: string | null }> }): Promise<{ ok: boolean }>;
  getLayout?(workspaceId: string): Promise<unknown>;
  patchLayout?(input: {
    workspaceId: string;
    activePaneId?: string;
    ratioUpdate?: { path: number[]; ratio: number };
    equalize?: boolean;
  }): Promise<unknown>;
  patchPane?(input: { workspaceId: string; paneId: string; activeTabId?: string }): Promise<unknown>;
  splitPane?(input: {
    workspaceId: string;
    sourcePaneId: string;
    orientation: 'horizontal' | 'vertical';
    cwd?: string;
    panelType?: string;
  }): Promise<unknown>;
  closePane?(input: { workspaceId: string; paneId: string }): Promise<unknown>;
  reorderTabs?(input: { workspaceId: string; paneId: string; tabIds: string[] }): Promise<unknown>;
  moveTab?(input: { workspaceId: string; tabId: string; fromPaneId: string; toPaneId: string; toIndex: number }): Promise<unknown>;
  patchTab?(input: { workspaceId: string; paneId: string; tabId: string; patch: Record<string, unknown> }): Promise<unknown>;
  createTerminalTab?(input: {
    workspaceId: string;
    paneId: string;
    cwd: string;
    ensureWorkspacePane?: {
      workspaceName: string;
      defaultCwd: string;
    };
  }): Promise<unknown>;
  restartTerminalTab?(input: {
    workspaceId: string;
    paneId: string;
    tabId: string;
    sessionName: string;
    cwd: string;
    ensureWorkspacePane?: {
      workspaceName: string;
      defaultCwd: string;
    };
  }): Promise<unknown>;
  deleteTerminalTab?(tabId: string): Promise<unknown>;
  getTerminalSessionInfo?(sessionName: string): Promise<unknown>;
  attachTerminal?(input: {
    sessionName: string;
    cols: number;
    rows: number;
    send: (data: string) => void;
    close: (code: number, reason: string) => void;
  }): Promise<{ subscriberId: string }>;
  detachTerminal?(input: { sessionName: string; subscriberId: string }): Promise<void>;
  writeTerminal?(input: { sessionName: string; subscriberId: string; data: string }): Promise<void>;
  resizeTerminal?(input: { sessionName: string; subscriberId: string; cols: number; rows: number }): Promise<void>;
  listTimelineSessions?(input: {
    tmuxSession: string;
    panelType: string;
    offset: number;
    limit: number;
    cwd?: string;
  }): Promise<{ sessions: unknown[]; total: number; hasMore: boolean }>;
  readTimelineEntriesBefore?(input: {
    jsonlPath: string;
    beforeByte: number;
    limit: number;
    panelType: string;
  }): Promise<unknown>;
  getTimelineMessageCounts?(jsonlPath: string): Promise<unknown>;
  evaluateStatusSideEffects?(input: unknown): Promise<unknown>;
  evaluateStatusClientEvent?(input: unknown): Promise<unknown>;
  addStatusSessionHistoryEntry?(entry: unknown): Promise<unknown>;
  updateStatusSessionHistoryDismissedAt?(input: { tabId: string; dismissedAt: number }): Promise<unknown>;
  sendStatusWebPush?(input: { anyDeviceVisible: boolean; payload: unknown }): Promise<unknown>;
  startStatusLive?(): Promise<{ started: boolean }>;
  sendStatusLiveHookEvent?(input: { tmuxSession: string; event: string; notificationType?: string }): Promise<{ accepted: boolean }>;
  sendStatusLiveClientEvent?(input: { eventType: 'dismiss-tab' | 'ack-notification'; tabId: string; seq?: number }): Promise<{ accepted: boolean }>;
  notifyStatusLiveLastUserMessage?(input: { sessionName: string; message: string }): Promise<{ accepted: boolean }>;
  requestStatusLiveSync?(): Promise<{ tabs: Record<string, unknown> }>;
  subscribeStatusLive?(input: { onEvent?: (event: unknown) => void }): Promise<{
    subscriberId: string;
    subscribed: boolean;
    sync: { tabs: Record<string, unknown> };
  }>;
  unsubscribeStatusLive?(subscriberId: string): Promise<{ subscriberId: string; unsubscribed: boolean }>;
  pollStatusLive?(): Promise<{ polled: boolean }>;
  registerStatusLiveTab?(input: { tabId: string; entry: unknown }): Promise<{ accepted: boolean }>;
  removeStatusLiveTab?(input: { tabId: string }): Promise<{ accepted: boolean }>;
  updateStatusLiveDeviceVisibility?(input: { deviceId: string; visible: boolean }): Promise<{ accepted: boolean }>;
  patchTabStatusMetadata?(input: {
    sessionName: string;
    agentSessionId?: string | null;
    agentJsonlPath?: string | null;
    agentSummary?: string | null;
    lastUserMessage?: string | null;
    cliState?: string;
    dismissedAt?: number | null;
  }): Promise<unknown>;
  getTabStatusMetadata?(input: { sessionName: string }): Promise<unknown>;
}

export interface ICoreEngineServer {
  handleCommand(message: unknown): Promise<ICoreReply>;
}

const coreError = (err: unknown): { code: string; message: string; retryable: boolean } => {
  if (err instanceof Error) {
    const shaped = err as Error & { code?: unknown; retryable?: unknown };
    return {
      code: typeof shaped.code === 'string' ? shaped.code : 'core-command-failed',
      message: err.message,
      retryable: typeof shaped.retryable === 'boolean' ? shaped.retryable : true,
    };
  }
  return {
    code: 'core-command-failed',
    message: String(err),
    retryable: true,
  };
};

const requireMethod = <TMethod>(
  method: TMethod | undefined,
  name: string,
): TMethod => {
  if (!method) {
    throw Object.assign(new Error(`Core method is not implemented: ${name}`), {
      code: 'core-method-unimplemented',
      retryable: false,
    });
  }
  return method;
};

const callSupervisorMethod = async <TArgs extends unknown[], TResult>(
  supervisor: ICoreEngineSupervisorAdapter,
  method: ((...args: TArgs) => Promise<TResult>) | undefined,
  name: string,
  ...args: TArgs
): Promise<TResult> =>
  requireMethod(method, name).apply(supervisor, args);

export const createCoreEngineServer = ({
  supervisor,
  emit,
}: {
  supervisor: ICoreEngineSupervisorAdapter;
  emit?: (event: ICoreEvent) => void;
}): ICoreEngineServer => {
  const terminalConnections = new Map<string, { sessionName: string; subscriberId: string }>();

  const dispatch = async (command: ICoreCommand): Promise<unknown> => {
    switch (command.type) {
      case 'core.health':
        return {
          ok: true,
          runtime: await supervisor.health(),
        };
      case 'core.runtime.phase6':
        return {
          ok: true,
          modes: {
            terminalV2Mode: 'new-tabs',
            storageV2Mode: 'default',
            timelineV2Mode: 'default',
            statusV2Mode: 'default',
          },
          checks: [],
          failures: [],
        };
      case 'core.workspace.list':
        return { workspaces: await supervisor.listWorkspaces() };
      case 'core.workspace.create': {
        const payload = command.payload as { name: string; defaultCwd: string };
        return callSupervisorMethod(supervisor, supervisor.createWorkspace, 'createWorkspace', payload);
      }
      case 'core.workspace.rename': {
        const payload = command.payload as { workspaceId: string; name: string };
        return callSupervisorMethod(supervisor, supervisor.renameWorkspace, 'renameWorkspace', payload);
      }
      case 'core.workspace.delete': {
        const payload = command.payload as { workspaceId: string };
        return callSupervisorMethod(supervisor, supervisor.deleteWorkspace, 'deleteWorkspace', payload.workspaceId);
      }
      case 'core.workspace-group.create': {
        const payload = command.payload as { name: string };
        return callSupervisorMethod(supervisor, supervisor.createWorkspaceGroup, 'createWorkspaceGroup', payload);
      }
      case 'core.workspace-group.rename': {
        const payload = command.payload as { groupId: string; name: string };
        return callSupervisorMethod(supervisor, supervisor.renameWorkspaceGroup, 'renameWorkspaceGroup', payload);
      }
      case 'core.workspace-group.set-collapsed': {
        const payload = command.payload as { groupId: string; collapsed: boolean };
        return callSupervisorMethod(supervisor, supervisor.setWorkspaceGroupCollapsed, 'setWorkspaceGroupCollapsed', payload);
      }
      case 'core.workspace-group.delete': {
        const payload = command.payload as { groupId: string };
        return callSupervisorMethod(supervisor, supervisor.deleteWorkspaceGroup, 'deleteWorkspaceGroup', payload);
      }
      case 'core.workspace-group.reorder': {
        const payload = command.payload as { groupIds: string[] };
        return callSupervisorMethod(supervisor, supervisor.reorderWorkspaceGroups, 'reorderWorkspaceGroups', payload);
      }
      case 'core.workspace.set-group': {
        const payload = command.payload as { workspaceId: string; groupId: string | null };
        return callSupervisorMethod(supervisor, supervisor.setWorkspaceGroup, 'setWorkspaceGroup', payload);
      }
      case 'core.workspace.reorder': {
        const payload = command.payload as { items: Array<{ id: string; groupId?: string | null }> };
        return callSupervisorMethod(supervisor, supervisor.reorderWorkspaces, 'reorderWorkspaces', payload);
      }
      case 'core.layout.get': {
        const payload = command.payload as { workspaceId: string };
        return { layout: await callSupervisorMethod(supervisor, supervisor.getLayout, 'getLayout', payload.workspaceId) };
      }
      case 'core.layout.patch': {
        const payload = command.payload as {
          workspaceId: string;
          activePaneId?: string;
          ratioUpdate?: { path: number[]; ratio: number };
          equalize?: boolean;
        };
        return callSupervisorMethod(supervisor, supervisor.patchLayout, 'patchLayout', payload);
      }
      case 'core.layout.pane.patch': {
        const payload = command.payload as { workspaceId: string; paneId: string; activeTabId?: string };
        return callSupervisorMethod(supervisor, supervisor.patchPane, 'patchPane', payload);
      }
      case 'core.layout.pane.split': {
        const payload = command.payload as {
          workspaceId: string;
          sourcePaneId: string;
          orientation: 'horizontal' | 'vertical';
          cwd?: string;
          panelType?: string;
        };
        return callSupervisorMethod(supervisor, supervisor.splitPane, 'splitPane', payload);
      }
      case 'core.layout.pane.close': {
        const payload = command.payload as { workspaceId: string; paneId: string };
        return callSupervisorMethod(supervisor, supervisor.closePane, 'closePane', payload);
      }
      case 'core.layout.tabs.reorder': {
        const payload = command.payload as { workspaceId: string; paneId: string; tabIds: string[] };
        return callSupervisorMethod(supervisor, supervisor.reorderTabs, 'reorderTabs', payload);
      }
      case 'core.layout.tab.move': {
        const payload = command.payload as {
          workspaceId: string;
          tabId: string;
          fromPaneId: string;
          toPaneId: string;
          toIndex: number;
        };
        return callSupervisorMethod(supervisor, supervisor.moveTab, 'moveTab', payload);
      }
      case 'core.layout.tab.patch': {
        const payload = command.payload as { workspaceId: string; paneId: string; tabId: string; patch: Record<string, unknown> };
        return callSupervisorMethod(supervisor, supervisor.patchTab, 'patchTab', payload);
      }
      case 'core.terminal-tab.create': {
        const payload = command.payload as {
          workspaceId: string;
          paneId: string;
          cwd: string;
          ensureWorkspacePane?: { workspaceName: string; defaultCwd: string };
        };
        return callSupervisorMethod(supervisor, supervisor.createTerminalTab, 'createTerminalTab', payload);
      }
      case 'core.terminal-tab.delete': {
        const payload = command.payload as { tabId: string };
        return callSupervisorMethod(supervisor, supervisor.deleteTerminalTab, 'deleteTerminalTab', payload.tabId);
      }
      case 'core.terminal-tab.restart': {
        const payload = command.payload as {
          workspaceId: string;
          paneId: string;
          tabId: string;
          sessionName: string;
          cwd: string;
          ensureWorkspacePane?: { workspaceName: string; defaultCwd: string };
        };
        return callSupervisorMethod(supervisor, supervisor.restartTerminalTab, 'restartTerminalTab', payload);
      }
      case 'core.terminal.attach': {
        const payload = command.payload as {
          connectionId: string;
          sessionName: string;
          cols: number;
          rows: number;
        };
        let closedDuringAttach = false;
        const attachment = await callSupervisorMethod(supervisor, supervisor.attachTerminal, 'attachTerminal', {
          sessionName: payload.sessionName,
          cols: payload.cols,
          rows: payload.rows,
          send: (data) => {
            emit?.(createCoreEvent({
              type: 'core.terminal.stdout',
              payload: {
                connectionId: payload.connectionId,
                sessionName: payload.sessionName,
                data,
              },
            }));
          },
          close: (code, reason) => {
            closedDuringAttach = true;
            terminalConnections.delete(payload.connectionId);
            emit?.(createCoreEvent({
              type: 'core.terminal.closed',
              payload: {
                connectionId: payload.connectionId,
                sessionName: payload.sessionName,
                code,
                reason,
              },
            }));
          },
        });
        if (!closedDuringAttach) {
          terminalConnections.set(payload.connectionId, {
            sessionName: payload.sessionName,
            subscriberId: attachment.subscriberId,
          });
        }
        return { subscriberId: payload.connectionId };
      }
      case 'core.terminal.write': {
        const payload = command.payload as { connectionId: string; sessionName: string; data: string };
        const connection = terminalConnections.get(payload.connectionId);
        if (!connection) {
          throw Object.assign(new Error(`Core terminal subscriber not found: ${payload.connectionId}`), {
            code: 'runtime-v2-terminal-subscriber-not-found',
            retryable: false,
          });
        }
          await callSupervisorMethod(supervisor, supervisor.writeTerminal, 'writeTerminal', {
            sessionName: connection.sessionName,
            subscriberId: connection.subscriberId,
            data: payload.data,
        });
        return { ok: true };
      }
      case 'core.terminal.resize': {
        const payload = command.payload as { connectionId: string; sessionName: string; cols: number; rows: number };
        const connection = terminalConnections.get(payload.connectionId);
        if (!connection) {
          throw Object.assign(new Error(`Core terminal subscriber not found: ${payload.connectionId}`), {
            code: 'runtime-v2-terminal-subscriber-not-found',
            retryable: false,
          });
        }
          await callSupervisorMethod(supervisor, supervisor.resizeTerminal, 'resizeTerminal', {
            sessionName: connection.sessionName,
            subscriberId: connection.subscriberId,
            cols: payload.cols,
          rows: payload.rows,
        });
        return { ok: true };
      }
      case 'core.terminal.detach': {
        const payload = command.payload as { connectionId: string; sessionName: string };
        const connection = terminalConnections.get(payload.connectionId);
        terminalConnections.delete(payload.connectionId);
        if (connection) {
          await callSupervisorMethod(supervisor, supervisor.detachTerminal, 'detachTerminal', {
            sessionName: connection.sessionName,
            subscriberId: connection.subscriberId,
          });
        }
        return { ok: true };
      }
      case 'core.terminal-session.info': {
        const payload = command.payload as { sessionName: string };
        return callSupervisorMethod(supervisor, supervisor.getTerminalSessionInfo, 'getTerminalSessionInfo', payload.sessionName);
      }
      case 'core.timeline.list-sessions': {
        const payload = command.payload as {
          tmuxSession: string;
          panelType: string;
          offset: number;
          limit: number;
          cwd?: string;
        };
        return callSupervisorMethod(supervisor, supervisor.listTimelineSessions, 'listTimelineSessions', payload);
      }
      case 'core.timeline.read-entries-before': {
        const payload = command.payload as {
          jsonlPath: string;
          beforeByte: number;
          limit: number;
          panelType: string;
        };
        return callSupervisorMethod(supervisor, supervisor.readTimelineEntriesBefore, 'readTimelineEntriesBefore', payload);
      }
      case 'core.timeline.message-counts': {
        const payload = command.payload as { jsonlPath: string };
        return callSupervisorMethod(supervisor, supervisor.getTimelineMessageCounts, 'getTimelineMessageCounts', payload.jsonlPath);
      }
      case 'core.status.evaluate-side-effects':
        return callSupervisorMethod(supervisor, supervisor.evaluateStatusSideEffects, 'evaluateStatusSideEffects', command.payload);
      case 'core.status.evaluate-client-event':
        return callSupervisorMethod(supervisor, supervisor.evaluateStatusClientEvent, 'evaluateStatusClientEvent', command.payload);
      case 'core.status.session-history.add': {
        const payload = command.payload as { entry: unknown };
        return callSupervisorMethod(supervisor, supervisor.addStatusSessionHistoryEntry, 'addStatusSessionHistoryEntry', payload.entry);
      }
      case 'core.status.session-history.update-dismissed-at': {
        const payload = command.payload as { tabId: string; dismissedAt: number };
        return callSupervisorMethod(
          supervisor,
          supervisor.updateStatusSessionHistoryDismissedAt,
          'updateStatusSessionHistoryDismissedAt',
          payload,
        );
      }
      case 'core.status.web-push.send': {
        const payload = command.payload as { anyDeviceVisible: boolean; payload: unknown };
        return callSupervisorMethod(supervisor, supervisor.sendStatusWebPush, 'sendStatusWebPush', payload);
      }
      case 'core.status.live-start':
        return callSupervisorMethod(supervisor, supervisor.startStatusLive, 'startStatusLive');
      case 'core.status.live-hook-event': {
        const payload = command.payload as { tmuxSession: string; event: string; notificationType?: string };
        return callSupervisorMethod(supervisor, supervisor.sendStatusLiveHookEvent, 'sendStatusLiveHookEvent', payload);
      }
      case 'core.status.live-client-event': {
        const payload = command.payload as { eventType: 'dismiss-tab' | 'ack-notification'; tabId: string; seq?: number };
        return callSupervisorMethod(supervisor, supervisor.sendStatusLiveClientEvent, 'sendStatusLiveClientEvent', payload);
      }
      case 'core.status.live-notify-last-user-message': {
        const payload = command.payload as { sessionName: string; message: string };
        return callSupervisorMethod(supervisor, supervisor.notifyStatusLiveLastUserMessage, 'notifyStatusLiveLastUserMessage', payload);
      }
      case 'core.status.live-request-sync':
        return callSupervisorMethod(supervisor, supervisor.requestStatusLiveSync, 'requestStatusLiveSync');
      case 'core.status.live-subscribe': {
        let subscriberId: string | null = null;
        const result = await callSupervisorMethod(supervisor, supervisor.subscribeStatusLive, 'subscribeStatusLive', {
          onEvent: (event: unknown) => {
            if (!subscriberId) return;
            emit?.(createCoreEvent({
              type: 'core.status.live-event',
              payload: {
                subscriberId,
                event,
              },
            }));
          },
        });
        subscriberId = result.subscriberId;
        return result;
      }
      case 'core.status.live-unsubscribe': {
        const payload = command.payload as { subscriberId: string };
        return callSupervisorMethod(supervisor, supervisor.unsubscribeStatusLive, 'unsubscribeStatusLive', payload.subscriberId);
      }
      case 'core.status.live-poll':
        return callSupervisorMethod(supervisor, supervisor.pollStatusLive, 'pollStatusLive');
      case 'core.status.live-register-tab': {
        const payload = command.payload as { tabId: string; entry: unknown };
        return callSupervisorMethod(supervisor, supervisor.registerStatusLiveTab, 'registerStatusLiveTab', payload);
      }
      case 'core.status.live-remove-tab': {
        const payload = command.payload as { tabId: string };
        return callSupervisorMethod(supervisor, supervisor.removeStatusLiveTab, 'removeStatusLiveTab', payload);
      }
      case 'core.status.live-device-visibility': {
        const payload = command.payload as { deviceId: string; visible: boolean };
        return callSupervisorMethod(supervisor, supervisor.updateStatusLiveDeviceVisibility, 'updateStatusLiveDeviceVisibility', payload);
      }
      case 'core.tab-status.patch': {
        const payload = command.payload as {
          sessionName: string;
          agentSessionId?: string | null;
          agentJsonlPath?: string | null;
          agentSummary?: string | null;
          lastUserMessage?: string | null;
          cliState?: string;
          dismissedAt?: number | null;
        };
        return callSupervisorMethod(supervisor, supervisor.patchTabStatusMetadata, 'patchTabStatusMetadata', payload);
      }
      case 'core.tab-status.get': {
        const payload = command.payload as { sessionName: string };
        return callSupervisorMethod(supervisor, supervisor.getTabStatusMetadata, 'getTabStatusMetadata', payload);
      }
      default:
        throw Object.assign(new Error(`Core command is not implemented: ${command.type}`), {
          code: 'core-command-unimplemented',
          retryable: false,
        });
    }
  };

  return {
    handleCommand: async (message: unknown): Promise<ICoreReply> => {
      const command = parseCoreCommand(message);
      try {
        const payload = await dispatch(command);
        return createCoreReply({
          command,
          ok: true,
          payload: payload as never,
        });
      } catch (err) {
        return createCoreReply({
          command,
          ok: false,
          payload: null,
          error: coreError(err),
        });
      }
    },
  };
};
