import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeCommand } from '@/lib/runtime/ipc';
import type { ITerminalRuntimeAdapter } from '@/lib/runtime/terminal/terminal-runtime-contract';
import { createTerminalWorkerService } from '@/lib/runtime/terminal/terminal-worker-service';

const createFakeRuntime = (): ITerminalRuntimeAdapter & {
  writes: string[];
  detached: string[];
  pushData?: (data: string) => void;
} => {
  const writes: string[] = [];
  const detached: string[] = [];
  const runtime: ITerminalRuntimeAdapter & {
    writes: string[];
    detached: string[];
    pushData?: (data: string) => void;
  } = {
    writes,
    detached,
    async health() {
      return { ok: true };
    },
    async createSession(input) {
      return { sessionName: input.sessionName, cols: input.cols, rows: input.rows };
    },
    async attach(sessionName, _cols, _rows, onData) {
      runtime.pushData = onData;
      onData('attached\n');
      return { sessionName, attached: true };
    },
    async detach(sessionName) {
      detached.push(sessionName);
      return { sessionName, detached: true };
    },
    async killSession(sessionName) {
      return { sessionName, killed: true };
    },
    async hasSession(sessionName) {
      return { sessionName, exists: true };
    },
    async writeStdin(sessionName, data) {
      writes.push(`${sessionName}:${data}`);
      return { written: data.length };
    },
    async resize(sessionName, cols, rows) {
      return { sessionName, cols, rows };
    },
  };
  return runtime;
};

