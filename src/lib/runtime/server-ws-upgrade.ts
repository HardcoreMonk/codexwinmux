import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { verifyRuntimeV2WebSocketAuth } from '@/lib/runtime/api-auth';
import { isRuntimeV2Enabled } from '@/lib/runtime/env';
import { parseRuntimeSessionName } from '@/lib/runtime/session-name';

const MAX_TERMINAL_COLS = 500;
const MAX_TERMINAL_ROWS = 200;
const DECIMAL_DIMENSION_RE = /^[1-9]\d*$/;

export interface IRuntimeTerminalUpgradeContext {
  sessionName: string;
  cols: number;
  rows: number;
}

export const parseTerminalDimension = (value: string | null, fallback: number, max: number): number => {
  if (value === null) return fallback;
  if (!DECIMAL_DIMENSION_RE.test(value)) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Math.min(parsed, max);
};

export interface IRouteWebSocketUpgradeOptions {
  request: IncomingMessage;
  socket: Duplex;
  head: Buffer;
  port: number;
  noAuthPaths: ReadonlySet<string>;
  wsPaths: ReadonlySet<string>;
  handleKnownUpgrade: (url: URL, request: IncomingMessage, socket: Duplex, head: Buffer) => void;
  handleRuntimeTerminalUpgrade: (
    context: IRuntimeTerminalUpgradeContext,
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => void;
  fallbackUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => void;
  verifyRuntimeAuth?: typeof verifyRuntimeV2WebSocketAuth;
  verifyGenericAuth: (request: IncomingMessage) => Promise<boolean>;
  runtimeEnabled?: () => boolean;
}

export interface ICreateWebSocketUpgradeHandlerOptions {
  port: number;
  noAuthPaths: ReadonlySet<string>;
  wsPaths: ReadonlySet<string>;
  handleKnownUpgrade: IRouteWebSocketUpgradeOptions['handleKnownUpgrade'];
  handleRuntimeTerminalUpgrade: IRouteWebSocketUpgradeOptions['handleRuntimeTerminalUpgrade'];
  fallbackUpgrade: IRouteWebSocketUpgradeOptions['fallbackUpgrade'];
  verifyGenericAuth: IRouteWebSocketUpgradeOptions['verifyGenericAuth'];
  isRequestAllowed: (remoteAddress: string | undefined) => boolean;
  rejectSocket: (socket: Duplex) => void;
  onUpgradeError?: (error: unknown) => void;
  routeUpgrade?: (options: IRouteWebSocketUpgradeOptions) => void | Promise<void>;
}

const safeDestroySocket = (socket: Duplex): void => {
  try {
    if (!socket.destroyed) socket.destroy();
  } catch {
    // best-effort socket cleanup
  }
};

const writeUpgradeJsonError = (
  socket: Duplex,
  statusCode: number,
  reason: string,
  body: Record<string, string>,
): void => {
  const payload = JSON.stringify(body);
  const headers = [
    `HTTP/1.1 ${statusCode} ${reason}`,
    'Content-Type: application/json',
    `Content-Length: ${Buffer.byteLength(payload, 'utf8')}`,
    'Connection: close',
  ];
  const response = `${headers.join('\r\n')}\r\n\r\n${payload}`;
  try {
    socket.end(response);
  } catch {
    safeDestroySocket(socket);
  }
};

const verifyUpgradeAuth = async (
  verifyAuth: (request: IncomingMessage) => Promise<boolean>,
  request: IncomingMessage,
): Promise<boolean> => {
  try {
    return await verifyAuth(request);
  } catch {
    return false;
  }
};

const hasInvalidRawRequestTargetChars = (rawUrl: string): boolean => /[#\u0000-\u0020\u007f-\u{10ffff}]/u.test(rawUrl);
const hasMalformedPercentEncoding = (rawUrl: string): boolean => /%(?![0-9A-Fa-f]{2})/.test(rawUrl);
const hasEncodedPathDelimiter = (rawUrl: string): boolean => /%(?:2[fF]|5[cC])/.test(rawUrl.split('?')[0] ?? '');
const isOriginFormRequestTarget = (rawUrl: string): boolean => rawUrl.startsWith('/') && !rawUrl.startsWith('//');
const isRuntimeV2WebSocketNamespace = (pathname: string): boolean => pathname === '/api/v2' || pathname.startsWith('/api/v2/');

const getSingleSearchParam = (searchParams: URLSearchParams, name: string): string | null => {
  const values = searchParams.getAll(name);
  return values.length === 1 ? values[0] : null;
};

export const routeWebSocketUpgrade = async ({
  request,
  socket,
  head,
  port,
  noAuthPaths,
  wsPaths,
  handleKnownUpgrade,
  handleRuntimeTerminalUpgrade,
  fallbackUpgrade,
  verifyRuntimeAuth = verifyRuntimeV2WebSocketAuth,
  verifyGenericAuth,
  runtimeEnabled = () => isRuntimeV2Enabled(),
}: IRouteWebSocketUpgradeOptions): Promise<void> => {
  const rawUrl = typeof request.url === 'string' ? request.url : '';
  if (
    rawUrl.length === 0
    || hasInvalidRawRequestTargetChars(rawUrl)
    || hasMalformedPercentEncoding(rawUrl)
    || hasEncodedPathDelimiter(rawUrl)
    || !isOriginFormRequestTarget(rawUrl)
  ) {
    writeUpgradeJsonError(socket, 400, 'Bad Request', { error: 'invalid-websocket-url' });
    return;
  }

  let url: URL;
  try {
    url = new URL(rawUrl, `http://localhost:${port}`);
  } catch {
    writeUpgradeJsonError(socket, 400, 'Bad Request', { error: 'invalid-websocket-url' });
    return;
  }

  if (isRuntimeV2WebSocketNamespace(url.pathname) && url.pathname !== '/api/v2/terminal') {
    writeUpgradeJsonError(socket, 404, 'Not Found', { error: 'runtime-v2-upgrade-not-found' });
    return;
  }

  if (url.pathname === '/api/v2/terminal') {
    if (!runtimeEnabled()) {
      writeUpgradeJsonError(socket, 404, 'Not Found', { error: 'runtime-v2-disabled' });
      return;
    }
    if (!(await verifyUpgradeAuth(verifyRuntimeAuth, request))) {
      writeUpgradeJsonError(socket, 401, 'Unauthorized', { error: 'Unauthorized' });
      return;
    }

    const rawSessionName = getSingleSearchParam(url.searchParams, 'session');
    if (!rawSessionName) {
      writeUpgradeJsonError(socket, 400, 'Bad Request', { error: 'invalid-runtime-v2-terminal-session' });
      return;
    }

    let sessionName: string;
    try {
      sessionName = parseRuntimeSessionName(rawSessionName);
    } catch {
      writeUpgradeJsonError(socket, 400, 'Bad Request', { error: 'invalid-runtime-v2-terminal-session' });
      return;
    }

    handleRuntimeTerminalUpgrade({
      sessionName,
      cols: parseTerminalDimension(getSingleSearchParam(url.searchParams, 'cols'), 80, MAX_TERMINAL_COLS),
      rows: parseTerminalDimension(getSingleSearchParam(url.searchParams, 'rows'), 24, MAX_TERMINAL_ROWS),
    }, request, socket, head);
    return;
  }

  if (noAuthPaths.has(url.pathname)) {
    handleKnownUpgrade(url, request, socket, head);
    return;
  }

  if (!(await verifyUpgradeAuth(verifyGenericAuth, request))) {
    writeUpgradeJsonError(socket, 401, 'Unauthorized', { error: 'Unauthorized' });
    return;
  }

  if (wsPaths.has(url.pathname)) {
    handleKnownUpgrade(url, request, socket, head);
    return;
  }

  fallbackUpgrade(request, socket, head);
};

export const createWebSocketUpgradeHandler = ({
  port,
  noAuthPaths,
  wsPaths,
  handleKnownUpgrade,
  handleRuntimeTerminalUpgrade,
  fallbackUpgrade,
  verifyGenericAuth,
  isRequestAllowed,
  rejectSocket,
  onUpgradeError,
  routeUpgrade = routeWebSocketUpgrade,
}: ICreateWebSocketUpgradeHandlerOptions) => {
  return async (request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> => {
    try {
      if (!isRequestAllowed(request.socket.remoteAddress)) {
        rejectSocket(socket);
        return;
      }

      await routeUpgrade({
        request,
        socket,
        head,
        port,
        noAuthPaths,
        wsPaths,
        verifyGenericAuth,
        handleKnownUpgrade,
        handleRuntimeTerminalUpgrade,
        fallbackUpgrade,
      });
    } catch (err) {
      try {
        onUpgradeError?.(err);
      } catch {
        // keep upgrade failure handling fail-closed
      }
      safeDestroySocket(socket);
    }
  };
};
