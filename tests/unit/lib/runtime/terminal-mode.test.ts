import { describe, expect, it } from 'vitest';
import {
  getRuntimeTerminalV2Mode,
  parseRuntimeTerminalV2Mode,
  resolveTabRuntimeVersion,
  shouldCreateTerminalTabInRuntimeV2,
} from '@/lib/runtime/terminal-mode';

describe('runtime terminal v2 mode', () => {
  it('parses terminal v2 mode values and fails closed', () => {
    expect(parseRuntimeTerminalV2Mode(undefined)).toBe('off');
    expect(parseRuntimeTerminalV2Mode('')).toBe('off');
    expect(parseRuntimeTerminalV2Mode('off')).toBe('off');
    expect(parseRuntimeTerminalV2Mode('opt-in')).toBe('opt-in');
    expect(parseRuntimeTerminalV2Mode('new-tabs')).toBe('new-tabs');
    expect(parseRuntimeTerminalV2Mode('default')).toBe('default');
    expect(parseRuntimeTerminalV2Mode('all-tabs')).toBe('off');
  });

  it('defaults to new-tabs when runtime v2 is enabled and terminal mode is unset', () => {
    expect(getRuntimeTerminalV2Mode({
      CODEXMUX_RUNTIME_V2: '1',
    } as unknown as NodeJS.ProcessEnv)).toBe('new-tabs');
    expect(getRuntimeTerminalV2Mode({
      CODEXMUX_RUNTIME_V2: '1',
      CODEXMUX_RUNTIME_TERMINAL_V2_MODE: 'off',
    } as unknown as NodeJS.ProcessEnv)).toBe('off');
    expect(getRuntimeTerminalV2Mode({
      CODEXMUX_RUNTIME_V2: '1',
      CODEXMUX_RUNTIME_TERMINAL_V2_MODE: 'invalid',
    } as unknown as NodeJS.ProcessEnv)).toBe('off');
    expect(getRuntimeTerminalV2Mode({} as unknown as NodeJS.ProcessEnv)).toBe('off');
  });

  it('prefers CODEXWINMUX runtime aliases over legacy CODEXMUX runtime mode env', () => {
    expect(getRuntimeTerminalV2Mode({
      CODEXWINMUX_RUNTIME_V2: '1',
      CODEXMUX_RUNTIME_V2: '0',
      CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE: 'new-tabs',
      CODEXMUX_RUNTIME_TERMINAL_V2_MODE: 'off',
    } as unknown as NodeJS.ProcessEnv)).toBe('new-tabs');
  });

  it('allows runtime v2 tab creation only when runtime is enabled and terminal mode opts in', () => {
    expect(shouldCreateTerminalTabInRuntimeV2({ runtimeV2Enabled: false, terminalMode: 'default' })).toBe(false);
    expect(shouldCreateTerminalTabInRuntimeV2({ runtimeV2Enabled: true, terminalMode: 'off' })).toBe(false);
    expect(shouldCreateTerminalTabInRuntimeV2({ runtimeV2Enabled: true, terminalMode: 'opt-in' })).toBe(false);
    expect(shouldCreateTerminalTabInRuntimeV2({ runtimeV2Enabled: true, terminalMode: 'opt-in', explicitOptIn: true })).toBe(true);
    expect(shouldCreateTerminalTabInRuntimeV2({ runtimeV2Enabled: true, terminalMode: 'new-tabs' })).toBe(true);
    expect(shouldCreateTerminalTabInRuntimeV2({ runtimeV2Enabled: true, terminalMode: 'default' })).toBe(true);
  });

  it('uses the process env phase 6 fallback for terminal tab creation', () => {
    const originalRuntime = process.env.CODEXMUX_RUNTIME_V2;
    const originalMode = process.env.CODEXMUX_RUNTIME_TERMINAL_V2_MODE;
    try {
      process.env.CODEXMUX_RUNTIME_V2 = '1';
      delete process.env.CODEXMUX_RUNTIME_TERMINAL_V2_MODE;
      expect(shouldCreateTerminalTabInRuntimeV2()).toBe(true);

      process.env.CODEXMUX_RUNTIME_TERMINAL_V2_MODE = 'off';
      expect(shouldCreateTerminalTabInRuntimeV2()).toBe(false);
    } finally {
      if (originalRuntime === undefined) delete process.env.CODEXMUX_RUNTIME_V2;
      else process.env.CODEXMUX_RUNTIME_V2 = originalRuntime;
      if (originalMode === undefined) delete process.env.CODEXMUX_RUNTIME_TERMINAL_V2_MODE;
      else process.env.CODEXMUX_RUNTIME_TERMINAL_V2_MODE = originalMode;
    }
  });

  it('treats missing tab runtime version as legacy runtime 1', () => {
    expect(resolveTabRuntimeVersion({})).toBe(1);
    expect(resolveTabRuntimeVersion({ runtimeVersion: 1 })).toBe(1);
    expect(resolveTabRuntimeVersion({ runtimeVersion: 2 })).toBe(2);
    expect(resolveTabRuntimeVersion({ runtimeVersion: 3 as never })).toBe(1);
  });
});
