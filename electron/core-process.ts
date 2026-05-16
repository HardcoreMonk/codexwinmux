import { app } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createCoreProcessHost, type ICoreProcessHost, type ICoreProcessHostTransport } from '../src/lib/core-engine/process-host';
import { createCoreEngineTcpServerTransport, type ICoreEngineTcpServerTransport } from '../src/lib/core-engine/tcp-transport';
import { resolveCoreEngineHostTransportConfig } from '../src/lib/core-engine/transport-config';
import { getRuntimeSupervisor } from '../src/lib/runtime/supervisor';

const writeCoreBootstrapTrace = (stage: string, details?: Record<string, unknown>): void => {
  if (process.env.CODEXWINMUX_CORE_BOOTSTRAP_TRACE !== '1') return;
  try {
    const target = process.env.CODEXWINMUX_CORE_BOOTSTRAP_TRACE_FILE
      || path.join(os.tmpdir(), 'codexwinmux-core-bootstrap-trace.log');
    fs.appendFileSync(target, `${new Date().toISOString()} ${stage} ${JSON.stringify(details ?? {})}\n`);
  } catch {
    // Diagnostic-only path.
  }
};

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

let coreHost: ICoreProcessHost | null = null;
let tcpTransport: ICoreEngineTcpServerTransport | null = null;

export const bootstrapCoreOnly = async (): Promise<void> => {
  process.title = 'codexwinmux-core';
  const config = resolveCoreEngineHostTransportConfig();
  writeCoreBootstrapTrace('core-host:config', config);
  const transport = config.mode === 'tcp'
    ? createCoreEngineTcpServerTransport({ host: config.host, port: config.port })
    : createProcessTransport();
  if (config.mode === 'tcp') {
    tcpTransport = transport as ICoreEngineTcpServerTransport;
    await tcpTransport.start();
    writeCoreBootstrapTrace('core-host:tcp-listening', tcpTransport.address() ?? undefined);
  }
  coreHost = createCoreProcessHost({
    supervisor: getRuntimeSupervisor(),
    transport,
  });

  process.once('disconnect', () => {
    app.quit();
  });

  writeCoreBootstrapTrace('core-host:start');
  await coreHost.start();
  writeCoreBootstrapTrace('core-host:started');
};

export const shutdownCoreOnly = async (): Promise<void> => {
  await coreHost?.shutdown();
  coreHost = null;
  await tcpTransport?.close();
  tcpTransport = null;
};
