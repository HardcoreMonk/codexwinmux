import { createServer, connect, type AddressInfo, type Server, type Socket } from 'net';
import type { ICoreEngineClientTransport } from '@/lib/core-engine/client';
import type { TCoreMessage } from '@/lib/core-engine/contracts';
import type { ICoreProcessHostTransport } from '@/lib/core-engine/process-host';

export interface ICoreEngineTcpEndpoint {
  host: string;
  port: number;
}

export interface ICoreEngineTcpServerTransport extends ICoreProcessHostTransport {
  start(): Promise<void>;
  close(): Promise<void>;
  address(): AddressInfo | null;
}

export interface ICoreEngineTcpClientTransport extends ICoreEngineClientTransport {
  dispose(): void;
}

const encodeMessage = (message: unknown): string => `${JSON.stringify(message)}\n`;

const createLineParser = (
  onMessage: (message: unknown) => void,
  onError: (err: unknown) => void,
) => {
  let buffer = '';
  return (chunk: Buffer | string): void => {
    buffer += chunk.toString();
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        try {
          onMessage(JSON.parse(line));
        } catch (err) {
          onError(err);
        }
      }
      newlineIndex = buffer.indexOf('\n');
    }
  };
};

const defaultErrorHandler = (err: unknown): void => {
  console.error('[core-engine-tcp] transport error:', err);
};

export const createCoreEngineTcpServerTransport = ({
  host,
  port,
  onError = defaultErrorHandler,
}: ICoreEngineTcpEndpoint & {
  onError?: (err: unknown) => void;
}): ICoreEngineTcpServerTransport => {
  const handlers = new Set<(message: unknown) => void>();
  const pendingInbound: unknown[] = [];
  const sockets = new Set<Socket>();
  let server: Server | null = null;
  let startPromise: Promise<void> | null = null;

  const dispatch = (message: unknown): void => {
    if (handlers.size === 0) {
      pendingInbound.push(message);
      if (pendingInbound.length > 100) pendingInbound.shift();
      return;
    }
    for (const handler of handlers) handler(message);
  };

  const closeSocket = (socket: Socket): void => {
    sockets.delete(socket);
    socket.destroy();
  };

  return {
    start: async (): Promise<void> => {
      if (startPromise) return startPromise;
      startPromise = new Promise((resolve, reject) => {
        server = createServer((socket) => {
          sockets.add(socket);
          socket.setEncoding('utf8');
          socket.on('data', createLineParser(dispatch, onError));
          socket.on('error', onError);
          socket.on('close', () => sockets.delete(socket));
        });
        server.once('error', reject);
        server.listen(port, host, () => {
          server?.off('error', reject);
          resolve();
        });
      });
      return startPromise;
    },
    close: async (): Promise<void> => {
      for (const socket of sockets) closeSocket(socket);
      sockets.clear();
      if (!server) return;
      await new Promise<void>((resolve) => {
        server?.close(() => resolve());
      });
      server = null;
      startPromise = null;
    },
    send(message: TCoreMessage): void {
      const encoded = encodeMessage(message);
      for (const socket of sockets) {
        if (!socket.destroyed) socket.write(encoded);
      }
    },
    onMessage(handler): () => void {
      handlers.add(handler);
      const buffered = pendingInbound.splice(0);
      for (const message of buffered) dispatch(message);
      return () => {
        handlers.delete(handler);
      };
    },
    address(): AddressInfo | null {
      const address = server?.address();
      return address && typeof address === 'object' ? address : null;
    },
  };
};

export const createCoreEngineTcpClientTransport = ({
  host,
  port,
  onError = defaultErrorHandler,
}: ICoreEngineTcpEndpoint & {
  onError?: (err: unknown) => void;
}): ICoreEngineTcpClientTransport => {
  const handlers = new Set<(message: unknown) => void>();
  const pendingWrites: string[] = [];
  let socket: Socket | null = null;
  let connected = false;
  let connecting = false;
  let disposed = false;

  const dispatch = (message: unknown): void => {
    for (const handler of handlers) handler(message);
  };

  const flush = (): void => {
    if (!socket || !connected) return;
    while (pendingWrites.length > 0) socket.write(pendingWrites.shift()!);
  };

  const connectIfNeeded = (): void => {
    if (disposed || connected || connecting) return;
    connecting = true;
    const next = connect({ host, port });
    socket = next;
    next.setEncoding('utf8');
    next.on('connect', () => {
      connected = true;
      connecting = false;
      flush();
    });
    next.on('data', createLineParser(dispatch, onError));
    next.on('error', (err) => {
      pendingWrites.length = 0;
      onError(err);
    });
    next.on('close', () => {
      connected = false;
      connecting = false;
      if (socket === next) socket = null;
    });
  };

  return {
    send(message: unknown): void {
      if (disposed) {
        throw Object.assign(new Error('Core TCP transport is disposed'), {
          code: 'core-tcp-transport-disposed',
          retryable: false,
        });
      }
      pendingWrites.push(encodeMessage(message));
      flush();
      connectIfNeeded();
    },
    onMessage(handler): () => void {
      handlers.add(handler);
      connectIfNeeded();
      return () => {
        handlers.delete(handler);
      };
    },
    dispose(): void {
      disposed = true;
      pendingWrites.length = 0;
      handlers.clear();
      socket?.destroy();
      socket = null;
      connected = false;
      connecting = false;
    },
  };
};
