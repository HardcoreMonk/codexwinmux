import { describe, expect, it } from 'vitest';
import { resolveStorageShadowFixtureMode } from '../../../scripts/runtime-v2-storage-shadow-smoke-lib';

describe('runtime v2 storage shadow smoke helpers', () => {
  it('uses v2 API fixtures on Windows to avoid legacy tmux workspace creation', async () => {
    expect(resolveStorageShadowFixtureMode({ platform: 'win32', env: {} })).toBe('runtime-v2-api');
  });

  it('keeps legacy shadow fixtures on POSIX by default', async () => {
    expect(resolveStorageShadowFixtureMode({ platform: 'linux', env: {} })).toBe('legacy-shadow');
  });

  it('allows an explicit preferred fixture override', async () => {
    expect(resolveStorageShadowFixtureMode({
      platform: 'linux',
      env: { CODEXWINMUX_RUNTIME_V2_STORAGE_SHADOW_FIXTURE: 'runtime-v2-api' },
    })).toBe('runtime-v2-api');
  });
});
