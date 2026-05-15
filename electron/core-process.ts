import { app } from 'electron';
import { createCoreProcessHost, type ICoreProcessHost, type ICoreProcessHostTransport } from '../src/lib/core-engine/process-host';
import { getRuntimeSupervisor } from '../src/lib/runtime/supervisor';

const createProcessTransport = (): ICoreProcessHostTransport => {
  const send = process.send?.bind(process);

  return {
    send(message): void {
      send?.(message);
    },
    onMessage(handler): () => void {
      const wrapped = (message: unknown) => handler(message);
      process.on('message', wrapped);
      return () => process.off('message', wrapped);
    },
  };
};

let coreHost: ICoreProcessHost | null = null;

export const bootstrapCoreOnly = async (): Promise<void> => {
  process.title = 'codexwinmux-core';
  coreHost = createCoreProcessHost({
    supervisor: getRuntimeSupervisor(),
    transport: createProcessTransport(),
  });

  process.once('disconnect', () => {
    app.quit();
  });

  await coreHost.start();
};

export const shutdownCoreOnly = async (): Promise<void> => {
  await coreHost?.shutdown();
  coreHost = null;
};
