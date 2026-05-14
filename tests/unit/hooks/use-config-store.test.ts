import { afterEach, describe, expect, it, vi } from 'vitest';
import useConfigStore from '@/hooks/use-config-store';

describe('useConfigStore', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useConfigStore.getState().hydrate({
      locale: 'ko',
      codexShowTerminal: true,
      fontSize: 'normal',
    });
  });

  it('syncs config from the server without using an optimistic setter', async () => {
    useConfigStore.getState().hydrate({
      locale: 'ko',
      codexShowTerminal: true,
      fontSize: 'normal',
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        locale: 'en',
        codexShowTerminal: false,
        fontSize: 'large',
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await useConfigStore.getState().syncConfig();

    expect(fetchMock).toHaveBeenCalledWith('/api/config', { cache: 'no-store' });
    expect(useConfigStore.getState()).toMatchObject({
      locale: 'en',
      codexShowTerminal: false,
      fontSize: 'large',
    });
  });
});
