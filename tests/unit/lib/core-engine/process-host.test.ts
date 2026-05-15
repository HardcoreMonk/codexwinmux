import { describe, expect, it, vi } from 'vitest';
import { createCoreCommand } from '@/lib/core-engine/contracts';
import { createCoreProcessHost, type ICoreProcessHostTransport } from '@/lib/core-engine/process-host';

class MemoryTransport implements ICoreProcessHostTransport {
  sent: unknown[] = [];
  private handlers = new Set<(message: unknown) => void>();

  send(message: unknown): void {
    this.sent.push(message);
  }

  onMessage(handler: (message: unknown) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emit(message: unknown): void {
    for (const handler of this.handlers) handler(message);
  }
}

describe('core process host', () => {
  it('starts the runtime supervisor before accepting core commands', async () => {
    const transport = new MemoryTransport();
    const supervisor = {
      ensureStarted: vi.fn(async () => undefined),
      shutdown: vi.fn(),
      health: vi.fn(async () => ({ ok: true, storage: {}, terminal: {}, timeline: {}, status: {} })),
      listWorkspaces: vi.fn(async () => []),
    };

    const host = createCoreProcessHost({ supervisor, transport });
    await host.start();

    transport.emit(createCoreCommand({
      id: 'cmd-health',
      type: 'core.health',
      payload: {},
    }));

    await vi.waitFor(() => expect(transport.sent).toEqual(expect.arrayContaining([
      expect.objectContaining({
        commandId: 'cmd-health',
        kind: 'reply',
        ok: true,
        payload: expect.objectContaining({ ok: true }),
      }),
    ])));
    expect(supervisor.ensureStarted).toHaveBeenCalledTimes(1);
  });

  it('publishes a health event after the core host starts', async () => {
    const transport = new MemoryTransport();
    const host = createCoreProcessHost({
      supervisor: {
        ensureStarted: vi.fn(async () => undefined),
        shutdown: vi.fn(),
        health: vi.fn(async () => ({ ok: true })),
        listWorkspaces: vi.fn(async () => []),
      },
      transport,
    });

    await host.start();

    expect(transport.sent).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'event',
        source: 'core',
        target: 'backend',
        type: 'core.health-changed',
        payload: { ok: true },
      }),
    ]));
  });

  it('detaches message listeners and shuts down runtime workers on host shutdown', async () => {
    const transport = new MemoryTransport();
    const supervisor = {
      ensureStarted: vi.fn(async () => undefined),
      shutdown: vi.fn(),
      health: vi.fn(async () => ({ ok: true })),
      listWorkspaces: vi.fn(async () => []),
    };
    const host = createCoreProcessHost({ supervisor, transport });

    await host.start();
    await host.shutdown();
    transport.emit(createCoreCommand({
      id: 'cmd-after-shutdown',
      type: 'core.health',
      payload: {},
    }));

    expect(supervisor.shutdown).toHaveBeenCalledTimes(1);
    expect(transport.sent).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ commandId: 'cmd-after-shutdown' }),
    ]));
  });
});
