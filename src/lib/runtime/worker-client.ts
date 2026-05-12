import { fork, type ChildProcess } from 'child_process';
import {
  createRuntimeCommand,
  isRuntimeCommandType,
  isRuntimeEventType,
  parseRuntimeCommandPayload,
  parseRuntimeEventPayload,
  parseRuntimeMessage,
  parseRuntimeReplyPayload,
  runtimeEventRegistry,
  type TRuntimeMessage,
} from '@/lib/runtime/ipc';
import { buildRuntimeEnvAliasRecord, readRuntimeDbPathEnv } from '@/lib/runtime/env';
import { recordRuntimeWorkerDiagnostic } from '@/lib/runtime/worker-diagnostics';
import { resolveRuntimeWorkerScript, type TRuntimeWorkerName } from '@/lib/runtime/worker-paths';

interface IPendingRequest {
  commandType: string;
  expectedSource: string;
  expectedTarget: 'supervisor';
  expectedReplyType: string;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface IRuntimeWorkerClientOptions {
  name: 'storage' | 'terminal' | 'timeline' | 'status';
  workerName?: TRuntimeWorkerName;
  requestTimeoutMs?: number;
  restartBackoffMs?: number;
  maxRestartBackoffMs?: number;
  maxPendingRequests?: number;
  readinessCommand?: string;
  onEvent?: (message: TRuntimeMessage) => void;
  onExit?: (err: Error) => void;
  spawn?: () => ChildProcess;
}

export class RuntimeWorkerClient {
  private child: ChildProcess | null = null;
  private pending = new Map<string, IPendingRequest>();
  private readonly requestTimeoutMs: number;
  private readonly initialRestartBackoffMs: number;
  private readonly maxRestartBackoffMs: number;
  private readonly maxPendingRequests: number;
  private currentRestartBackoffMs: number;
  private stopped = false;
  private readyPromise: Promise<void> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: IRuntimeWorkerClientOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.initialRestartBackoffMs = options.restartBackoffMs ?? 250;
    this.maxRestartBackoffMs = options.maxRestartBackoffMs ?? 2_000;
    this.maxPendingRequests = options.maxPendingRequests ?? 100;
    this.currentRestartBackoffMs = this.initialRestartBackoffMs;
  }

  start(): void {
    if (this.stopped) return;
    if (this.child || this.restartTimer) return;
    this.spawnChild();
  }

  waitUntilReady(): Promise<void> {
    if (this.stopped) return Promise.reject(this.createShutdownError());
    this.start();
    if (!this.options.readinessCommand) return Promise.resolve();
    if (!this.readyPromise) {
      const child = this.child;
      recordRuntimeWorkerDiagnostic(this.options.name, 'ready-check');
      this.readyPromise = this.request(this.options.readinessCommand, {})
        .then(() => {
          recordRuntimeWorkerDiagnostic(this.options.name, 'ready-success');
          return undefined;
        })
        .catch((err) => {
          recordRuntimeWorkerDiagnostic(this.options.name, 'ready-failure', { error: err });
          this.readyPromise = null;
          if (child && this.shouldRestartAfterReadinessFailure(err)) {
            this.handleChildFailure(child, err);
          }
          throw err;
        });
      void this.readyPromise.catch(() => undefined);
    }
    return this.readyPromise;
  }

