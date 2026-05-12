import { describe, expect, it } from 'vitest';
import {
  createTerminalRuntimeAdapter,
  resolveTerminalRuntimeAdapterKind,
} from '@/lib/runtime/terminal/terminal-runtime-adapter-factory';
import type { ITerminalRuntimeAdapter } from '@/lib/runtime/terminal/terminal-runtime-contract';

const createFakeRuntime = (): ITerminalRuntimeAdapter => ({
  health: async () => ({ ok: true }),
  createSession: async (input) => ({ sessionName: input.sessionName }),
  attach: async (sessionName) => ({ sessionName, attached: true }),
  detach: async (sessionName) => ({ sessionName, detached: true }),
  killSession: async (sessionName) => ({ sessionName, killed: true }),
  hasSession: async (sessionName) => ({ sessionName, exists: true }),
  writeStdin: async (_sessionName, data) => ({ written: data.length }),
  resize: async (sessionName, cols, rows) => ({ sessionName, cols, rows }),
});

describe('terminal runtime adapter factory', () => {
  it('keeps tmux as the default terminal runtime adapter during the Windows transition', () => {
    expect(resolveTerminalRuntimeAdapterKind({
      env: {},
      platform: 'win32',
    })).toBe('tmux');
  });

  it('allows explicit tmux adapter selection', () => {
    expect(resolveTerminalRuntimeAdapterKind({
      env: { CODEXMUX_RUNTIME_TERMINAL_ADAPTER: 'tmux' },
      platform: 'win32',
    })).toBe('tmux');
  });

  it('resolves the Windows adapter kind without claiming it is implemented', () => {
    expect(resolveTerminalRuntimeAdapterKind({
      env: { CODEXMUX_RUNTIME_TERMINAL_ADAPTER: 'windows' },
      platform: 'win32',
    })).toBe('windows');
  });

  it('prefers CODEXWINMUX terminal adapter alias over legacy CODEXMUX adapter env', () => {
    expect(resolveTerminalRuntimeAdapterKind({
      env: {
        CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER: 'windows',
        CODEXMUX_RUNTIME_TERMINAL_ADAPTER: 'tmux',
      },
      platform: 'win32',
    })).toBe('windows');
  });

  it('fails closed when an unknown terminal runtime adapter is requested', () => {
    expect(() => resolveTerminalRuntimeAdapterKind({
      env: { CODEXMUX_RUNTIME_TERMINAL_ADAPTER: 'conpty' },
      platform: 'win32',
    })).toThrow(expect.objectContaining({
      code: 'runtime-v2-terminal-adapter-unsupported',
      retryable: false,
    }));
  });

  it('creates the selected terminal runtime adapter through an injectable factory', async () => {
    const runtime = createTerminalRuntimeAdapter({
      env: { CODEXMUX_RUNTIME_TERMINAL_ADAPTER: 'tmux' },
      createTmuxRuntime: createFakeRuntime,
    });

    await expect(runtime.health()).resolves.toEqual({ ok: true });
  });

  it('creates the selected Windows runtime adapter through an injectable factory', async () => {
    const runtime = createTerminalRuntimeAdapter({
      env: { CODEXMUX_RUNTIME_TERMINAL_ADAPTER: 'windows' },
      platform: 'win32',
      createWindowsRuntime: createFakeRuntime,
    });

    await expect(runtime.health()).resolves.toEqual({ ok: true });
  });
});
