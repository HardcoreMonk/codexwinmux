export type TModeState = 'active' | 'off' | 'unknown';
export type TWorkerState = 'healthy' | 'degraded';
export type TObservationState = 'pending' | 'complete' | 'unknown';
export type TLifecycleActionStatus = 'running' | 'succeeded' | 'failed' | 'rejected' | 'unknown';

type TLifecycleModeName = 'terminal' | 'storage' | 'timeline' | 'status';
type TLifecycleWorkerName = 'storage' | 'terminal' | 'timeline' | 'status';

export interface ILifecycleModeRow {
  name: TLifecycleModeName;
  value: string;
  state: TModeState;
}

export interface ILifecycleWorkerRow {
  name: TLifecycleWorkerName;
  state: TWorkerState;
  restarts: number;
  timeouts: number;
  failures: number;
  lastError: string | null;
}

export interface IObservationGate {
  state: TObservationState;
  sampledSince: string | null;
  generatedAt: string | null;
  endsAt: string | null;
  uptimeMs: number | null;
}

export interface IPerfTimingRow {
  name: string;
  count: number;
  lastMs: number;
  maxMs: number;
  averageMs: number;
  totalMs: number;
}

export interface ILifecycleActionView {
  id: string;
  label: string;
  description: string;
  confirmationPhrase: string | null;
}

export interface ILifecycleActionEventView {
  id: string;
  actionId: string;
  status: TLifecycleActionStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  exitCode: number | null;
  error: string | null;
}

export interface ILifecycleRelease {
  app: string | null;
  version: string | null;
  commit: string | null;
  buildTime: string | null;
}

export interface ILifecycleViewModel {
  release: ILifecycleRelease;
  runtimeOk: boolean;
  modes: ILifecycleModeRow[];
  observation: IObservationGate;
  workers: ILifecycleWorkerRow[];
  perfTimings: IPerfTimingRow[];
  actions: ILifecycleActionView[];
  actionEvents: ILifecycleActionEventView[];
  rollbackRunbook: string;
}

export interface IObservationGateInput {
  sampledSince?: string | null;
  generatedAt?: string | null;
}

interface IPerfTimingInput {
  count?: unknown;
  lastMs?: unknown;
  maxMs?: unknown;
  averageMs?: unknown;
  totalMs?: unknown;
}

interface IRuntimeWorkerInput {
  commandFailures?: unknown;
  healthFailures?: unknown;
  readyFailures?: unknown;
  errors?: unknown;
  restarts?: unknown;
  timeouts?: unknown;
  lastError?: unknown;
}

interface ILifecycleHealthInput {
  [key: string]: unknown;
  app?: unknown;
  version?: unknown;
  commit?: unknown;
  buildTime?: unknown;
}

interface ILifecycleRuntimeHealthInput {
  [key: string]: unknown;
  ok?: unknown;
  terminalV2Mode?: unknown;
  storageV2Mode?: unknown;
  timelineV2Mode?: unknown;
  statusV2Mode?: unknown;
}

interface ILifecyclePerfInput {
  runtime?: {
    sampledSince?: unknown;
    generatedAt?: unknown;
    timings?: unknown;
  };
  services?: {
    runtimeWorkers?: unknown;
  };
}

interface ILifecycleActionInput {
  id?: unknown;
  label?: unknown;
  description?: unknown;
  confirmationPhrase?: unknown;
}

interface ILifecycleActionEventInput {
  id?: unknown;
  actionId?: unknown;
  status?: unknown;
  startedAt?: unknown;
  finishedAt?: unknown;
  durationMs?: unknown;
  exitCode?: unknown;
  error?: unknown;
}

interface ILifecycleActionsInput {
  actions?: unknown;
  events?: unknown;
}

export interface ILifecycleViewModelInput {
  health?: ILifecycleHealthInput | null;
  runtimeHealth?: ILifecycleRuntimeHealthInput | null;
  perf?: ILifecyclePerfInput | null;
  lifecycleActions?: ILifecycleActionsInput | null;
}

const observationWindowMs = 24 * 60 * 60 * 1000;
const modeNames: TLifecycleModeName[] = ['terminal', 'storage', 'timeline', 'status'];
const workerNames: TLifecycleWorkerName[] = ['storage', 'terminal', 'timeline', 'status'];
const defaultPerfTimingLimit = 8;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const stringOrEmpty = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const numberOrZero = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const toModeState = (value: string): TModeState => {
  if (!value) return 'unknown';
  if (value === 'off') return 'off';
  return 'active';
};

const readTimestamp = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

