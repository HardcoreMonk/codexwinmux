export interface IEngineHealth {
  app?: string;
  version?: string;
  commit?: string;
  buildTime?: string;
}

export interface IEngineProbeResult {
  url: string;
  healthy: boolean;
  owned: boolean;
  responded: boolean;
  health: IEngineHealth | null;
  error: string | null;
}

export interface IEngineProcess {
  pid?: number;
  exitCode?: number | null;
  killed?: boolean;
  kill: () => boolean | void;
  unref?: () => void;
}

export interface IEngineEnsureResult {
  ok: boolean;
  url: string;
  started: boolean;
  attached: boolean;
  pid?: number;
  health?: IEngineHealth;
  error?: 'engine-port-owned-by-other-process' | 'engine-start-timeout' | 'engine-start-failed';
}

export interface IEngineStopResult {
  ok: boolean;
  stopped: boolean;
  pid?: number;
  error?: 'engine-not-owned';
}

interface IEngineControllerDeps {
  probeHealth: (url: string) => Promise<IEngineProbeResult>;
  launchEngine: () => IEngineProcess;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

interface IEngineControllerOptions {
  url: string;
  startupTimeoutMs?: number;
  startupPollMs?: number;
  deps: IEngineControllerDeps;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const buildEngineUrl = (port: number) => `http://127.0.0.1:${port}`;

export const isCodexmuxHealth = (health: unknown): health is IEngineHealth =>
  !!health
  && typeof health === 'object'
  && (health as IEngineHealth).app === 'codexwinmux';

export const probeEngineHealth = async (
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<IEngineProbeResult> => {
  try {
    const res = await fetchImpl(new URL('/api/health', url));
    const health = await res.json().catch(() => null);
    const owned = res.ok && isCodexmuxHealth(health);
    return {
      url,
      healthy: owned,
      owned,
      responded: true,
      health: health && typeof health === 'object' ? health as IEngineHealth : null,
      error: owned ? null : `unexpected-health:${res.status}`,
    };
  } catch (err) {
    return {
      url,
      healthy: false,
      owned: false,
      responded: false,
      health: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

const isProcessRunning = (processRef: IEngineProcess | null) =>
  !!processRef && processRef.exitCode == null && !processRef.killed;

export const createEngineController = ({
  url,
  startupTimeoutMs = 30_000,
  startupPollMs = 500,
  deps,
}: IEngineControllerOptions) => {
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  let ownedProcess: IEngineProcess | null = null;

  const waitForHealthyEngine = async (): Promise<IEngineEnsureResult> => {
    const deadline = now() + startupTimeoutMs;

    while (now() <= deadline) {
      const probe = await deps.probeHealth(url);
      if (probe.healthy) {
        return {
          ok: true,
          url,
          started: true,
          attached: false,
          pid: ownedProcess?.pid,
          health: probe.health ?? undefined,
        };
      }
      if (probe.responded && !probe.owned) {
        return {
          ok: false,
          url,
          started: false,
          attached: false,
          error: 'engine-port-owned-by-other-process',
        };
      }
      await sleep(startupPollMs);
    }

    return {
      ok: false,
      url,
      started: false,
      attached: false,
      pid: ownedProcess?.pid,
      error: 'engine-start-timeout',
    };
  };

  const ensureRunning = async (): Promise<IEngineEnsureResult> => {
    const existing = await deps.probeHealth(url);
    if (existing.healthy) {
      return {
        ok: true,
        url,
        started: false,
        attached: true,
        health: existing.health ?? undefined,
      };
    }
    if (existing.responded && !existing.owned) {
      return {
        ok: false,
        url,
        started: false,
        attached: false,
        error: 'engine-port-owned-by-other-process',
      };
    }

    if (!isProcessRunning(ownedProcess)) {
      try {
        ownedProcess = deps.launchEngine();
        ownedProcess.unref?.();
      } catch {
        return {
          ok: false,
          url,
          started: false,
          attached: false,
          error: 'engine-start-failed',
        };
      }
    }

    return waitForHealthyEngine();
  };

  const stopOwnedEngine = async (): Promise<IEngineStopResult> => {
    if (!isProcessRunning(ownedProcess)) {
      ownedProcess = null;
      return {
        ok: false,
        stopped: false,
        error: 'engine-not-owned',
      };
    }

    const processToStop = ownedProcess as IEngineProcess;
    const pid = processToStop.pid;
    processToStop.kill();
    ownedProcess = null;
    return {
      ok: true,
      stopped: true,
      pid,
    };
  };

  const restartOwnedEngine = async (): Promise<IEngineEnsureResult | IEngineStopResult> => {
    const stopped = await stopOwnedEngine();
    if (!stopped.ok) return stopped;
    return ensureRunning();
  };

  return {
    ensureRunning,
    stopOwnedEngine,
    restartOwnedEngine,
    getOwnedPid: () => ownedProcess?.pid ?? null,
  };
};
