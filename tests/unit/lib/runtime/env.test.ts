import { describe, expect, it } from 'vitest';
import {
  buildRuntimeEnvAliasRecord,
  isRuntimeV2Enabled,
  readRuntimeDbPathEnv,
  readRuntimeEnvAlias,
  writeRuntimeEnvAlias,
} from '@/lib/runtime/env';

describe('runtime env aliases', () => {
  it('prefers CODEXWINMUX runtime env over legacy CODEXMUX values', () => {
    expect(readRuntimeEnvAlias({
      CODEXWINMUX_RUNTIME_V2: '1',
      CODEXMUX_RUNTIME_V2: '0',
    }, 'CODEXMUX_RUNTIME_V2')).toBe('1');
  });

  it('falls back to legacy CODEXMUX runtime env during migration', () => {
    expect(isRuntimeV2Enabled({ CODEXMUX_RUNTIME_V2: '1' })).toBe(true);
  });

  it('writes preferred and legacy aliases for child process compatibility', () => {
    const env: Record<string, string | undefined> = {};

    writeRuntimeEnvAlias(env, 'CODEXMUX_RUNTIME_DB', 'C:\\Temp\\state.db');

    expect(env.CODEXWINMUX_RUNTIME_DB).toBe('C:\\Temp\\state.db');
    expect(env.CODEXMUX_RUNTIME_DB).toBe('C:\\Temp\\state.db');
    expect(readRuntimeDbPathEnv(env)).toBe('C:\\Temp\\state.db');
    expect(buildRuntimeEnvAliasRecord('CODEXMUX_RUNTIME_V2', '1')).toEqual({
      CODEXWINMUX_RUNTIME_V2: '1',
      CODEXMUX_RUNTIME_V2: '1',
    });
  });
});
