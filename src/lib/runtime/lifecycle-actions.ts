import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { sanitizeLifecycleDiagnosticText } from '@/lib/runtime/lifecycle-control';

const execFile = promisify(execFileCb);

export type TLifecycleActionId = 'phase6-gate' | 'restart-service' | 'deploy-local' | 'rollback-runtime-flags';
export type TLifecycleActionEventId = TLifecycleActionId | 'unknown';
export type TLifecycleActionStatus = 'running' | 'succeeded' | 'failed' | 'rejected';

export interface ILifecycleActionDefinition {
  id: TLifecycleActionId;
  label: string;
  description: string;
  command: string;
  args: string[];
  confirmationPhrase: string | null;
}

export interface ILifecycleActionEvent {
  id: string;
  actionId: TLifecycleActionEventId;
  status: TLifecycleActionStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  exitCode: number | null;
  error: string | null;
}

export interface IRunLifecycleActionInput {
  actionId: string;
  confirmation?: string;
}

export interface IRunLifecycleActionResult {
  ok: boolean;
  event: ILifecycleActionEvent;
}

export interface IReadLifecycleActionEventsOptions {
  limit?: number;
}

export interface ILifecycleActionExecuteResult {
  exitCode: number;
}

export interface ILifecycleActionExecuteOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface ICreateLifecycleActionServiceOptions {
  execute?: (command: string, args: string[], options: ILifecycleActionExecuteOptions) => Promise<ILifecycleActionExecuteResult>;
}

const definitions: ILifecycleActionDefinition[] = [
  {
    id: 'phase6-gate',
    label: 'Run Phase 6 Gate',
    description: 'Run the read-only runtime v2 Phase 6 default gate smoke.',
    command: 'corepack',
    args: ['pnpm', 'smoke:runtime-v2:phase6-default-gate'],
    confirmationPhrase: null,
  },
  {
    id: 'restart-service',
    label: 'Restart Service',
    description: 'Restart the legacy Linux user service with systemd.',
    command: 'systemctl',
    args: ['--user', 'restart', 'codexmux.service'],
    confirmationPhrase: 'restart codexmux.service',
  },
  {
    id: 'deploy-local',
    label: 'Deploy Local',
    description: 'Run the local build/deploy script and restart the service.',
    command: 'corepack',
    args: ['pnpm', 'deploy:local'],
    confirmationPhrase: 'deploy local',
  },
  {
    id: 'rollback-runtime-flags',
    label: 'Apply Rollback Flags',
    description: 'Write explicit CODEXWINMUX_RUNTIME rollback flags to the legacy systemd user drop-in and restart the service.',
    command: 'corepack',
    args: ['pnpm', 'lifecycle:rollback-apply'],
    confirmationPhrase: 'rollback runtime v2',
  },
];

const definitionById = new Map<TLifecycleActionId, ILifecycleActionDefinition>(
  definitions.map((definition) => [definition.id, definition]),
);

const getHomeDir = (): string =>
  process.env.HOME || process.env.USERPROFILE || os.homedir() || '/';

const getAuditFilePath = (): string =>
  path.join(getHomeDir(), '.codexwinmux', 'lifecycle-actions.jsonl');

const getActionCwd = (): string =>
  process.env.__CMUX_APP_DIR || process.env.INIT_CWD || process.cwd();

const readPristineEnv = (): NodeJS.ProcessEnv => {
  if (!process.env.__CMUX_PRISTINE_ENV) return {} as NodeJS.ProcessEnv;
  try {
    const parsed = JSON.parse(process.env.__CMUX_PRISTINE_ENV) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    ) as NodeJS.ProcessEnv;
  } catch {
    return {} as NodeJS.ProcessEnv;
  }
};

