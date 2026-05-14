import {
  createRuntimeEvent,
  createRuntimeReply,
  parseRuntimeCommandPayload,
  type IRuntimeCommand,
  type IRuntimeEvent,
  type IRuntimeReply,
} from '@/lib/runtime/ipc';
import type { ITerminalRuntimeAdapter } from '@/lib/runtime/terminal/terminal-runtime-contract';
import { validateWorkerCommandEnvelope, type IInvalidWorkerCommand } from '@/lib/runtime/worker-command-validation';

const DEFAULT_STDOUT_FLUSH_MS = 16;
const DEFAULT_MAX_PENDING_STDOUT_BYTES = 64 * 1024;
const DEFAULT_MAX_STDOUT_FRAME_BYTES = 16 * 1024;

export type ITerminalWorkerRuntime = ITerminalRuntimeAdapter;

export interface ITerminalWorkerServiceOptions {
  runtime: ITerminalWorkerRuntime;
  emitEvent?: (event: IRuntimeEvent) => void;
  stdoutFlushMs?: number;
  maxPendingStdoutBytes?: number;
  maxStdoutFrameBytes?: number;
}

export const createTerminalWorkerService = (options: ITerminalWorkerServiceOptions) => {
  interface IStdoutBuffer {
    chunks: string[];
    bytes: number;
    timer: ReturnType<typeof setTimeout> | null;
  }

  const stdoutBuffers = new Map<string, IStdoutBuffer>();
  const attachedSessions = new Set<string>();
  const stdoutFlushMs = options.stdoutFlushMs ?? DEFAULT_STDOUT_FLUSH_MS;
  const maxPendingStdoutBytes = options.maxPendingStdoutBytes ?? DEFAULT_MAX_PENDING_STDOUT_BYTES;
  const maxStdoutFrameBytes = options.maxStdoutFrameBytes ?? DEFAULT_MAX_STDOUT_FRAME_BYTES;
  const byteLength = (value: string): number => Buffer.byteLength(value, 'utf8');

  const splitByByteLimit = (value: string): string[] => {
    const chunks: string[] = [];
    let current = '';
    let currentBytes = 0;

    for (const codePoint of value) {
      const codePointBytes = byteLength(codePoint);
      if (current && currentBytes + codePointBytes > maxStdoutFrameBytes) {
        chunks.push(current);
        current = '';
        currentBytes = 0;
      }

      if (codePointBytes > maxStdoutFrameBytes) {
        chunks.push(codePoint);
        continue;
      }

      current += codePoint;
      currentBytes += codePointBytes;
    }

    if (current) chunks.push(current);
    return chunks;
  };

  const emitStdout = (sessionName: string, data: string): void => {
    for (const chunk of splitByByteLimit(data)) {
      options.emitEvent?.(createRuntimeEvent({
        source: 'terminal',
        target: 'supervisor',
        type: 'terminal.stdout',
        delivery: 'realtime',
        payload: { sessionName, data: chunk },
      }));
    }
  };

  const clearStdout = (sessionName: string): void => {
    const current = stdoutBuffers.get(sessionName);
    if (current?.timer) clearTimeout(current.timer);
    stdoutBuffers.delete(sessionName);
  };

  const flushStdout = (sessionName: string): void => {
    if (!attachedSessions.has(sessionName)) {
      clearStdout(sessionName);
      return;
    }
    const current = stdoutBuffers.get(sessionName);
    if (!current) return;
    if (current.timer) clearTimeout(current.timer);
    stdoutBuffers.delete(sessionName);
    const data = current.chunks.join('');
    if (data) emitStdout(sessionName, data);
  };

  const appendStdout = (sessionName: string, data: string): void => {
    if (!attachedSessions.has(sessionName)) return;
    const bytes = byteLength(data);
    const current = stdoutBuffers.get(sessionName) ?? { chunks: [], bytes: 0, timer: null };
    if (current.bytes + bytes > maxPendingStdoutBytes) {
      attachedSessions.delete(sessionName);
      clearStdout(sessionName);
      options.emitEvent?.(createRuntimeEvent({
        source: 'terminal',
        target: 'supervisor',
        type: 'terminal.backpressure',
        delivery: 'realtime',
        payload: {
          sessionName,
          pendingBytes: current.bytes + bytes,
          maxPendingStdoutBytes,
        },
      }));
      void options.runtime.detach(sessionName).catch(() => undefined);
      return;
    }
    current.chunks.push(data);
    current.bytes += bytes;
    if (!current.timer) {
      current.timer = setTimeout(() => flushStdout(sessionName), stdoutFlushMs);
    }
    stdoutBuffers.set(sessionName, current);
  };

  const ok = <TPayload>(command: IRuntimeCommand, payload: TPayload): IRuntimeReply<TPayload> =>
    createRuntimeReply({
      commandId: command.id,
      source: 'terminal',
      target: command.source,
      type: `${command.type}.reply`,
      ok: true,
      payload,
    });

  const fail = (command: IRuntimeCommand, code: string, message: string, retryable = false): IRuntimeReply<null> =>
    createRuntimeReply({
      commandId: command.id,
      source: 'terminal',
      target: command.source,
      type: `${command.type}.reply`,
      ok: false,
      payload: null,
      error: { code, message, retryable },
    });

  const invalidCommand = (command: IRuntimeCommand, error: IInvalidWorkerCommand): IRuntimeReply<null> =>
    createRuntimeReply({
      commandId: command.id,
      source: 'terminal',
      target: 'supervisor',
      type: `${command.type}.reply`,
      ok: false,
      payload: null,
      error,
    });

  return {
    async handleCommand(command: IRuntimeCommand): Promise<IRuntimeReply> {
      const invalid = validateWorkerCommandEnvelope(command, { workerName: 'terminal', namespace: 'terminal' });
      if (invalid) return invalidCommand(command, invalid);
      try {
        if (command.type === 'terminal.health') {
          return ok(command, await options.runtime.health());
        }
        if (command.type === 'terminal.create-session') {
          return ok(command, await options.runtime.createSession(parseRuntimeCommandPayload('terminal.create-session', command.payload)));
        }
        if (command.type === 'terminal.attach') {
          const input = parseRuntimeCommandPayload('terminal.attach', command.payload);
          attachedSessions.add(input.sessionName);
          try {
            return ok(command, await options.runtime.attach(input.sessionName, input.cols, input.rows, (data) => {
              appendStdout(input.sessionName, data);
            }));
          } catch (err) {
            attachedSessions.delete(input.sessionName);
            clearStdout(input.sessionName);
            throw err;
          }
        }
        if (command.type === 'terminal.detach') {
          const input = parseRuntimeCommandPayload('terminal.detach', command.payload);
          attachedSessions.delete(input.sessionName);
          clearStdout(input.sessionName);
          return ok(command, await options.runtime.detach(input.sessionName));
        }
        if (command.type === 'terminal.write-stdin' || command.type === 'terminal.write-web-stdin') {
          const input = parseRuntimeCommandPayload(command.type, command.payload);
          return ok(command, await options.runtime.writeStdin(input.sessionName, input.data));
        }
        if (command.type === 'terminal.resize') {
          const input = parseRuntimeCommandPayload('terminal.resize', command.payload);
          return ok(command, await options.runtime.resize(input.sessionName, input.cols, input.rows));
        }
        if (command.type === 'terminal.kill-session') {
          const input = parseRuntimeCommandPayload('terminal.kill-session', command.payload);
          attachedSessions.delete(input.sessionName);
          clearStdout(input.sessionName);
          return ok(command, await options.runtime.killSession(input.sessionName));
        }
        if (command.type === 'terminal.has-session') {
          const input = parseRuntimeCommandPayload('terminal.has-session', command.payload);
          return ok(command, await options.runtime.hasSession(input.sessionName));
        }
        if (command.type === 'terminal.get-session-info') {
          const input = parseRuntimeCommandPayload('terminal.get-session-info', command.payload);
          if (options.runtime.getSessionInfo) {
            return ok(command, await options.runtime.getSessionInfo(input.sessionName));
          }
          const presence = await options.runtime.hasSession(input.sessionName);
          return ok(command, {
            sessionName: input.sessionName,
            exists: presence.exists,
            cwd: null,
            command: null,
            pid: null,
            startedAt: null,
            metadataSource: 'unavailable',
          });
        }
        return invalidCommand(command, {
          code: 'invalid-worker-command',
          message: `Unsupported terminal command: ${command.type}`,
          retryable: false,
        });
      } catch (err) {
        const maybeStructured = err as { code?: string; retryable?: boolean } | null;
        return fail(
          command,
          maybeStructured?.code ?? 'command-failed',
          err instanceof Error ? err.message : String(err),
          maybeStructured?.retryable ?? false,
        );
      }
    },
  };
};
