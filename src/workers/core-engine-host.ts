import { createCoreProcessHost, type ICoreProcessHostTransport } from '@/lib/core-engine/process-host';
import { createCoreEngineTcpServerTransport, type ICoreEngineTcpServerTransport } from '@/lib/core-engine/tcp-transport';
import { resolveCoreEngineHostTransportConfig } from '@/lib/core-engine/transport-config';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';

const createProcessTransport = (): ICoreProcessHostTransport => {
  const send = process.send?.bind(process);
  if (!send) {
    throw Object.assign(new Error('Process IPC is not available for the Core process host'), {
      code: 'core-process-ipc-unavailable',
      retryable: false,
    });
  }

  return {
    send(message): void {
      send(message);
    },
    onMessage(handler): () => void {
      const wrapped = (message: unknown) => handler(message);
      process.on('message', wrapped);
      return () => process.off('message', wrapped);
    },
  };
};

let host: ReturnType<typeof createCoreProcessHost> | null = null;
let tcpTransport: ICoreEngineTcpServerTransport | null = null;

const shutdown = async (): Promise<void> => {
  await host?.shutdown();
  await tcpTransport?.close();
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

const start = async (): Promise<void> => {
  const config = resolveCoreEngineHostTransportConfig();
  const transport = config.mode === 'tcp'
    ? createCoreEngineTcpServerTransport({ host: config.host, port: config.port })
    : createProcessTransport();
  if (config.mode === 'tcp') {
    tcpTransport = transport as ICoreEngineTcpServerTransport;
    await tcpTransport.start();
  }
  host = createCoreProcessHost({
    supervisor: getRuntimeSupervisor(),
    transport,
  });
  await host.start();
};

start().catch((err) => {
  console.error('[core-engine-host] failed to start:', err);
  process.exit(1);
});
