import { nanoid } from 'nanoid';
import { createCoreEngineClient, type ICoreEngineClient } from '@/lib/core-engine/client';
import { createCoreEngineTcpClientTransport } from '@/lib/core-engine/tcp-transport';
import {
  resolveCoreEngineBackendTransportConfig,
  type TCoreEngineBackendTransportMode,
} from '@/lib/core-engine/transport-config';
import type {
  IRuntimeCreateWorkspaceResult,
  IRuntimeDeleteTerminalTabResult,
  IRuntimeDeleteWorkspaceResult,
  IRuntimeHealth,
  IRuntimeStatusLiveAcceptedResult,
  IRuntimeStatusLiveDeviceVisibilityInput,
  IRuntimeStatusLiveHookEventInput,
  IRuntimeStatusLivePollResult,
  IRuntimeStatusLiveRegisterTabInput,
  IRuntimeStatusLiveRemoveTabInput,
  IRuntimeTerminalTab,
  IRuntimeTimelineEntriesBeforeInput,
  IRuntimeTimelineSessionListInput,
  IRuntimeTimelineSessionPage,
  IRuntimeWorkspace,
  TRuntimeLayout,
  TRuntimeTimelineEntriesBeforeResult,
  TRuntimeTimelineMessageCounts,
} from '@/lib/runtime/contracts';
import type { IRuntimeTerminalSupervisor } from '@/lib/runtime/terminal-ws';

type TCoreRuntimeApi = {
  ensureStarted: () => Promise<void>;
  health: () => Promise<IRuntimeHealth>;
  listWorkspaces: () => Promise<IRuntimeWorkspace[]>;
  createWorkspace: (input: { name: string; defaultCwd: string }) => Promise<IRuntimeCreateWorkspaceResult>;
  deleteWorkspace: (workspaceId: string) => Promise<IRuntimeDeleteWorkspaceResult>;
  deleteTerminalTab: (tabId: string) => Promise<IRuntimeDeleteTerminalTabResult>;
  createTerminalTab: (input: {
    workspaceId: string;
    paneId: string;
    cwd: string;
    ensureWorkspacePane?: {
      workspaceName: string;
      defaultCwd: string;
    };
  }) => Promise<IRuntimeTerminalTab>;
  getLayout: (workspaceId: string) => Promise<TRuntimeLayout>;
  listTimelineSessions: (input: IRuntimeTimelineSessionListInput) => Promise<IRuntimeTimelineSessionPage>;
  readTimelineEntriesBefore: (input: IRuntimeTimelineEntriesBeforeInput) => Promise<TRuntimeTimelineEntriesBeforeResult>;
  getTimelineMessageCounts: (jsonlPath: string) => Promise<TRuntimeTimelineMessageCounts>;
  startStatusLive: () => Promise<{ started: boolean }>;
  sendStatusLiveHookEvent: (input: IRuntimeStatusLiveHookEventInput) => Promise<IRuntimeStatusLiveAcceptedResult>;
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

  g.__codexwinmuxCoreRuntimeApi = {
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
    deleteWorkspace: async (workspaceId) =>
      client().request('core.workspace.delete', { workspaceId }) as Promise<IRuntimeDeleteWorkspaceResult>,
    getLayout: async (workspaceId) => {
      const result = await client().request('core.layout.get', { workspaceId });
      return result.layout as TRuntimeLayout;
    },
    createTerminalTab: async (input) =>
      client().request('core.terminal-tab.create', input) as Promise<IRuntimeTerminalTab>,
    deleteTerminalTab: async (tabId) =>
      client().request('core.terminal-tab.delete', { tabId }) as Promise<IRuntimeDeleteTerminalTabResult>,
    listTimelineSessions: async (input) =>
      client().request('core.timeline.list-sessions', input) as unknown as Promise<IRuntimeTimelineSessionPage>,
    readTimelineEntriesBefore: async (input) =>
      client().request('core.timeline.read-entries-before', input) as Promise<TRuntimeTimelineEntriesBeforeResult>,
    getTimelineMessageCounts: async (jsonlPath) =>
      client().request('core.timeline.message-counts', { jsonlPath }) as Promise<TRuntimeTimelineMessageCounts>,
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
