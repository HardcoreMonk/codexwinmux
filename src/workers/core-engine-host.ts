import { createCoreProcessHost, type ICoreProcessHostTransport } from '@/lib/core-engine/process-host';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';

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

const host = createCoreProcessHost({
  supervisor: getRuntimeSupervisor(),
  transport: createProcessTransport(),
});

const shutdown = async (): Promise<void> => {
  await host.shutdown();
  process.exit(0);
};

process.title = 'codexwinmux-core';
process.once('disconnect', () => {
  void shutdown();
});
process.once('SIGINT', () => {
  void shutdown();
});
process.once('SIGTERM', () => {
  void shutdown();
});

host.start().catch((err) => {
  console.error('[core-engine-host] failed to start:', err);
  process.exit(1);
});
