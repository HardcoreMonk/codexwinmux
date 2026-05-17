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
  deleteWorkspace?(workspaceId: string): Promise<unknown>;
  getLayout?(workspaceId: string): Promise<unknown>;
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
  startStatusLive?(): Promise<{ started: boolean }>;
  sendStatusLiveHookEvent?(input: { tmuxSession: string; event: string; notificationType?: string }): Promise<{ accepted: boolean }>;
  pollStatusLive?(): Promise<{ polled: boolean }>;
  registerStatusLiveTab?(input: { tabId: string; entry: unknown }): Promise<{ accepted: boolean }>;
  removeStatusLiveTab?(input: { tabId: string }): Promise<{ accepted: boolean }>;
  updateStatusLiveDeviceVisibility?(input: { deviceId: string; visible: boolean }): Promise<{ accepted: boolean }>;
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
      case 'core.workspace.delete': {
        const payload = command.payload as { workspaceId: string };
        return callSupervisorMethod(supervisor, supervisor.deleteWorkspace, 'deleteWorkspace', payload.workspaceId);
      }
      case 'core.layout.get': {
        const payload = command.payload as { workspaceId: string };
        return { layout: await callSupervisorMethod(supervisor, supervisor.getLayout, 'getLayout', payload.workspaceId) };
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
      case 'core.status.live-start':
        return callSupervisorMethod(supervisor, supervisor.startStatusLive, 'startStatusLive');
      case 'core.status.live-hook-event': {
        const payload = command.payload as { tmuxSession: string; event: string; notificationType?: string };
        return callSupervisorMethod(supervisor, supervisor.sendStatusLiveHookEvent, 'sendStatusLiveHookEvent', payload);
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
