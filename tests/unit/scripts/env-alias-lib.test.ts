import path from 'path';
import { pathToFileURL } from 'url';
import { describe, expect, it } from 'vitest';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/env-alias-lib.mjs')).href);

describe('script env alias helpers', () => {
  it('strips legacy CODEXMUX runtime keys from inherited child environments', async () => {
    const { stripLegacyRuntimeEnv } = await loadLib();

    expect(stripLegacyRuntimeEnv({
      PATH: 'C:\\Windows',
      CODEXMUX_RUNTIME_V2: '1',
      CODEXMUX_RUNTIME_DB: 'C:\\legacy\\state.db',
      CODEXMUX_PROCESS_INSPECTOR_ADAPTER: 'windows',
      CODEXWINMUX_RUNTIME_V2: '1',
    })).toEqual({
      PATH: 'C:\\Windows',
      CODEXMUX_PROCESS_INSPECTOR_ADAPTER: 'windows',
      CODEXWINMUX_RUNTIME_V2: '1',
    });
  });
});
