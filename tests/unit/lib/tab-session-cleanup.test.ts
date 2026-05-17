import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const coreApi = {
    ensureStarted: vi.fn(),
    deleteTerminalTab: vi.fn(),
  };
  return {
    killSession: vi.fn(),
    getCoreRuntimeApi: vi.fn(() => coreApi),
    coreApi,
  };
});

vi.mock('@/lib/tmux', () => ({
  killSession: mocks.killSession,
}));

vi.mock('@/lib/core-engine/runtime-api', () => ({
  getCoreRuntimeApi: mocks.getCoreRuntimeApi,
}));

import { cleanupTabSession } from '@/lib/tab-session-cleanup';

describe('tab session cleanup', () => {
  beforeEach(() => {
    mocks.killSession.mockClear();
    mocks.getCoreRuntimeApi.mockClear();
    mocks.coreApi.ensureStarted.mockClear();
    mocks.coreApi.deleteTerminalTab.mockClear();
  });

  it('kills legacy terminal sessions through the legacy tmux socket', async () => {
    await cleanupTabSession({
      id: 'tab-legacy',
      sessionName: 'pt-ws-a-pane-b-tab-legacy',
      runtimeVersion: 1,
    });

    expect(mocks.killSession).toHaveBeenCalledWith('pt-ws-a-pane-b-tab-legacy');
    expect(mocks.getCoreRuntimeApi).not.toHaveBeenCalled();
  });

  it('deletes runtime v2 terminal tabs through the core runtime API', async () => {
    await cleanupTabSession({
      id: 'tab-runtime',
      sessionName: 'rtv2-ws-a-pane-b-tab-runtime',
      panelType: 'terminal',
      runtimeVersion: 2,
    });

    expect(mocks.coreApi.ensureStarted).toHaveBeenCalled();
    expect(mocks.coreApi.deleteTerminalTab).toHaveBeenCalledWith('tab-runtime');
    expect(mocks.killSession).not.toHaveBeenCalledWith('rtv2-ws-a-pane-b-tab-runtime');
  });

  it('does not clean up web browser tabs', async () => {
    await cleanupTabSession({
      id: 'tab-web',
      sessionName: 'pt-ws-a-pane-b-tab-web',
      panelType: 'web-browser',
    });

    expect(mocks.killSession).not.toHaveBeenCalledWith('pt-ws-a-pane-b-tab-web');
    expect(mocks.getCoreRuntimeApi).not.toHaveBeenCalled();
  });
});
