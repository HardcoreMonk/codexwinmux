import {
  createCoreCommand,
  parseCoreReply,
  type ICoreReply,
  type TCoreCommandPayload,
  type TCoreCommandType,
  type TCoreReplyPayload,
} from '@/lib/core-engine/contracts';

interface IPendingCoreRequest {
  type: TCoreCommandType;
  resolve: (payload: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ICoreEngineClientTransport {
  send(message: unknown): void;
  onMessage(handler: (message: unknown) => void): () => void;
}

export interface ICoreEngineClient {
  request<T extends TCoreCommandType>(
    type: T,
    payload: TCoreCommandPayload<T>,
  ): Promise<TCoreReplyPayload<T>>;
  dispose(): void;
}

export const createCoreError = ({
  code,
  message,
  retryable,
}: {
  code: string;
  message: string;
  retryable: boolean;
}): Error => Object.assign(new Error(message), { code, retryable });

export const createCoreEngineClient = ({
  transport,
  requestTimeoutMs = 10_000,
}: {
  transport: ICoreEngineClientTransport;
  requestTimeoutMs?: number;
}): ICoreEngineClient => {
  const pending = new Map<string, IPendingCoreRequest>();

  const handleReply = (reply: ICoreReply): void => {
    const request = pending.get(reply.commandId);
    if (!request) return;
    pending.delete(reply.commandId);
    clearTimeout(request.timer);
    if (!reply.ok) {
      request.reject(createCoreError(reply.error ?? {
        code: 'core-command-failed',
        message: 'Core command failed',
        retryable: true,
      }));
      return;
    }
    request.resolve(reply.payload);
  };

  const unsubscribe = transport.onMessage((message) => {
    try {
      handleReply(parseCoreReply(message));
    } catch {
      // Ignore non-reply messages until event subscription is introduced.
    }
  });

  return {
    request: <T extends TCoreCommandType>(
      type: T,
      payload: TCoreCommandPayload<T>,
    ): Promise<TCoreReplyPayload<T>> => {
      const command = createCoreCommand({ type, payload });
      const result = new Promise<TCoreReplyPayload<T>>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(command.id);
          reject(createCoreError({
            code: 'core-timeout',
            message: `Core command '${type}' timed out`,
            retryable: true,
          }));
        }, requestTimeoutMs);
        pending.set(command.id, {
          type,
          resolve: (payload) => resolve(payload as TCoreReplyPayload<T>),
          reject,
          timer,
        });
      });
      transport.send(command);
      return result;
    },
    dispose: (): void => {
      unsubscribe();
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(createCoreError({
          code: 'core-client-disposed',
          message: 'Core client disposed',
          retryable: false,
        }));
      }
      pending.clear();
    },
  };
};
