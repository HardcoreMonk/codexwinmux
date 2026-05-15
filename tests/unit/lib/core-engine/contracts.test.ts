import { describe, expect, it, vi } from 'vitest';
import {
  coreCommandTypes,
  createCoreCommand,
  createCoreReply,
  parseCoreCommandPayload,
  parseCoreReplyPayload,
} from '@/lib/core-engine/contracts';
import { createCoreEngineClient, type ICoreEngineClientTransport } from '@/lib/core-engine/client';
import { createCoreEngineServer } from '@/lib/core-engine/server';

class MemoryTransport implements ICoreEngineClientTransport {
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

describe('core engine contracts', () => {
  it('defines the backend-to-core command surface', () => {
    expect(coreCommandTypes).toEqual(expect.arrayContaining([
      'core.health',
      'core.runtime.phase6',
      'core.workspace.list',
      'core.workspace.create',
      'core.layout.get',
      'core.terminal.attach',
      'core.terminal.write',
      'core.terminal.resize',
      'core.terminal.detach',
      'core.timeline.list-sessions',
      'core.status.live-start',
    ]));
  });

  it('validates command and reply payloads by command type', () => {
    expect(parseCoreCommandPayload('core.workspace.create', {
      name: 'Main',
      defaultCwd: 'D:\\work',
    })).toEqual({
      name: 'Main',
      defaultCwd: 'D:\\work',
    });

    expect(() => parseCoreCommandPayload('core.workspace.create', {
      name: '',
      defaultCwd: 'D:\\work',
    })).toThrow(/Invalid core command payload/);

    expect(parseCoreReplyPayload('core.runtime.phase6', {
      ok: true,
      modes: {
        terminalV2Mode: 'new-tabs',
        storageV2Mode: 'default',
        timelineV2Mode: 'default',
        statusV2Mode: 'default',
      },
      checks: ['runtime-health-ok'],
      failures: [],
    })).toMatchObject({
      ok: true,
      checks: ['runtime-health-ok'],
      failures: [],
    });
  });

  it('creates typed command and reply envelopes with preserved ids', () => {
    const command = createCoreCommand({
      id: 'cmd-a',
      type: 'core.health',
      payload: {},
    });
    expect(command).toMatchObject({
      kind: 'command',
      id: 'cmd-a',
      source: 'backend',
      target: 'core',
      type: 'core.health',
      payload: {},
    });

    expect(createCoreReply({
      command,
      ok: true,
      payload: { ok: true },
    })).toMatchObject({
      kind: 'reply',
      commandId: 'cmd-a',
      source: 'core',
      target: 'backend',
      type: 'core.health.reply',
      ok: true,
      payload: { ok: true },
    });
  });
});

describe('core engine client/server adapters', () => {
  it('client sends typed requests and resolves matching replies', async () => {
    const transport = new MemoryTransport();
    const client = createCoreEngineClient({ transport, requestTimeoutMs: 100 });
    const resultPromise = client.request('core.health', {});
    const sent = transport.sent[0] as ReturnType<typeof createCoreCommand>;

    transport.emit(createCoreReply({
      command: sent,
      ok: true,
      payload: { ok: true },
    }));

    await expect(resultPromise).resolves.toEqual({ ok: true });
    expect(sent.type).toBe('core.health');
    expect(sent.id).toMatch(/^core-/);
    client.dispose();
  });

  it('client preserves retryable structured errors', async () => {
    const transport = new MemoryTransport();
    const client = createCoreEngineClient({ transport, requestTimeoutMs: 100 });
    const resultPromise = client.request('core.health', {});
    const sent = transport.sent[0] as ReturnType<typeof createCoreCommand>;

    transport.emit(createCoreReply({
      command: sent,
      ok: false,
      payload: null,
      error: {
        code: 'core-unavailable',
        message: 'Core is unavailable',
        retryable: true,
      },
    }));

    await expect(resultPromise).rejects.toMatchObject({
      message: 'Core is unavailable',
      code: 'core-unavailable',
      retryable: true,
    });
    client.dispose();
  });

  it('client times out pending requests with retryable core-timeout errors', async () => {
    vi.useFakeTimers();
    const transport = new MemoryTransport();
    const client = createCoreEngineClient({ transport, requestTimeoutMs: 25 });
    const resultPromise = client.request('core.health', {});
    const rejection = expect(resultPromise).rejects.toMatchObject({
      code: 'core-timeout',
      retryable: true,
    });

    await vi.advanceTimersByTimeAsync(30);
    await rejection;
    client.dispose();
    vi.useRealTimers();
  });

  it('server adapts core commands to the runtime supervisor boundary', async () => {
    const server = createCoreEngineServer({
      supervisor: {
        health: vi.fn(async () => ({ ok: true, storage: {}, terminal: {}, timeline: {}, status: {} })),
        listWorkspaces: vi.fn(async () => [{ id: 'ws-a', name: 'Main' }]),
      },
    });

    const healthCommand = createCoreCommand({ id: 'cmd-health', type: 'core.health', payload: {} });
    const workspaceCommand = createCoreCommand({ id: 'cmd-workspaces', type: 'core.workspace.list', payload: {} });

    await expect(server.handleCommand(healthCommand)).resolves.toMatchObject({
      commandId: 'cmd-health',
      ok: true,
      payload: { ok: true },
    });
    await expect(server.handleCommand(workspaceCommand)).resolves.toMatchObject({
      commandId: 'cmd-workspaces',
      ok: true,
      payload: { workspaces: [{ id: 'ws-a', name: 'Main' }] },
    });
  });
});