  request<TPayload, TResult>(type: string, payload: TPayload): Promise<TResult> {
    if (this.stopped) return Promise.reject(this.createShutdownError());
    if (!isRuntimeCommandType(type)) {
      return Promise.reject(Object.assign(new Error(`Unregistered runtime command: ${type}`), {
        code: 'unsupported-runtime-command',
        retryable: false,
      }));
    }
    let validatedPayload: unknown;
    try {
      validatedPayload = parseRuntimeCommandPayload(type, payload);
    } catch (err) {
      return Promise.reject(err);
    }

    this.start();
    const child = this.child;
    if (!child) {
      return Promise.reject(Object.assign(new Error(`${this.options.name} worker is not connected`), {
        code: 'worker-not-connected',
        retryable: true,
      }));
    }
    if (!child.connected) {
      const err = Object.assign(new Error(`${this.options.name} worker is not connected`), {
        code: 'worker-not-connected',
        retryable: true,
      });
      this.handleChildFailure(child, err);
      return Promise.reject(err);
    }
    if (this.pending.size >= this.maxPendingRequests) {
      return Promise.reject(Object.assign(new Error(`${this.options.name} worker has too many pending commands`), {
        code: 'worker-overloaded',
        retryable: true,
      }));
    }

    const msg = createRuntimeCommand({
      source: 'supervisor',
      target: this.options.name,
      type,
      payload: validatedPayload,
    });
    const isHealthCommand = type === `${this.options.name}.health`;

    const result = new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(msg.id);
        const timeoutError = Object.assign(new Error(`${this.options.name} command '${type}' timed out`), {
          code: 'worker-timeout',
          retryable: true,
        });
        recordRuntimeWorkerDiagnostic(this.options.name, 'timeout', { error: timeoutError });
        if (isHealthCommand) recordRuntimeWorkerDiagnostic(this.options.name, 'health-failure', { error: timeoutError });
        reject(timeoutError);
      }, this.requestTimeoutMs);
      this.pending.set(msg.id, {
        commandType: type,
        expectedSource: this.options.name,
        expectedTarget: 'supervisor',
        expectedReplyType: `${type}.reply`,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
    });
    recordRuntimeWorkerDiagnostic(this.options.name, 'request');
    if (isHealthCommand) recordRuntimeWorkerDiagnostic(this.options.name, 'health-check');

    const failSend = (err?: unknown): void => {
      const pendingRequest = this.pending.get(msg.id);
      if (!pendingRequest) return;
      clearTimeout(pendingRequest.timer);
      this.pending.delete(msg.id);
      const suffix = err instanceof Error ? `: ${err.message}` : '';
      const sendError = Object.assign(new Error(`${this.options.name} worker rejected command '${type}'${suffix}`), {
        code: 'worker-not-connected',
        retryable: true,
      });
      recordRuntimeWorkerDiagnostic(this.options.name, 'send-failure', { error: sendError });
      if (isHealthCommand) recordRuntimeWorkerDiagnostic(this.options.name, 'health-failure', { error: sendError });
      pendingRequest.reject(sendError);
      this.handleChildFailure(child, sendError);
    };

    void result.catch(() => undefined);

    try {
      child.send(msg, (err) => {
        if (err) failSend(err);
      });
    } catch (err) {
      failSend(err);
    }

    return result;
  }

  shutdown(): void {
    this.stopped = true;
    recordRuntimeWorkerDiagnostic(this.options.name, 'shutdown');
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.rejectPending(this.createShutdownError());
    this.readyPromise = null;
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    this.cleanupChild(child);
    try {
      child.kill();
    } catch {
      // best-effort worker shutdown
    }
  }

  private spawnChild(): void {
    const child = this.options.spawn ? this.options.spawn() : this.spawnDefault();
    this.child = child;
    recordRuntimeWorkerDiagnostic(this.options.name, 'start');
    child.on('message', this.handleMessage);
    child.on('exit', (code, signal) => {
      this.handleChildFailure(child, Object.assign(new Error(`${this.options.name} worker exited`), {
        code: 'worker-exited',
        retryable: true,
        exitCode: code,
        signal,
      }));
    });
    child.on('error', (err) => {
      this.handleChildFailure(child, Object.assign(err, {
        code: 'worker-error',
        retryable: true,
      }));
    });
  }

  private spawnDefault(): ChildProcess {
    const workerName = this.options.workerName ?? (`${this.options.name}-worker` as TRuntimeWorkerName);
    const resolved = resolveRuntimeWorkerScript(workerName);
    const runtimeDbPath = readRuntimeDbPathEnv();
    return fork(resolved.scriptPath, [], {
      execArgv: resolved.execArgv,
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      env: {
        ...process.env,
        ...(runtimeDbPath ? buildRuntimeEnvAliasRecord('CODEXMUX_RUNTIME_DB', runtimeDbPath) : {}),
      },
    });
  }

  private cleanupChild(child: ChildProcess): void {
    child.removeAllListeners('message');
    child.removeAllListeners('exit');
    child.removeAllListeners('error');
  }

  private createShutdownError(): Error {
    return Object.assign(new Error(`${this.options.name} worker shut down`), {
      code: 'worker-shutdown',
      retryable: false,
    });
  }

  private shouldRestartAfterReadinessFailure(err: unknown): boolean {
    const code = typeof err === 'object' && err && 'code' in err
      ? (err as { code?: unknown }).code
      : undefined;
    return code === 'worker-timeout'
      || code === 'worker-not-connected'
      || code === 'worker-error'
      || code === 'worker-exited';
  }

  private handleMessage = (raw: unknown): void => {
    let msg: TRuntimeMessage;
    try {
      msg = parseRuntimeMessage(raw);
    } catch (err) {
      this.rejectMalformedReply(raw, err);
      return;
    }

    if (msg.kind === 'event') {
      if (!isRuntimeEventType(msg.type)) return;
      const expected = runtimeEventRegistry[msg.type];
      if (
        msg.source !== expected.source
        || msg.source !== this.options.name
        || msg.target !== expected.target
        || msg.delivery !== expected.delivery
      ) {
        return;
      }
      try {
        const payload = parseRuntimeEventPayload(msg.type, msg.payload);
        recordRuntimeWorkerDiagnostic(this.options.name, 'event');
        this.options.onEvent?.({ ...msg, payload });
      } catch {
        return;
      }
      return;
    }

    if (msg.kind !== 'reply') return;
    const pending = this.pending.get(msg.commandId);
    if (!pending) return;
    this.pending.delete(msg.commandId);
    clearTimeout(pending.timer);
    if (
      msg.source !== pending.expectedSource
      || msg.target !== pending.expectedTarget
      || msg.type !== pending.expectedReplyType
    ) {
      const err = Object.assign(new Error(`${this.options.name} worker sent mismatched reply for '${pending.commandType}'`), {
        code: 'invalid-worker-reply',
        retryable: false,
      });
      recordRuntimeWorkerDiagnostic(this.options.name, 'invalid-reply', { error: err });
      if (pending.commandType === `${this.options.name}.health`) {
        recordRuntimeWorkerDiagnostic(this.options.name, 'health-failure', { error: err });
      }
      pending.reject(err);
      return;
    }

    if (!msg.ok) {
      const err = Object.assign(new Error(msg.error?.message ?? `${this.options.name} command failed`), {
        code: msg.error?.code ?? 'worker-command-failed',
        retryable: msg.error?.retryable ?? false,
      });
      recordRuntimeWorkerDiagnostic(this.options.name, 'command-failure', { error: err });
      if (pending.commandType === `${this.options.name}.health`) {
        recordRuntimeWorkerDiagnostic(this.options.name, 'health-failure', { error: err });
      }
      pending.reject(err);
      return;
    }

    try {
      const payload = isRuntimeCommandType(pending.commandType)
        ? parseRuntimeReplyPayload(pending.commandType, msg.payload)
        : msg.payload;
      this.currentRestartBackoffMs = this.initialRestartBackoffMs;
      recordRuntimeWorkerDiagnostic(this.options.name, 'reply');
      if (pending.commandType === `${this.options.name}.health`) {
        recordRuntimeWorkerDiagnostic(this.options.name, 'health-success');
      }
      pending.resolve(payload);
    } catch (err) {
      const replyError = Object.assign(new Error(err instanceof Error ? err.message : String(err)), {
        code: 'invalid-worker-reply',
        retryable: false,
      });
      recordRuntimeWorkerDiagnostic(this.options.name, 'invalid-reply', { error: replyError });
      if (pending.commandType === `${this.options.name}.health`) {
        recordRuntimeWorkerDiagnostic(this.options.name, 'health-failure', { error: replyError });
      }
      pending.reject(replyError);
    }
  };

  private rejectMalformedReply(raw: unknown, err: unknown): void {
    const commandId = this.getMalformedReplyCommandId(raw);
    if (!commandId) return;
    const pending = this.pending.get(commandId);
    if (!pending) return;
    this.pending.delete(commandId);
    clearTimeout(pending.timer);
    const replyError = Object.assign(
      new Error(err instanceof Error ? err.message : `${this.options.name} worker sent malformed reply`),
      {
        code: 'invalid-worker-reply',
        retryable: false,
      },
    );
    recordRuntimeWorkerDiagnostic(this.options.name, 'invalid-reply', { error: replyError });
    if (pending.commandType === `${this.options.name}.health`) {
      recordRuntimeWorkerDiagnostic(this.options.name, 'health-failure', { error: replyError });
    }
    pending.reject(replyError);
  }

  private getMalformedReplyCommandId(raw: unknown): string | null {
    if (typeof raw !== 'object' || !raw) return null;
    const candidate = raw as { kind?: unknown; commandId?: unknown };
    if (candidate.kind !== 'reply') return null;
    if (typeof candidate.commandId !== 'string' || candidate.commandId.length === 0) return null;
    return candidate.commandId;
  }

  private rejectPending(err: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }

  private scheduleRestart(): void {
    if (this.stopped || this.restartTimer) return;
    const delay = Math.min(this.currentRestartBackoffMs, this.maxRestartBackoffMs);
    this.currentRestartBackoffMs = Math.min(this.currentRestartBackoffMs * 2, this.maxRestartBackoffMs);
    recordRuntimeWorkerDiagnostic(this.options.name, 'restart');
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.stopped) this.spawnChild();
    }, delay);
  }

  private handleChildFailure(child: ChildProcess, err: Error): void {
    if (this.child !== child) return;
    const structured = err as Error & { code?: unknown; exitCode?: unknown; signal?: unknown };
    if (structured.code === 'worker-exited') {
      recordRuntimeWorkerDiagnostic(this.options.name, 'exit', {
        error: err,
        exitCode: typeof structured.exitCode === 'number' ? structured.exitCode : null,
        signal: typeof structured.signal === 'string' ? structured.signal : null,
      });
    } else {
      recordRuntimeWorkerDiagnostic(this.options.name, 'failure', { error: err });
    }
    this.child = null;
    this.options.onExit?.(err);
    this.rejectPending(err);
    try {
      child.kill();
    } catch {
      // best-effort worker cleanup
    }
    this.cleanupChild(child);
    this.readyPromise = null;
    this.scheduleRestart();
  }
}
