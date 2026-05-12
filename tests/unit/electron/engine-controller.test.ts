import { describe, expect, it, vi } from 'vitest';
import {
  buildEngineUrl,
  createEngineController,
  isCodexmuxHealth,
  probeEngineHealth,
  type IEngineProbeResult,
} from '../../../electron/engine-controller';

const healthyProbe = (url: string): IEngineProbeResult => ({
  url,
  healthy: true,
  owned: true,
  responded: true,
  health: {
    app: 'codexwinmux',
    version: '0.4.13',
  },
  error: null,
});

const missingProbe = (url: string): IEngineProbeResult => ({
  url,
  healthy: false,
  owned: false,
  responded: false,
  health: null,
  error: 'ECONNREFUSED',
});

const unrelatedProbe = (url: string): IEngineProbeResult => ({
  url,
  healthy: false,
  owned: false,
  responded: true,
  health: {
    app: 'other',
  },
  error: 'unexpected-health:200',
});

describe('Electron engine controller', () => {
  it('builds the fixed loopback engine URL', () => {
    expect(buildEngineUrl(8121)).toBe('http://127.0.0.1:8121');
  });

  it('recognizes codexmux health payloads only', () => {
    expect(isCodexmuxHealth({ app: 'codexwinmux' })).toBe(true);
    expect(isCodexmuxHealth({ app: 'other' })).toBe(false);
    expect(isCodexmuxHealth(null)).toBe(false);
  });

  it('probes /api/health and rejects unrelated apps on the same port', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ app: 'other' }),
    } as Response));

    await expect(probeEngineHealth('http://127.0.0.1:8121', fetchImpl as typeof fetch)).resolves.toMatchObject({
      healthy: false,
      owned: false,
      responded: true,
    });
    expect(fetchImpl).toHaveBeenCalledWith(new URL('http://127.0.0.1:8121/api/health'));
  });

  it('attaches to an existing healthy engine without launching a second process', async () => {
    const launchEngine = vi.fn();
    const controller = createEngineController({
      url: 'http://127.0.0.1:8121',
      deps: {
        probeHealth: async (url) => healthyProbe(url),
        launchEngine,
      },
    });

    await expect(controller.ensureRunning()).resolves.toMatchObject({
      ok: true,
      started: false,
      attached: true,
      health: {
        app: 'codexwinmux',
      },
    });
    expect(launchEngine).not.toHaveBeenCalled();
  });

  it('starts an owned engine when no healthy engine exists', async () => {
    let probes = 0;
    const kill = vi.fn();
    const unref = vi.fn();
    const controller = createEngineController({
      url: 'http://127.0.0.1:8121',
      startupPollMs: 1,
      deps: {
        probeHealth: async (url) => {
          probes += 1;
          return probes >= 2 ? healthyProbe(url) : missingProbe(url);
        },
        launchEngine: () => ({
          pid: 42,
          exitCode: null,
          kill,
          unref,
        }),
        sleep: async () => undefined,
      },
    });

    await expect(controller.ensureRunning()).resolves.toMatchObject({
      ok: true,
      started: true,
      attached: false,
      pid: 42,
    });
    expect(unref).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();
  });

  it('fails closed when the fixed engine port is occupied by another app', async () => {
    const launchEngine = vi.fn();
    const controller = createEngineController({
      url: 'http://127.0.0.1:8121',
      deps: {
        probeHealth: async (url) => unrelatedProbe(url),
        launchEngine,
      },
    });

    await expect(controller.ensureRunning()).resolves.toMatchObject({
      ok: false,
      error: 'engine-port-owned-by-other-process',
    });
    expect(launchEngine).not.toHaveBeenCalled();
  });

  it('refuses to stop engines it did not launch', async () => {
    const controller = createEngineController({
      url: 'http://127.0.0.1:8121',
      deps: {
        probeHealth: async (url) => healthyProbe(url),
        launchEngine: vi.fn(),
      },
    });

    await expect(controller.stopOwnedEngine()).resolves.toEqual({
      ok: false,
      stopped: false,
      error: 'engine-not-owned',
    });
  });

  it('restarts only an owned engine', async () => {
    let probes = 0;
    const firstKill = vi.fn();
    const secondKill = vi.fn();
    const launchKills = [firstKill, secondKill];
    const controller = createEngineController({
      url: 'http://127.0.0.1:8121',
      startupPollMs: 1,
      deps: {
        probeHealth: async (url) => {
          probes += 1;
          return probes === 1 || probes === 3 ? missingProbe(url) : healthyProbe(url);
        },
        launchEngine: () => ({
          pid: 100 + launchKills.length,
          exitCode: null,
          kill: launchKills.shift()!,
          unref: vi.fn(),
        }),
        sleep: async () => undefined,
      },
    });

    await controller.ensureRunning();
    await expect(controller.restartOwnedEngine()).resolves.toMatchObject({
      ok: true,
      started: true,
    });
    expect(firstKill).toHaveBeenCalledTimes(1);
    expect(secondKill).not.toHaveBeenCalled();
  });
});
