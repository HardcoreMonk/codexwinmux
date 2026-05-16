import { createCoreEvent, type TCoreMessage } from '@/lib/core-engine/contracts';
import { createCoreEngineServer, type ICoreEngineSupervisorAdapter } from '@/lib/core-engine/server';

export interface ICoreProcessSupervisor extends ICoreEngineSupervisorAdapter {
  ensureStarted(): Promise<void>;
  shutdown(): void | Promise<void>;
}

export interface ICoreProcessHostTransport {
  send(message: TCoreMessage): void;
  onMessage(handler: (message: unknown) => void): () => void;
}

export interface ICoreProcessHost {
  start(): Promise<void>;
  shutdown(): Promise<void>;
  handleMessage(message: unknown): Promise<void>;
}

const defaultErrorHandler = (err: unknown): void => {
  console.error('[core-process] command handling failed:', err);
};

export const createCoreProcessHost = ({
  supervisor,
  transport,
  onError = defaultErrorHandler,
}: {
  supervisor: ICoreProcessSupervisor;
  transport: ICoreProcessHostTransport;
  onError?: (err: unknown) => void;
}): ICoreProcessHost => {
  const server = createCoreEngineServer({
    supervisor,
    emit: (event) => transport.send(event),
  });
  let unsubscribe: (() => void) | null = null;
  let startPromise: Promise<void> | null = null;
  let shuttingDown = false;

  const handleMessage = async (message: unknown): Promise<void> => {
    if (shuttingDown) return;
    try {
      transport.send(await server.handleCommand(message));
    } catch (err) {
      onError(err);
    }
  };

  const start = async (): Promise<void> => {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      await supervisor.ensureStarted();
      if (shuttingDown) return;
      unsubscribe = transport.onMessage((message) => {
        void handleMessage(message);
      });
      transport.send(createCoreEvent({
        type: 'core.health-changed',
        payload: { ok: true },
      }));
    })();
    return startPromise;
  };

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    unsubscribe?.();
    unsubscribe = null;
    await Promise.resolve(supervisor.shutdown());
  };

  return {
    start,
    shutdown,
    handleMessage,
  };
};