const getActionEnv = (): NodeJS.ProcessEnv => {
  const pristineEnv = readPristineEnv();
  const preferPristine = (key: string): string | undefined => pristineEnv[key] ?? process.env[key];
  const preferCurrent = (key: string): string | undefined => process.env[key] ?? pristineEnv[key];

  return {
    ...pristineEnv,
    ...Object.fromEntries(Object.entries({
      HOME: preferCurrent('HOME'),
      PATH: preferPristine('PATH'),
      USER: preferCurrent('USER'),
      SHELL: preferCurrent('SHELL'),
      NODE_ENV: preferPristine('NODE_ENV'),
      HOST: preferPristine('HOST'),
      PORT: preferPristine('PORT'),
      __CMUX_APP_DIR: getActionCwd(),
      __CMUX_PRISTINE_ENV: process.env.__CMUX_PRISTINE_ENV,
    }).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
  } as NodeJS.ProcessEnv;
};

const sanitizeError = (value: unknown): string =>
  sanitizeLifecycleDiagnosticText(value instanceof Error ? value.message : String(value));

const getExitCode = (value: unknown): number | null => {
  const code = (value as { code?: unknown }).code;
  return typeof code === 'number' ? code : null;
};

const getExecutionFailureLabel = (value: unknown): string => {
  const exitCode = getExitCode(value);
  if (exitCode !== null) return `exit-code-${exitCode}`;
  const signal = (value as { signal?: unknown }).signal;
  if (typeof signal === 'string') return `signal-${signal}`;
  const code = (value as { code?: unknown }).code;
  if (typeof code === 'string') return code;
  return 'action-execution-failed';
};

const createEvent = ({
  actionId,
  status,
  startedAt = new Date().toISOString(),
  finishedAt = null,
  durationMs = null,
  exitCode = null,
  error = null,
}: {
  actionId: TLifecycleActionEventId;
  status: TLifecycleActionStatus;
  startedAt?: string;
  finishedAt?: string | null;
  durationMs?: number | null;
  exitCode?: number | null;
  error?: string | null;
}): ILifecycleActionEvent => ({
  id: randomUUID(),
  actionId,
  status,
  startedAt,
  finishedAt,
  durationMs,
  exitCode,
  error: error ? sanitizeError(error) : null,
});

const appendEvent = async (event: ILifecycleActionEvent): Promise<void> => {
  const filePath = getAuditFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
};

const parseLine = (line: string): ILifecycleActionEvent | null => {
  try {
    const parsed = JSON.parse(line) as ILifecycleActionEvent;
    if (!parsed.id || !parsed.actionId || !parsed.status || !parsed.startedAt) return null;
    return parsed;
  } catch {
    return null;
  }
};

const defaultExecute = async (
  command: string,
  args: string[],
  options: ILifecycleActionExecuteOptions,
): Promise<ILifecycleActionExecuteResult> => {
  await execFile(command, args, {
    cwd: options.cwd,
    timeout: 10 * 60 * 1000,
    maxBuffer: 1024 * 1024,
    env: options.env,
  });
  return { exitCode: 0 };
};

export const createLifecycleActionService = (
  options: ICreateLifecycleActionServiceOptions = {},
) => {
  const execute = options.execute ?? defaultExecute;
  let activeAction: Promise<IRunLifecycleActionResult> | null = null;

  const readAuditEvents = async (
    readOptions: IReadLifecycleActionEventsOptions = {},
  ): Promise<ILifecycleActionEvent[]> => {
    const limit = Math.max(1, Math.min(100, Math.floor(readOptions.limit ?? 20)));
    try {
      const raw = await fs.readFile(getAuditFilePath(), 'utf-8');
      return raw
        .split('\n')
        .filter(Boolean)
        .map(parseLine)
        .filter((event): event is ILifecycleActionEvent => !!event)
        .slice(-limit)
        .reverse();
    } catch {
      return [];
    }
  };

  const reject = async (actionId: TLifecycleActionEventId, error: string): Promise<IRunLifecycleActionResult> => {
    const now = new Date().toISOString();
    const event = createEvent({
      actionId,
      status: 'rejected',
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      error,
    });
    await appendEvent(event);
    return { ok: false, event };
  };

  const runAction = async (input: IRunLifecycleActionInput): Promise<IRunLifecycleActionResult> => {
    const definition = definitionById.get(input.actionId as TLifecycleActionId);
    if (!definition) {
      return reject('unknown', 'unknown-action');
    }
    if (definition.confirmationPhrase !== null && input.confirmation !== definition.confirmationPhrase) {
      return reject(definition.id, 'confirmation-required');
    }
    if (activeAction) {
      return reject(definition.id, 'action-already-running');
    }

    const task = (async (): Promise<IRunLifecycleActionResult> => {
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      const runningEvent = createEvent({ actionId: definition.id, status: 'running', startedAt });
      await appendEvent(runningEvent);

      try {
        const result = await execute(definition.command, definition.args, {
          cwd: getActionCwd(),
          env: getActionEnv(),
        });
        const finishedAt = new Date().toISOString();
        const event = createEvent({
          actionId: definition.id,
          status: result.exitCode === 0 ? 'succeeded' : 'failed',
          startedAt,
          finishedAt,
          durationMs: Date.now() - startedMs,
          exitCode: result.exitCode,
          error: result.exitCode === 0 ? null : `exit-code-${result.exitCode}`,
        });
        await appendEvent(event);
        return { ok: event.status === 'succeeded', event };
      } catch (err) {
        const exitCode = getExitCode(err);
        const event = createEvent({
          actionId: definition.id,
          status: 'failed',
          startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startedMs,
          exitCode,
          error: getExecutionFailureLabel(err),
        });
        await appendEvent(event);
        return { ok: false, event };
      }
    })();

    activeAction = task;
    try {
      return await task;
    } finally {
      activeAction = null;
    }
  };

  return {
    getDefinitions: (): ILifecycleActionDefinition[] =>
      definitions.map((definition) => ({
        ...definition,
        args: definition.args.slice(),
      })),
    readAuditEvents,
    runAction,
  };
};

const g = globalThis as unknown as {
  __ptLifecycleActionService?: ReturnType<typeof createLifecycleActionService>;
};

export const getLifecycleActionService = (): ReturnType<typeof createLifecycleActionService> => {
  g.__ptLifecycleActionService ??= createLifecycleActionService();
  return g.__ptLifecycleActionService;
};
