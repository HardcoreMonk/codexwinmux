import { describe, expect, it } from 'vitest';
import {
  buildRuntimeEnvAlias,
  readRuntimeEnvAlias,
  writeRuntimeEnvAlias,
} from '../../../scripts/runtime-env-alias';

describe('script runtime env alias helpers', () => {
  it('accepts preferred CODEXWINMUX runtime keys without writing legacy aliases', () => {
    const env: Record<string, string | undefined> = {};

    writeRuntimeEnvAlias(env, 'CODEXWINMUX_RUNTIME_DB', 'C:\\Temp\\state.db');

    expect(env).toEqual({ CODEXWINMUX_RUNTIME_DB: 'C:\\Temp\\state.db' });
    expect(readRuntimeEnvAlias(env, 'CODEXWINMUX_RUNTIME_DB')).toBe('C:\\Temp\\state.db');
    expect(buildRuntimeEnvAlias('CODEXWINMUX_RUNTIME_V2', '1')).toEqual({
      CODEXWINMUX_RUNTIME_V2: '1',
    });
  });
});
