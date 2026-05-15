import {
  createCoreReply,
  parseCoreCommand,
  type ICoreCommand,
  type ICoreReply,
} from '@/lib/core-engine/contracts';

export interface ICoreEngineSupervisorAdapter {
  health(): Promise<unknown>;
  listWorkspaces(): Promise<unknown[]>;
  createWorkspace?(input: { name: string; defaultCwd: string }): Promise<{ id: string; rootPaneId: string }>;
  getLayout?(workspaceId: string): Promise<unknown>;
  startStatusLive?(): Promise<{ started: boolean }>;
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

export const createCoreEngineServer = ({
  supervisor,
}: {
  supervisor: ICoreEngineSupervisorAdapter;
}): ICoreEngineServer => {
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
        return requireMethod(supervisor.createWorkspace, 'createWorkspace')(payload);
      }
      case 'core.layout.get': {
        const payload = command.payload as { workspaceId: string };
        return { layout: await requireMethod(supervisor.getLayout, 'getLayout')(payload.workspaceId) };
      }
      case 'core.status.live-start':
        return requireMethod(supervisor.startStatusLive, 'startStatusLive')();
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
