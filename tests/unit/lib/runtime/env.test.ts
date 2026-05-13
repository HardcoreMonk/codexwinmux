import { describe, expect, it } from 'vitest';
import {
  buildRuntimeEnvAliasRecord,
  isRuntimeV2Enabled,
  readRuntimeDbPathEnv,
  readRuntimeEnvAlias,
  writeRuntimeEnvAlias,
} from '@/lib/runtime/env';

describe('runtime env aliases', () => {
  it('reads only CODEXWINMUX runtime env values', () => {
    expect(readRuntimeEnvAlias({
      CODEXWINMUX_RUNTIME_V2: '1',
      CODEXMUX_RUNTIME_V2: '0',
    }, 'CODEXMUX_RUNTIME_V2')).toBe('1');
  });

  it('does not fall back to legacy CODEXMUX runtime env after migration', () => {
    expect(isRuntimeV2Enabled({ CODEXMUX_RUNTIME_V2: '1' })).toBe(false);
  });

  it('keeps non-runtime CODEXMUX aliases compatible', () => {
    expect(readRuntimeEnvAlias({
      CODEXMUX_PROCESS_INSPECTOR_ADAPTER: 'windows',
    }, 'CODEXMUX_PROCESS_INSPECTOR_ADAPTER')).toBe('windows');
  });

  it('writes only preferred aliases for child process compatibility', () => {
    const env: Record<string, string | undefined> = {};

    writeRuntimeEnvAlias(env, 'CODEXMUX_RUNTIME_DB', 'C:\\Temp\\state.db');

    expect(env.CODEXWINMUX_RUNTIME_DB).toBe('C:\\Temp\\state.db');
    expect(readRuntimeDbPathEnv(env)).toBe('C:\\Temp\\state.db');
    expect(buildRuntimeEnvAliasRecord('CODEXMUX_RUNTIME_V2', '1')).toEqual({
      CODEXWINMUX_RUNTIME_V2: '1',
    });
    expect(buildRuntimeEnvAliasRecord('CODEXMUX_PROCESS_INSPECTOR_ADAPTER', 'windows')).toEqual({
      CODEXWINMUX_PROCESS_INSPECTOR_ADAPTER: 'windows',
      CODEXMUX_PROCESS_INSPECTOR_ADAPTER: 'windows',
    });
  });
});
