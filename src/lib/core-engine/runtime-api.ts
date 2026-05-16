import { nanoid } from 'nanoid';
import { createCoreEngineClient, type ICoreEngineClient } from '@/lib/core-engine/client';
import { createCoreEngineServer } from '@/lib/core-engine/server';
import { createCoreEngineTcpClientTransport } from '@/lib/core-engine/tcp-transport';
import {
  resolveCoreEngineBackendTransportConfig,
  type TCoreEngineBackendTransportMode,
} from '@/lib/core-engine/transport-config';
import { getRuntimeSupervisor, type IRuntimeSupervisor } from '@/lib/runtime/supervisor';
import type { IRuntimeTerminalSupervisor } from '@/lib/runtime/terminal-ws';

type TCoreRuntimeApi = Pick<IRuntimeSupervisor,
  | 'ensureStarted'
  | 'health'
  | 'listWorkspaces'
  | 'createWorkspace'
  | 'deleteWorkspace'
  | 'deleteTerminalTab'
  | 'createTerminalTab'
  | 'getLayout'
  | 'listTimelineSessions'
  | 'readTimelineEntriesBefore'
  | 'getTimelineMessageCounts'
  | 'startStatusLive'
  | 'sendStatusLiveHookEvent'
  | 'pollStatusLive'
  | 'registerStatusLiveTab'
  | 'removeStatusLiveTab'
  | 'updateStatusLiveDeviceVisibility'
>;

interface ICoreEngineBackendState {
  __codexwinmuxCoreEngineClient?: ICoreEngineClient;
  __codexwinmuxCoreEngineClientMode?: TCoreEngineBackendTransportMode;
  __codexwinmuxCoreRuntimeApi?: TCoreRuntimeApi;
  __codexwinmuxCoreTerminalSupervisor?: IRuntimeTerminalSupervisor;
}

const g = globalThis as unknown as ICoreEngineBackendState;

const dispatch = (
  handlers: Set<(message: unknown) => void>,
  message: unknown,
): void => {
  for (const handler of handlers) handler(message);
};

export const createInProcessCoreEngineClient = (
  supervisor: IRuntimeSupervisor = getRuntimeSupervisor(),
): ICoreEngineClient => {
  const handlers = new Set<(message: unknown) => void>();
  const server = createCoreEngineServer({
    supervisor,
    emit: (event) => dispatch(handlers, event),
  });
  return createCoreEngineClient({
    transport: {
      send: (message) => {
        void server.handleCommand(message).then((reply) => {
          dispatch(handlers, reply);
        });
      },
      onMessage: (handler) => {
        handlers.add(handler);
        return () => {
          handlers.delete(handler);
        };
      },
    },
  });
};

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
    g.__codexwinmuxCoreEngineClient = config.mode === 'tcp'
      ? createTcpCoreEngineClient(config)
      : createInProcessCoreEngineClient();
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
  if (mode !== 'tcp') getRuntimeSupervisor().shutdown();
};

export const getCoreRuntimeApi = (): TCoreRuntimeApi => {
  if (g.__codexwinmuxCoreRuntimeApi) return g.__codexwinmuxCoreRuntimeApi;
  const client = (): ICoreEngineClient => getCoreEngineClient();

  g.__codexwinmuxCoreRuntimeApi = {
    ensureStarted: async () => {
      await client().request('core.health', {});
    },
    health: async () => {
      const health = await client().request('core.health', {});
      return (health.runtime ?? health) as Awaited<ReturnType<IRuntimeSupervisor['health']>>;
    },
    listWorkspaces: async () => {
      const result = await client().request('core.workspace.list', {});
      return result.workspaces as unknown as Awaited<ReturnType<IRuntimeSupervisor['listWorkspaces']>>;
    },
    createWorkspace: async (input) =>
      client().request('core.workspace.create', input) as ReturnType<IRuntimeSupervisor['createWorkspace']>,
    deleteWorkspace: async (workspaceId) =>
      (await client().request('core.workspace.delete', { workspaceId })) as Awaited<ReturnType<IRuntimeSupervisor['deleteWorkspace']>>,
    getLayout: async (workspaceId) => {
      const result = await client().request('core.layout.get', { workspaceId });
      return result.layout as Awaited<ReturnType<IRuntimeSupervisor['getLayout']>>;
    },
    createTerminalTab: async (input) =>
      (await client().request('core.terminal-tab.create', input)) as Awaited<ReturnType<IRuntimeSupervisor['createTerminalTab']>>,
    deleteTerminalTab: async (tabId) =>
      (await client().request('core.terminal-tab.delete', { tabId })) as Awaited<ReturnType<IRuntimeSupervisor['deleteTerminalTab']>>,
    listTimelineSessions: async (input) =>
      (await client().request('core.timeline.list-sessions', input)) as unknown as Awaited<ReturnType<IRuntimeSupervisor['listTimelineSessions']>>,
    readTimelineEntriesBefore: async (input) =>
      (await client().request('core.timeline.read-entries-before', input)) as Awaited<ReturnType<IRuntimeSupervisor['readTimelineEntriesBefore']>>,
    getTimelineMessageCounts: async (jsonlPath) =>
      (await client().request('core.timeline.message-counts', { jsonlPath })) as Awaited<ReturnType<IRuntimeSupervisor['getTimelineMessageCounts']>>,
    startStatusLive: async () => client().request('core.status.live-start', {}),
    sendStatusLiveHookEvent: async (input) => client().request('core.status.live-hook-event', input),
    pollStatusLive: async () => client().request('core.status.live-poll', {}),
    registerStatusLiveTab: async (input) => client().request('core.status.live-register-tab', input),
    removeStatusLiveTab: async (input) => client().request('core.status.live-remove-tab', input),
    updateStatusLiveDeviceVisibility: async (input) => client().request('core.status.live-device-visibility', input),
  };
  return g.__codexwinmuxCoreRuntimeApi;
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
