import { describe, expect, it } from 'vitest';
import { createCoreEngineClient } from '@/lib/core-engine/client';
import { createCoreCommand, createCoreReply } from '@/lib/core-engine/contracts';
import {
  createCoreEngineTcpClientTransport,
  createCoreEngineTcpServerTransport,
} from '@/lib/core-engine/tcp-transport';

describe('core engine TCP transport', () => {
  it('carries backend commands and core replies across loopback TCP', async () => {
    const serverTransport = createCoreEngineTcpServerTransport({
      host: '127.0.0.1',
      port: 0,
    });
    serverTransport.onMessage((message) => {
      const command = message as ReturnType<typeof createCoreCommand>;
      serverTransport.send(createCoreReply({
        command,
        ok: true,
        payload: { ok: true },
      }));
    });
    await serverTransport.start();
    const address = serverTransport.address();
    expect(address?.port).toBeGreaterThan(0);

    const clientTransport = createCoreEngineTcpClientTransport({
      host: '127.0.0.1',
      port: address!.port,
    });
    const client = createCoreEngineClient({
      transport: clientTransport,
      requestTimeoutMs: 1_000,
    });

    await expect(client.request('core.health', {})).resolves.toEqual({ ok: true });

    client.dispose();
    clientTransport.dispose();
    await serverTransport.close();
  });

  it('buffers early backend commands until the core host registers a handler', async () => {
    const serverTransport = createCoreEngineTcpServerTransport({
      host: '127.0.0.1',
      port: 0,
    });
    await serverTransport.start();
    const address = serverTransport.address();
    expect(address?.port).toBeGreaterThan(0);

    const clientTransport = createCoreEngineTcpClientTransport({
      host: '127.0.0.1',
      port: address!.port,
    });
    const client = createCoreEngineClient({
      transport: clientTransport,
      requestTimeoutMs: 1_000,
    });
    const result = client.request('core.health', {});

    await new Promise((resolve) => setTimeout(resolve, 25));
    serverTransport.onMessage((message) => {
      const command = message as ReturnType<typeof createCoreCommand>;
      serverTransport.send(createCoreReply({
        command,
        ok: true,
        payload: { ok: true },
      }));
    });

    await expect(result).resolves.toEqual({ ok: true });

    client.dispose();
    clientTransport.dispose();
    await serverTransport.close();
  });
});