export const sanitizeLifecycleDiagnosticText = (value: string): string =>
  value
    .replace(/"token"\s*:\s*"[^"]*"/gi, '[secret]')
    .replace(/Authorization:\s*Bearer\s+\S+/gi, '[secret]')
    .replace(/x-cmux-token(?::\s*|=\s*|\s+)\S+/gi, '[secret]')
    .replace(/\btoken\s*[:=]\s*\S+/gi, '[secret]')
    .replace(/~\/\.codexwinmux\/cli-token/g, '[secret]')
    .replace(/"cwd"\s*:\s*"[^"]*"/g, '[path]')
    .replace(/"sessionName"\s*:\s*"[^"]*"/g, '[runtime-session]')
    .replace(/"jsonlPath"\s*:\s*"[^"]*"/g, '[path]')
    .replace(/"prompt"\s*:\s*"[^"]*"/g, '[redacted]')
    .replace(/"assistantText"\s*:\s*"[^"]*"/g, '[redacted]')
    .replace(/"terminalOutput"\s*:\s*"[^"]*"/g, '[redacted]')
    .replace(/\bcwd\b(?::\s*|=\s*|\s+)(?=\/|[A-Za-z]:\\)\S+/g, '[path]')
    .replace(/\bsessionName\b(?::\s*|=\s*|\s+)\S+/g, '[runtime-session]')
    .replace(/\bsession\b\s+rtv2-\S+/g, '[runtime-session]')
    .replace(/\bjsonlPath\b(?::\s*|=\s*|\s+)(?=\/|[A-Za-z]:\\)\S+/g, '[path]')
    .replace(/\bprompt\b\s*:\s*[^]*?(?=\sassistantText\b\s*:|\sterminalOutput\b\s*:|\scwd\b\s*:|\ssessionName\b\s*:|\sjsonlPath\b\s*:|$)/g, '[redacted]')
    .replace(/\bassistantText\b\s*:\s*[^]*?(?=\sterminalOutput\b\s*:|\scwd\b\s*:|\ssessionName\b\s*:|\sjsonlPath\b\s*:|$)/g, '[redacted]')
    .replace(/\bterminalOutput\b\s*:\s*[^]*?(?=\scwd\b\s*:|\ssessionName\b\s*:|\sjsonlPath\b\s*:|$)/g, '[redacted]')
    .replace(/\bprompt\b[=:][^\s][^]*?(?=\sassistantText\b[=:]|\sterminalOutput\b[=:]|\scwd\b[=:]|\ssessionName\b[=:]|\sjsonlPath\b[=:]|$)/g, '[redacted]')
    .replace(/\bassistantText\b[=:][^\s][^]*?(?=\sterminalOutput\b[=:]|\scwd\b[=:]|\ssessionName\b[=:]|\sjsonlPath\b[=:]|$)/g, '[redacted]')
    .replace(/\bterminalOutput\b[=:][^\s][^]*?(?=\scwd\b[=:]|\ssessionName\b[=:]|\sjsonlPath\b[=:]|$)/g, '[redacted]')
    .replace(/\brtv2-[A-Za-z0-9_-]+\b/g, '[runtime-session]')
    .replace(/\b[A-Za-z]:\\[^\s'"]+/g, '[path]')
    .replace(/(?:\/[^\s'"]+)+/g, '[path]');

const readLastError = (value: unknown): string | null => {
  if (typeof value === 'string') return sanitizeLifecycleDiagnosticText(value);
  if (!isRecord(value)) return null;
  const message = value.message;
  return typeof message === 'string' ? sanitizeLifecycleDiagnosticText(message) : null;
};

const toActionStatus = (value: unknown): TLifecycleActionStatus => {
  if (value === 'running' || value === 'succeeded' || value === 'failed' || value === 'rejected') {
    return value;
  }
  return 'unknown';
};

const modeValueKey = (name: TLifecycleModeName): keyof ILifecycleRuntimeHealthInput => {
  switch (name) {
    case 'terminal':
      return 'terminalV2Mode';
    case 'storage':
      return 'storageV2Mode';
    case 'timeline':
      return 'timelineV2Mode';
    case 'status':
      return 'statusV2Mode';
  }
};

const getWorkerInput = (workers: unknown, name: TLifecycleWorkerName): IRuntimeWorkerInput => {
  if (!isRecord(workers)) return {};
  const worker = workers[name];
  return isRecord(worker) ? worker : {};
};

export const getObservationGate = (input: IObservationGateInput): IObservationGate => {
  const sampledSince = input.sampledSince ?? null;
  const generatedAt = input.generatedAt ?? null;
  const sampledAtMs = readTimestamp(sampledSince);
  const generatedAtMs = readTimestamp(generatedAt);

  if (sampledAtMs === null || generatedAtMs === null || generatedAtMs < sampledAtMs) {
    return {
      state: 'unknown',
      sampledSince,
      generatedAt,
      endsAt: null,
      uptimeMs: null,
    };
  }

  const endsAtMs = sampledAtMs + observationWindowMs;
  const uptimeMs = generatedAtMs - sampledAtMs;

  return {
    state: uptimeMs >= observationWindowMs ? 'complete' : 'pending',
    sampledSince,
    generatedAt,
    endsAt: new Date(endsAtMs).toISOString(),
    uptimeMs,
  };
};

export const selectTopPerfTimings = (
  timings: Record<string, unknown> | null | undefined,
  limit = defaultPerfTimingLimit,
): IPerfTimingRow[] => {
  if (!timings || limit <= 0) return [];

  return Object.entries(timings)
    .map(([name, value]) => {
      const timing: IPerfTimingInput = isRecord(value) ? value : {};
      return {
        name,
        count: numberOrZero(timing.count),
        lastMs: numberOrZero(timing.lastMs),
        maxMs: numberOrZero(timing.maxMs),
        averageMs: numberOrZero(timing.averageMs),
        totalMs: numberOrZero(timing.totalMs),
      };
    })
    .sort((left, right) =>
      right.maxMs - left.maxMs
      || right.averageMs - left.averageMs
      || left.name.localeCompare(right.name))
    .slice(0, limit);
};

export const buildRollbackRunbook = (): string => [
  'Runtime v2 rollback runbook:',
  '1. Run corepack pnpm lifecycle:rollback-dry-run.',
  '2. Run corepack pnpm lifecycle:rollback-apply or Lifecycle Action "Apply Rollback Flags".',
  '3. Confirm CODEXMUX_RUNTIME_STORAGE_V2_MODE=write.',
  '4. Confirm CODEXMUX_RUNTIME_TERMINAL_V2_MODE=off.',
  '5. Confirm CODEXMUX_RUNTIME_TIMELINE_V2_MODE=off.',
  '6. Confirm CODEXMUX_RUNTIME_STATUS_V2_MODE=off.',
  '7. Confirm systemctl --user restart codexmux.service completed, then recheck lifecycle health and worker diagnostics.',
].join('\n');

const readLifecycleActions = (value: unknown): ILifecycleActionView[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): ILifecycleActionInput => isRecord(item) ? item : {})
    .filter((action) => typeof action.id === 'string' && typeof action.label === 'string')
    .map((action) => ({
      id: stringOrEmpty(action.id),
      label: stringOrEmpty(action.label),
      description: stringOrEmpty(action.description),
      confirmationPhrase: stringOrNull(action.confirmationPhrase),
    }));
};

const readLifecycleActionEvents = (value: unknown): ILifecycleActionEventView[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): ILifecycleActionEventInput => isRecord(item) ? item : {})
    .filter((event) => typeof event.id === 'string' && typeof event.actionId === 'string')
    .map((event) => ({
      id: stringOrEmpty(event.id),
      actionId: stringOrEmpty(event.actionId),
      status: toActionStatus(event.status),
      startedAt: stringOrEmpty(event.startedAt),
      finishedAt: stringOrNull(event.finishedAt),
      durationMs: numberOrNull(event.durationMs),
      exitCode: numberOrNull(event.exitCode),
      error: typeof event.error === 'string' ? sanitizeLifecycleDiagnosticText(event.error) : null,
    }));
};

export const buildLifecycleViewModel = (input: ILifecycleViewModelInput): ILifecycleViewModel => {
  const health = input.health ?? {};
  const runtimeHealth = input.runtimeHealth ?? {};
  const perfRuntime = input.perf?.runtime;
  const perfTimings = isRecord(perfRuntime?.timings) ? perfRuntime.timings : {};
  const runtimeWorkers = input.perf?.services?.runtimeWorkers;

  return {
    release: {
      app: stringOrNull(health.app),
      version: stringOrNull(health.version),
      commit: stringOrNull(health.commit),
      buildTime: stringOrNull(health.buildTime),
    },
    runtimeOk: runtimeHealth.ok === true,
    modes: modeNames.map((name) => {
      const value = stringOrEmpty(runtimeHealth[modeValueKey(name)]);
      return {
        name,
        value,
        state: toModeState(value),
      };
    }),
    observation: getObservationGate({
      sampledSince: stringOrNull(perfRuntime?.sampledSince),
      generatedAt: stringOrNull(perfRuntime?.generatedAt),
    }),
    workers: workerNames.map((name) => {
      const worker = getWorkerInput(runtimeWorkers, name);
      const restarts = numberOrZero(worker.restarts);
      const timeouts = numberOrZero(worker.timeouts);
      const failures =
        numberOrZero(worker.commandFailures)
        + numberOrZero(worker.healthFailures)
        + numberOrZero(worker.readyFailures)
        + numberOrZero(worker.errors);
      const lastError = readLastError(worker.lastError);

      return {
        name,
        state: restarts > 0 || timeouts > 0 || failures > 0 || lastError ? 'degraded' : 'healthy',
        restarts,
        timeouts,
        failures,
        lastError,
      };
    }),
    perfTimings: selectTopPerfTimings(perfTimings),
    actions: readLifecycleActions(input.lifecycleActions?.actions),
    actionEvents: readLifecycleActionEvents(input.lifecycleActions?.events),
    rollbackRunbook: buildRollbackRunbook(),
  };
};
