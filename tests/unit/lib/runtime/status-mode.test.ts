import { describe, expect, it } from 'vitest';
import {
  getRuntimeStatusV2Mode,
  parseRuntimeStatusV2Mode,
  shouldUseRuntimeStatusV2Live,
} from '@/lib/runtime/status-mode';

describe('runtime status v2 mode', () => {
  it('parses status mode fail-closed', () => {
    expect(parseRuntimeStatusV2Mode('shadow')).toBe('shadow');
    expect(parseRuntimeStatusV2Mode('default')).toBe('default');
    expect(parseRuntimeStatusV2Mode('write')).toBe('off');
    expect(parseRuntimeStatusV2Mode(undefined)).toBe('off');
  });

  it('defaults to status default when runtime v2 is enabled and status mode is unset', () => {
    expect(getRuntimeStatusV2Mode({
      CODEXWINMUX_RUNTIME_V2: '1',
    } as unknown as NodeJS.ProcessEnv)).toBe('default');
    expect(getRuntimeStatusV2Mode({
      CODEXWINMUX_RUNTIME_V2: '1',
      CODEXWINMUX_RUNTIME_STATUS_V2_MODE: 'off',
    } as unknown as NodeJS.ProcessEnv)).toBe('off');
    expect(getRuntimeStatusV2Mode({
      CODEXWINMUX_RUNTIME_V2: '1',
      CODEXWINMUX_RUNTIME_STATUS_V2_MODE: 'invalid',
    } as unknown as NodeJS.ProcessEnv)).toBe('off');
    expect(getRuntimeStatusV2Mode({} as unknown as NodeJS.ProcessEnv)).toBe('off');
  });

  it('ignores legacy CODEXMUX status mode env after migration', () => {
    expect(getRuntimeStatusV2Mode({
      CODEXWINMUX_RUNTIME_V2: '1',
      CODEXMUX_RUNTIME_V2: '0',
      CODEXWINMUX_RUNTIME_STATUS_V2_MODE: 'default',
      CODEXMUX_RUNTIME_STATUS_V2_MODE: 'off',
    } as unknown as NodeJS.ProcessEnv)).toBe('default');
  });

  it('allows live status ownership only for runtime default mode', () => {
    expect(shouldUseRuntimeStatusV2Live({
      runtimeV2Enabled: true,
      statusMode: 'default',
    })).toBe(true);
    expect(shouldUseRuntimeStatusV2Live({
      runtimeV2Enabled: true,
      statusMode: 'shadow',
    })).toBe(false);
    expect(shouldUseRuntimeStatusV2Live({
      runtimeV2Enabled: false,
      statusMode: 'default',
    })).toBe(false);
  });

  it('uses the process env phase 6 fallback for live status ownership', () => {
    const originalRuntime = process.env.CODEXWINMUX_RUNTIME_V2;
    const originalMode = process.env.CODEXWINMUX_RUNTIME_STATUS_V2_MODE;
    try {
      process.env.CODEXWINMUX_RUNTIME_V2 = '1';
      delete process.env.CODEXWINMUX_RUNTIME_STATUS_V2_MODE;
      expect(shouldUseRuntimeStatusV2Live()).toBe(true);

      process.env.CODEXWINMUX_RUNTIME_STATUS_V2_MODE = 'off';
      expect(shouldUseRuntimeStatusV2Live()).toBe(false);
    } finally {
      if (originalRuntime === undefined) delete process.env.CODEXWINMUX_RUNTIME_V2;
      else process.env.CODEXWINMUX_RUNTIME_V2 = originalRuntime;
      if (originalMode === undefined) delete process.env.CODEXWINMUX_RUNTIME_STATUS_V2_MODE;
      else process.env.CODEXWINMUX_RUNTIME_STATUS_V2_MODE = originalMode;
    }
  });

  it('reads status mode from an explicit env object', () => {
    expect(getRuntimeStatusV2Mode({
      CODEXWINMUX_RUNTIME_STATUS_V2_MODE: 'shadow',
    } as unknown as NodeJS.ProcessEnv)).toBe('shadow');
  });
});
