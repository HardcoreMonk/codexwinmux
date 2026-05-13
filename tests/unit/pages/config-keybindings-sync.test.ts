import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  broadcastSync: vi.fn(),
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  hashPassword: vi.fn(async (value: string) => `hashed:${value}`),
  generateSecret: vi.fn(() => 'secret'),
  updateAccessFromConfig: vi.fn(),
  readKeybindings: vi.fn(),
  setKeybinding: vi.fn(),
  resetKeybinding: vi.fn(),
  resetAllKeybindings: vi.fn(),
}));

vi.mock('@/lib/sync-server', () => ({
  broadcastSync: mocks.broadcastSync,
}));

vi.mock('@/lib/config-store', () => ({
  getConfig: mocks.getConfig,
  updateConfig: mocks.updateConfig,
  hashPassword: mocks.hashPassword,
  generateSecret: mocks.generateSecret,
}));

vi.mock('@/lib/access-filter', () => ({
  isBoundToLocalhostOnly: () => true,
  updateAccessFromConfig: mocks.updateAccessFromConfig,
}));

vi.mock('@/lib/keybindings-store', () => ({
  readKeybindings: mocks.readKeybindings,
  setKeybinding: mocks.setKeybinding,
  resetKeybinding: mocks.resetKeybinding,
  resetAllKeybindings: mocks.resetAllKeybindings,
}));

import configHandler from '@/pages/api/config';
import keybindingsHandler from '@/pages/api/keybindings';

const createResponse = () => {
  let statusCode = 0;
  let body: unknown;
  const res = {
    setHeader: vi.fn(() => res),
    status: vi.fn((code: number) => {
      statusCode = code;
      return res;
    }),
    json: vi.fn((value: unknown) => {
      body = value;
      return res;
    }),
  } as unknown as NextApiResponse;

  return {
    res,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
};

const createRequest = (input: {
  method: string;
  body?: unknown;
  query?: Record<string, string>;
}): NextApiRequest => ({
  method: input.method,
  body: input.body,
  query: input.query ?? {},
  headers: {},
}) as unknown as NextApiRequest;

describe('config and keybinding sync invalidation', () => {
  beforeEach(() => {
    mocks.broadcastSync.mockClear();
    mocks.getConfig.mockResolvedValue({ locale: 'ko', authPassword: null, authSecret: 'secret' });
    mocks.updateConfig.mockResolvedValue(undefined);
    mocks.readKeybindings.mockResolvedValue({ overrides: {} });
    mocks.setKeybinding.mockResolvedValue({ overrides: { 'workspace.new': 'ctrl+n' } });
    mocks.resetKeybinding.mockResolvedValue({ overrides: {} });
    mocks.resetAllKeybindings.mockResolvedValue({ overrides: {} });
  });

  it('broadcasts config sync after config updates', async () => {
    const response = createResponse();

    await configHandler(createRequest({ method: 'PATCH', body: { locale: 'ko' } }), response.res);

    expect(response.statusCode).toBe(200);
    expect(mocks.updateConfig).toHaveBeenCalledWith({ locale: 'ko' });
    expect(mocks.broadcastSync).toHaveBeenCalledWith({ type: 'config' });
  });

  it('broadcasts config sync after keybinding updates and resets', async () => {
    const patchResponse = createResponse();
    await keybindingsHandler(createRequest({
      method: 'PATCH',
      body: { id: 'workspace.new', key: 'ctrl+n' },
    }), patchResponse.res);

    const deleteResponse = createResponse();
    await keybindingsHandler(createRequest({
      method: 'DELETE',
      query: { id: 'workspace.new' },
    }), deleteResponse.res);

    expect(patchResponse.statusCode).toBe(200);
    expect(deleteResponse.statusCode).toBe(200);
    expect(mocks.broadcastSync).toHaveBeenCalledTimes(2);
    expect(mocks.broadcastSync).toHaveBeenCalledWith({ type: 'config' });
  });
});
