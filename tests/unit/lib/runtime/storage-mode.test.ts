import { describe, expect, it } from 'vitest';
import {
  getRuntimeStorageV2Mode,
  parseRuntimeStorageV2Mode,
  shouldMirrorLegacyStorageToRuntimeV2,
} from '@/lib/runtime/storage-mode';

describe('runtime storage v2 mode', () => {
  it('parses only supported storage mode values', () => {
    expect(parseRuntimeStorageV2Mode('shadow')).toBe('shadow');
    expect(parseRuntimeStorageV2Mode('write')).toBe('write');
    expect(parseRuntimeStorageV2Mode('default')).toBe('default');
    expect(parseRuntimeStorageV2Mode('unexpected')).toBe('off');
    expect(parseRuntimeStorageV2Mode(undefined)).toBe('off');
  });

  it('defaults to storage default when runtime v2 is enabled and storage mode is unset', () => {
    expect(getRuntimeStorageV2Mode({
      CODEXWINMUX_RUNTIME_V2: '1',
    } as unknown as NodeJS.ProcessEnv)).toBe('default');
    expect(getRuntimeStorageV2Mode({
      CODEXWINMUX_RUNTIME_V2: '1',
      CODEXWINMUX_RUNTIME_STORAGE_V2_MODE: 'off',
    } as unknown as NodeJS.ProcessEnv)).toBe('off');
    expect(getRuntimeStorageV2Mode({
      CODEXWINMUX_RUNTIME_V2: '1',
      CODEXWINMUX_RUNTIME_STORAGE_V2_MODE: 'invalid',
    } as unknown as NodeJS.ProcessEnv)).toBe('off');
    expect(getRuntimeStorageV2Mode({} as unknown as NodeJS.ProcessEnv)).toBe('off');
  });

  it('ignores legacy CODEXMUX storage mode env after migration', () => {
    expect(getRuntimeStorageV2Mode({
      CODEXWINMUX_RUNTIME_V2: '1',
      CODEXMUX_RUNTIME_V2: '0',
      CODEXWINMUX_RUNTIME_STORAGE_V2_MODE: 'default',
      CODEXMUX_RUNTIME_STORAGE_V2_MODE: 'off',
    } as unknown as NodeJS.ProcessEnv)).toBe('default');
  });

  it('mirrors legacy JSON writes only when runtime v2 and write ownership are enabled', () => {
    expect(shouldMirrorLegacyStorageToRuntimeV2({
      runtimeV2Enabled: true,
      storageMode: 'write',
    })).toBe(true);
    expect(shouldMirrorLegacyStorageToRuntimeV2({
      runtimeV2Enabled: true,
      storageMode: 'default',
    })).toBe(true);
    expect(shouldMirrorLegacyStorageToRuntimeV2({
      runtimeV2Enabled: true,
      storageMode: 'shadow',
    })).toBe(false);
    expect(shouldMirrorLegacyStorageToRuntimeV2({
      runtimeV2Enabled: false,
      storageMode: 'write',
    })).toBe(false);
  });

  it('uses the process env phase 6 fallback for storage mirroring', () => {
    const originalRuntime = process.env.CODEXWINMUX_RUNTIME_V2;
    const originalMode = process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE;
    try {
      process.env.CODEXWINMUX_RUNTIME_V2 = '1';
      delete process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE;
      expect(shouldMirrorLegacyStorageToRuntimeV2()).toBe(true);

      process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = 'off';
      expect(shouldMirrorLegacyStorageToRuntimeV2()).toBe(false);
    } finally {
      if (originalRuntime === undefined) delete process.env.CODEXWINMUX_RUNTIME_V2;
      else process.env.CODEXWINMUX_RUNTIME_V2 = originalRuntime;
      if (originalMode === undefined) delete process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE;
      else process.env.CODEXWINMUX_RUNTIME_STORAGE_V2_MODE = originalMode;
    }
  });

  it('reads storage mode from an explicit env object', () => {
    expect(getRuntimeStorageV2Mode({
      CODEXWINMUX_RUNTIME_STORAGE_V2_MODE: 'write',
    } as unknown as NodeJS.ProcessEnv)).toBe('write');
  });
});