describe('terminal worker service', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates sessions and writes stdin', async () => {
    const runtime = createFakeRuntime();
    const service = createTerminalWorkerService({ runtime });

    const created = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'terminal',
      type: 'terminal.create-session',
      payload: { sessionName: 'rtv2-ws-a-pane-b-tab-c', cols: 80, rows: 24, cwd: '/tmp' },
    }));

    expect(created.ok).toBe(true);

    const written = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'terminal',
      type: 'terminal.write-stdin',
      payload: { sessionName: 'rtv2-ws-a-pane-b-tab-c', data: 'pwd\n' },
    }));

    expect(written.ok).toBe(true);
    expect(runtime.writes).toEqual(['rtv2-ws-a-pane-b-tab-c:pwd\n']);
  });

  it('checks terminal session presence without attaching a pty', async () => {
    const runtime = createFakeRuntime();
    runtime.hasSession = async (sessionName) => ({ sessionName, exists: false });
    const service = createTerminalWorkerService({ runtime });

    const checked = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'terminal',
      type: 'terminal.has-session',
      payload: { sessionName: 'rtv2-ws-a-pane-b-tab-c' },
    }));

    expect(checked.ok).toBe(true);
    expect(checked.payload).toEqual({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      exists: false,
    });
  });

  it('returns terminal session info without attaching a pty', async () => {
    const runtime = createFakeRuntime();
    runtime.getSessionInfo = async (sessionName) => ({
      sessionName,
      exists: true,
      cwd: 'D:\\repo',
      command: 'powershell.exe',
      pid: 4242,
      startedAt: 1710000000000,
      metadataSource: 'terminal-runtime',
    });
    const service = createTerminalWorkerService({ runtime });

    const checked = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'terminal',
      type: 'terminal.get-session-info',
      payload: { sessionName: 'rtv2-ws-a-pane-b-tab-c' },
    }));

    expect(checked.ok).toBe(true);
    expect(checked.payload).toEqual({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      exists: true,
      cwd: 'D:\\repo',
      command: 'powershell.exe',
      pid: 4242,
      startedAt: 1710000000000,
      metadataSource: 'terminal-runtime',
    });
  });

  it('returns structured errors for invalid worker commands', async () => {
    const service = createTerminalWorkerService({ runtime: createFakeRuntime() });
    const unknown = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'terminal',
      type: 'terminal.unknown',
      payload: {},
    }));
    const wrongSource = await service.handleCommand(createRuntimeCommand({
      source: 'browser',
      target: 'terminal',
      type: 'terminal.health',
      payload: {},
    }));
    const wrongTarget = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'storage',
      type: 'terminal.health',
      payload: {},
    }));
    const wrongNamespace = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'terminal',
      type: 'storage.health',
      payload: {},
    }));

    for (const reply of [unknown, wrongSource, wrongTarget, wrongNamespace]) {
      expect(reply.ok).toBe(false);
      expect(reply.error).toMatchObject({
        code: 'invalid-worker-command',
        retryable: false,
      });
    }
  });

  it('preserves structured runtime errors', async () => {
    const runtime = createFakeRuntime();
    runtime.health = async () => {
      throw Object.assign(new Error('Runtime v2 tmux config is missing'), {
        code: 'runtime-v2-tmux-config-missing',
        retryable: false,
      });
    };
    const service = createTerminalWorkerService({ runtime });
    const reply = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'terminal',
      type: 'terminal.health',
      payload: {},
    }));

    expect(reply.ok).toBe(false);
    expect(reply.error).toMatchObject({
      code: 'runtime-v2-tmux-config-missing',
      retryable: false,
    });
  });

  it('rejects production tmux session names', async () => {
    const service = createTerminalWorkerService({ runtime: createFakeRuntime() });
    const reply = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'terminal',
      type: 'terminal.attach',
      payload: { sessionName: 'pt-ws-a-pane-b-tab-c', cols: 80, rows: 24 },
    }));

    expect(reply.ok).toBe(false);
    expect(reply.error?.code).toBe('command-failed');
  });

  it('emits realtime stdout events for attached sessions', async () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    const service = createTerminalWorkerService({
      runtime: createFakeRuntime(),
      emitEvent: (event) => events.push(event),
    });

    const reply = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'terminal',
      type: 'terminal.attach',
      payload: { sessionName: 'rtv2-ws-a-pane-b-tab-c', cols: 80, rows: 24 },
    }));

    expect(reply.ok).toBe(true);
    await vi.advanceTimersByTimeAsync(16);
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'event',
        type: 'terminal.stdout',
        delivery: 'realtime',
        payload: expect.objectContaining({ sessionName: 'rtv2-ws-a-pane-b-tab-c', data: 'attached\n' }),
      }),
    ]);
  });

  it('coalesces stdout before emitting events', async () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    const runtime = createFakeRuntime();
    runtime.attach = async (sessionName, _cols, _rows, onData) => {
      onData('a');
      onData('b');
      return { sessionName, attached: true };
    };
    const service = createTerminalWorkerService({
      runtime,
      stdoutFlushMs: 16,
      emitEvent: (event) => events.push(event),
    });

    const reply = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'terminal',
      type: 'terminal.attach',
      payload: { sessionName: 'rtv2-ws-a-pane-b-tab-c', cols: 80, rows: 24 },
    }));

    expect(reply.ok).toBe(true);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(16);
    expect(events).toEqual([
      expect.objectContaining({
        type: 'terminal.stdout',
        payload: expect.objectContaining({ sessionName: 'rtv2-ws-a-pane-b-tab-c', data: 'ab' }),
      }),
    ]);
  });

  it('clears buffered stdout on detach without flushing stale output', async () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    const runtime = createFakeRuntime();
    runtime.attach = async (sessionName, _cols, _rows, onData) => {
      onData('partial');
      return { sessionName, attached: true };
    };
    const service = createTerminalWorkerService({
      runtime,
      stdoutFlushMs: 16,
      emitEvent: (event) => events.push(event),
    });

    await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'terminal',
      type: 'terminal.attach',
      payload: { sessionName: 'rtv2-ws-a-pane-b-tab-c', cols: 80, rows: 24 },
    }));
    const detached = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'terminal',
      type: 'terminal.detach',
      payload: { sessionName: 'rtv2-ws-a-pane-b-tab-c' },
    }));

    expect(detached.ok).toBe(true);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(16);
    expect(events).toEqual([]);
    expect(runtime.detached).toEqual(['rtv2-ws-a-pane-b-tab-c']);
    vi.useRealTimers();
  });

  it('ignores late stdout after detach', async () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    const runtime = createFakeRuntime();
    const service = createTerminalWorkerService({
      runtime,
      stdoutFlushMs: 16,
      emitEvent: (event) => events.push(event),
    });

    await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'terminal',
      type: 'terminal.attach',
      payload: { sessionName: 'rtv2-ws-a-pane-b-tab-c', cols: 80, rows: 24 },
    }));
    await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'terminal',
      type: 'terminal.detach',
      payload: { sessionName: 'rtv2-ws-a-pane-b-tab-c' },
    }));
    events.length = 0;

    runtime.pushData?.('late');
    await vi.advanceTimersByTimeAsync(16);

    expect(events).toEqual([]);
    vi.useRealTimers();
  });

  it('emits backpressure and detaches when stdout exceeds the pending byte cap', async () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    const runtime = createFakeRuntime();
    runtime.attach = async (sessionName, _cols, _rows, onData) => {
      onData('abcdef');
      return { sessionName, attached: true };
    };
    const service = createTerminalWorkerService({
      runtime,
      maxPendingStdoutBytes: 4,
      emitEvent: (event) => events.push(event),
    });

    const reply = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'terminal',
      type: 'terminal.attach',
      payload: { sessionName: 'rtv2-ws-a-pane-b-tab-c', cols: 80, rows: 24 },
    }));

    await Promise.resolve();
    expect(reply.ok).toBe(true);
    expect(events).toEqual([
      expect.objectContaining({
        type: 'terminal.backpressure',
        payload: expect.objectContaining({
          sessionName: 'rtv2-ws-a-pane-b-tab-c',
          pendingBytes: 6,
          maxPendingStdoutBytes: 4,
        }),
      }),
    ]);
    expect(runtime.detached).toEqual(['rtv2-ws-a-pane-b-tab-c']);
    await vi.advanceTimersByTimeAsync(16);
    expect(events).toHaveLength(1);
    vi.useRealTimers();
  });

  it('drops buffered partial stdout when backpressure detaches', async () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    const runtime = createFakeRuntime();
    runtime.attach = async (sessionName, _cols, _rows, onData) => {
      onData('ab');
      onData('cde');
      return { sessionName, attached: true };
    };
    const service = createTerminalWorkerService({
      runtime,
      stdoutFlushMs: 16,
      maxPendingStdoutBytes: 4,
      emitEvent: (event) => events.push(event),
    });

    const reply = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'terminal',
      type: 'terminal.attach',
      payload: { sessionName: 'rtv2-ws-a-pane-b-tab-c', cols: 80, rows: 24 },
    }));

    expect(reply.ok).toBe(true);
    expect(events).toEqual([
      expect.objectContaining({ type: 'terminal.backpressure' }),
    ]);
    await vi.advanceTimersByTimeAsync(16);
    expect(events).toHaveLength(1);
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'terminal.stdout' }),
    ]));
    expect(runtime.detached).toEqual(['rtv2-ws-a-pane-b-tab-c']);
    vi.useRealTimers();
  });

  it('ignores late stdout after backpressure detach', async () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    const runtime = createFakeRuntime();
    runtime.attach = async (sessionName, _cols, _rows, onData) => {
      runtime.pushData = onData;
      onData('abcdef');
      return { sessionName, attached: true };
    };
    const service = createTerminalWorkerService({
      runtime,
      stdoutFlushMs: 16,
      maxPendingStdoutBytes: 4,
      emitEvent: (event) => events.push(event),
    });

    await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'terminal',
      type: 'terminal.attach',
      payload: { sessionName: 'rtv2-ws-a-pane-b-tab-c', cols: 80, rows: 24 },
    }));
    expect(events).toEqual([
      expect.objectContaining({ type: 'terminal.backpressure' }),
    ]);
    events.length = 0;

    runtime.pushData?.('late');
    await vi.advanceTimersByTimeAsync(16);

    expect(events).toEqual([]);
    vi.useRealTimers();
  });

  it('splits stdout frames without breaking multibyte characters', async () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    const runtime = createFakeRuntime();
    runtime.attach = async (sessionName, _cols, _rows, onData) => {
      onData('한글🙂abc');
      return { sessionName, attached: true };
    };
    const service = createTerminalWorkerService({
      runtime,
      maxStdoutFrameBytes: 8,
      emitEvent: (event) => events.push(event),
    });

    const reply = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'terminal',
      type: 'terminal.attach',
      payload: { sessionName: 'rtv2-ws-a-pane-b-tab-c', cols: 80, rows: 24 },
    }));

    expect(reply.ok).toBe(true);
    await vi.advanceTimersByTimeAsync(16);
    const chunks = events.map((event) => (event as { payload: { data: string } }).payload.data);
    expect(chunks.join('')).toBe('한글🙂abc');
    expect(chunks.every((chunk) => !chunk.includes('\uFFFD'))).toBe(true);
    expect(chunks.every((chunk) => new TextEncoder().encode(chunk).byteLength <= 8)).toBe(true);
  });

  it('coalesces multi-chunk Unicode stdout before Unicode-safe frame splitting', async () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    const runtime = createFakeRuntime();
    runtime.attach = async (sessionName, _cols, _rows, onData) => {
      onData('한');
      onData('글🙂');
      onData('abc');
      return { sessionName, attached: true };
    };
    const service = createTerminalWorkerService({
      runtime,
      stdoutFlushMs: 16,
      maxStdoutFrameBytes: 8,
      emitEvent: (event) => events.push(event),
    });

    const reply = await service.handleCommand(createRuntimeCommand({
      source: 'supervisor',
      target: 'terminal',
      type: 'terminal.attach',
      payload: { sessionName: 'rtv2-ws-a-pane-b-tab-c', cols: 80, rows: 24 },
    }));

    expect(reply.ok).toBe(true);
    await vi.advanceTimersByTimeAsync(16);
    const chunks = events.map((event) => (event as { payload: { data: string } }).payload.data);
    expect(chunks.join('')).toBe('한글🙂abc');
    expect(chunks.every((chunk) => !chunk.includes('\uFFFD'))).toBe(true);
    expect(chunks.every((chunk) => Buffer.byteLength(chunk, 'utf8') <= 8)).toBe(true);
    vi.useRealTimers();
  });
});
