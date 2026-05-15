if (!process.env.CODEXMUX_CLI) process.env.CODEXMUX_CLI = '1';
import './src/lib/pristine-env';
import { createServer, request as httpRequest } from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import { createConnection } from 'net';
import path from 'path';
import next from 'next';
import { WebSocketServer } from 'ws';
import { verifySessionToken, SESSION_COOKIE, extractCookie } from './src/lib/auth';
import { handleConnection, gracefulShutdown } from './src/lib/terminal-server';
import { handleInstallConnection, gracefulInstallShutdown } from './src/lib/install-server';
import { handleTimelineConnection, gracefulTimelineShutdown } from './src/lib/timeline-server';
import { handleSyncConnection, gracefulSyncShutdown } from './src/lib/sync-server';
import { handleStatusConnection, gracefulStatusShutdown } from './src/lib/status-server';
import { getStatusManager } from './src/lib/status-manager';
import { ensureHookSettings, removePortFile } from './src/lib/hook-settings';
import { getCliToken } from './src/lib/cli-token';
import { acquireLock, releaseLock, registerLockCleanup } from './src/lib/lock';
import { scanSessions, applyConfig } from './src/lib/tmux';
import { initWorkspaceStore } from './src/lib/workspace-store';
import { autoResumeOnStartup } from './src/lib/auto-resume';
import { initAuthCredentials } from './src/lib/auth-credentials';
import { initConfigStore, getConfig } from './src/lib/config-store';
import { listInterfaceIps, resolveBindPlan } from './src/lib/network-access';
import { getCurrentSpec, initAccessFilter, isRequestAllowed, setBoundHost } from './src/lib/access-filter';
import { initShellPath } from './src/lib/preflight';
import { cleanupExpiredUploads } from './src/lib/uploads-store';
import { cleanupOrphanSessionStats } from './src/lib/session-stats';
import {
  initSessionIndexService,
  shouldPrewarmSessionIndexOnStartup,
  shutdownSessionIndexService,
} from './src/lib/session-index';
import { getRuntimeSupervisor } from './src/lib/runtime/supervisor';
import { getRuntimeStatusV2Mode } from './src/lib/runtime/status-mode';
import { runRuntimeStartupDiagnostic } from './src/lib/runtime/startup-diagnostic';
import { handleRuntimeTerminalConnection } from './src/lib/runtime/terminal-ws';
import {
  createWebSocketUpgradeHandler,
  type IRuntimeTerminalUpgradeContext,
} from './src/lib/runtime/server-ws-upgrade';
import { isRuntimeV2Enabled } from './src/lib/runtime/env';
import { createLogger } from './src/lib/logger';
import pkg from './package.json';

const log = createLogger('server');
const dev = process.env.NODE_ENV !== 'production';

const verifyWebSocketAuth = async (request: IncomingMessage): Promise<boolean> => {
  const value = extractCookie(request.headers.cookie ?? '', SESSION_COOKIE);
  if (!value) return false;
  return !!(await verifySessionToken(value));
};

const WS_PATHS = new Set(['/api/terminal', '/api/timeline', '/api/sync', '/api/status', '/api/install', '/api/v2/terminal']);

const createWsServers = () => {
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', handleConnection);

  const timelineWss = new WebSocketServer({ noServer: true });
  timelineWss.on('connection', handleTimelineConnection);

  const syncWss = new WebSocketServer({ noServer: true });
  syncWss.on('connection', handleSyncConnection);

  const statusWss = new WebSocketServer({ noServer: true });
  statusWss.on('connection', handleStatusConnection);

  const installWss = new WebSocketServer({ noServer: true });
  installWss.on('connection', handleInstallConnection);

  const runtimeTerminalWss = new WebSocketServer({ noServer: true });
  runtimeTerminalWss.on('connection', (ws: import('ws').WebSocket, _request: IncomingMessage, context: unknown) => {
    void handleRuntimeTerminalConnection(
      ws,
      context as IRuntimeTerminalUpgradeContext,
      getRuntimeSupervisor(),
    );
  });

  return { wss, timelineWss, syncWss, statusWss, installWss, runtimeTerminalWss };
};

const handleWsUpgrade = (
  { wss, timelineWss, syncWss, statusWss, installWss }: ReturnType<typeof createWsServers>,
  request: IncomingMessage,
  socket: import('stream').Duplex,
  head: Buffer,
  url: URL,
) => {
  if (url.pathname === '/api/terminal') {
    const sessionId = url.searchParams.get('session');
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, sessionId);
    });
  } else if (url.pathname === '/api/timeline') {
    timelineWss.handleUpgrade(request, socket, head, (ws) => {
      timelineWss.emit('connection', ws, request);
    });
  } else if (url.pathname === '/api/sync') {
    syncWss.handleUpgrade(request, socket, head, (ws) => {
      syncWss.emit('connection', ws);
    });
  } else if (url.pathname === '/api/status') {
    statusWss.handleUpgrade(request, socket, head, (ws) => {
      statusWss.emit('connection', ws);
    });
  } else if (url.pathname === '/api/install') {
    installWss.handleUpgrade(request, socket, head, (ws) => {
      installWss.emit('connection', ws, request);
    });
  }
};

const NO_AUTH_WS_PATHS = new Set(['/api/install']);

const shutdownWs = async () => {
  shutdownSessionIndexService();
  gracefulTimelineShutdown();
  gracefulSyncShutdown();
  gracefulStatusShutdown();
  gracefulInstallShutdown();
  await gracefulShutdown();
};

// --- Production: HTTP proxy to Next.js standalone ---

const proxyRequest = (req: IncomingMessage, res: ServerResponse, internalPort: number) => {
  const proxyReq = httpRequest(
    {
      hostname: '127.0.0.1',
      port: internalPort,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode!, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502);
      res.end('Bad Gateway');
    }
  });
  req.pipe(proxyReq);
};

const proxyUpgrade = (req: IncomingMessage, socket: import('stream').Duplex, head: Buffer, internalPort: number) => {
  const proxySocket = createConnection({ host: '127.0.0.1', port: internalPort }, () => {
    const reqLine = `${req.method} ${req.url} HTTP/1.1\r\n`;
    const headers = Object.entries(req.headers)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join('\r\n');
    proxySocket.write(reqLine + headers + '\r\n\r\n');
    if (head.length > 0) proxySocket.write(head);
    socket.pipe(proxySocket).pipe(socket);
  });
  proxySocket.on('error', () => socket.destroy());
  socket.on('error', () => proxySocket.destroy());
};

const getReservedPorts = () =>
  new Set(
    (process.env.CODEXMUX_RESERVED_PORTS || '')
      .split(/[,\s;]+/)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0 && value <= 65535),
  );

const findFreePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });

const getFreePort = async (): Promise<number> => {
  const reservedPorts = getReservedPorts();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await findFreePort();
    if (!reservedPorts.has(port)) return port;
  }
  throw new Error('No free non-reserved port found');
};

const listenWithFallback = (server: import('http').Server, port: number, host: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        log.warn(`Port ${port} is in use, finding an available port...`);
        server.removeListener('error', onError);
        server.on('error', reject);
        server.listen(0, host, () => {
          resolve((server.address() as { port: number }).port);
        });
      } else {
        reject(err);
      }
    };
    server.on('error', onError);
    server.listen(port, host, () => {
      resolve((server.address() as { port: number }).port);
    });
  });

const waitForPort = (port: number, timeoutMs = 10_000): Promise<void> =>
  new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (Date.now() > deadline) {
        reject(new Error(`Standalone server failed to start on port ${port}`));
        return;
      }
      const sock = createConnection({ host: '127.0.0.1', port });
      sock.on('connect', () => {
        sock.destroy();
        resolve();
      });
      sock.on('error', () => setTimeout(check, 50));
    };
    check();
  });

// --- Start ---

interface IStartOptions {
  port?: number;
}

interface IStartResult {
  port: number;
  shutdown: () => Promise<void>;
}

const rejectRequest = (res: ServerResponse) => {
  res.writeHead(403, { 'Content-Type': 'text/plain' });
  res.end('Forbidden');
};

const rejectSocket = (socket: import('stream').Duplex) => {
  socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
  socket.destroy();
};

const startDev = async (port: number, appDir: string, bindHost: string): Promise<IStartResult> => {
  const app = next({ dev: true, dir: appDir });
  const handle = app.getRequestHandler();

  await app.prepare();

  const upgrade = app.getUpgradeHandler();
  const server = createServer((req, res) => {
    if (!isRequestAllowed(req.socket.remoteAddress)) {
      rejectRequest(res);
      return;
    }
    handle(req, res);
  });

  const wsServers = createWsServers();

  server.on('upgrade', createWebSocketUpgradeHandler({
    port,
    noAuthPaths: NO_AUTH_WS_PATHS,
    wsPaths: WS_PATHS,
    verifyGenericAuth: verifyWebSocketAuth,
    handleKnownUpgrade: (url, req, upgradeSocket, upgradeHead) => {
      handleWsUpgrade(wsServers, req, upgradeSocket, upgradeHead, url);
    },
    handleRuntimeTerminalUpgrade: (context, req, upgradeSocket, upgradeHead) => {
      wsServers.runtimeTerminalWss.handleUpgrade(req, upgradeSocket, upgradeHead, (ws) => {
        wsServers.runtimeTerminalWss.emit('connection', ws, req, context);
      });
    },
    fallbackUpgrade: upgrade,
    isRequestAllowed,
    rejectSocket,
    onUpgradeError: (err) => {
      log.error(`websocket upgrade failed: ${err instanceof Error ? err.message : err}`);
    },
  }));

  const shutdown = async () => {
    releaseLock();
    await removePortFile();
    server.close();
    if (isRuntimeV2Enabled()) {
      getRuntimeSupervisor().shutdown();
    }
    await shutdownWs();
  };

  const exitGracefully = async () => {
    await shutdown();
    process.exit(0);
  };
  process.on('SIGTERM', exitGracefully);
  process.on('SIGINT', exitGracefully);

  const actualPort = await listenWithFallback(server, port, bindHost);
  return { port: actualPort, shutdown };
};

const startProd = async (port: number, appDir: string, bindHost: string): Promise<IStartResult> => {
  const internalPort = await getFreePort();

  const savedPort = process.env.PORT;
  process.env.PORT = String(internalPort);
  process.env.HOSTNAME = '127.0.0.1';

  const standaloneDir = process.env.__CMUX_APP_DIR_UNPACKED || appDir;
  const standalonePath = path.join(standaloneDir, '.next', 'standalone', 'server.js');
  require(standalonePath); // eslint-disable-line @typescript-eslint/no-require-imports

  process.env.PORT = savedPort;

  await waitForPort(internalPort);

  const server = createServer((req, res) => {
    if (!isRequestAllowed(req.socket.remoteAddress)) {
      rejectRequest(res);
      return;
    }
    proxyRequest(req, res, internalPort);
  });

  const wsServers = createWsServers();

  server.on('upgrade', createWebSocketUpgradeHandler({
    port,
    noAuthPaths: NO_AUTH_WS_PATHS,
    wsPaths: WS_PATHS,
    verifyGenericAuth: verifyWebSocketAuth,
    handleKnownUpgrade: (url, req, upgradeSocket, upgradeHead) => {
      handleWsUpgrade(wsServers, req, upgradeSocket, upgradeHead, url);
    },
    handleRuntimeTerminalUpgrade: (context, req, upgradeSocket, upgradeHead) => {
      wsServers.runtimeTerminalWss.handleUpgrade(req, upgradeSocket, upgradeHead, (ws) => {
        wsServers.runtimeTerminalWss.emit('connection', ws, req, context);
      });
    },
    fallbackUpgrade: (req, upgradeSocket, upgradeHead) => proxyUpgrade(req, upgradeSocket, upgradeHead, internalPort),
    isRequestAllowed,
    rejectSocket,
    onUpgradeError: (err) => {
      log.error(`websocket upgrade failed: ${err instanceof Error ? err.message : err}`);
    },
  }));

  const shutdown = async () => {
    releaseLock();
    await removePortFile();
    server.close();
    if (isRuntimeV2Enabled()) {
      getRuntimeSupervisor().shutdown();
    }
    await shutdownWs();
  };

  const exitGracefully = async () => {
    await shutdown();
    process.exit(0);
  };
  process.on('SIGTERM', exitGracefully);
  process.on('SIGINT', exitGracefully);

  const actualPort = await listenWithFallback(server, port, bindHost);
  return { port: actualPort, shutdown };
};

export const DEFAULT_PORT = 8121;



export const start = async (opts?: IStartOptions): Promise<IStartResult> => {
  const port = opts?.port ?? parseInt(process.env.PORT || String(DEFAULT_PORT), 10);
  const appDir = process.env.__CMUX_APP_DIR || process.cwd();

  await acquireLock(port);
  registerLockCleanup();

  await Promise.all([initConfigStore(), initShellPath()]);

  const credentials = await initAuthCredentials();
  if (credentials) {
    process.env.AUTH_PASSWORD = credentials.password;
    process.env.NEXTAUTH_SECRET = credentials.secret;
  }

  await scanSessions();
  await applyConfig();
  await initWorkspaceStore();
  await autoResumeOnStartup();
  if (shouldPrewarmSessionIndexOnStartup()) {
    await initSessionIndexService();
  }
  if (isRuntimeV2Enabled()) {
    runRuntimeStartupDiagnostic(getRuntimeSupervisor(), log);
  }
  if (isRuntimeV2Enabled() && getRuntimeStatusV2Mode() === 'default') {
    try {
      await getRuntimeSupervisor().startStatusLive();
    } catch (err) {
      log.warn(`Runtime status live startup failed, falling back: ${err instanceof Error ? err.message : err}`);
      await getStatusManager().init();
    }
  } else {
    await getStatusManager().init();
  }

  const envHost = process.env.HOST?.trim();
  const configData = await getConfig();
  initAccessFilter(envHost, configData.networkAccess);
  const accessSpec = getCurrentSpec();
  const bindPlan = resolveBindPlan(accessSpec);
  setBoundHost(bindPlan.host);

  const result = dev
    ? await startDev(port, appDir, bindPlan.host)
    : await startProd(port, appDir, bindPlan.host);

  process.env.PORT = String(result.port);

  await ensureHookSettings(result.port);
  getCliToken();

  cleanupExpiredUploads()
    .then((r) => {
      if (r.deleted > 0) log.info(`uploads cleanup: removed ${r.deleted} files (${r.freedBytes} bytes)`);
    })
    .catch((err) => log.warn(`uploads cleanup failed: ${err instanceof Error ? err.message : err}`));

  cleanupOrphanSessionStats().catch((err) =>
    log.warn(`session-stats cleanup failed: ${err instanceof Error ? err.message : err}`),
  );

  const mode = dev ? 'development' : process.env.NODE_ENV;
  const urls = listInterfaceIps(accessSpec, result.port);
  console.log('');
  console.log(`  \x1b[1m\x1b[35m⚡ codexwinmux\x1b[0m  \x1b[2mv${pkg.version}\x1b[0m`);
  console.log(`  \x1b[2m➜\x1b[0m  Available on:`);
  for (const url of urls) {
    console.log(`       \x1b[36m${url}\x1b[0m`);
  }
  if (envHost) {
    console.log(`  \x1b[2m➜\x1b[0m  Access: \x1b[33mHOST=${envHost}\x1b[0m`);
  }
  console.log(`  \x1b[2m➜\x1b[0m  Mode:   \x1b[33m${mode}\x1b[0m`);
  const authStatus = !credentials
    ? `\x1b[33mwaiting for onboarding\x1b[0m \x1b[2m(${urls[0]}/login)\x1b[0m`
    : credentials.init
      ? `\x1b[33minit password\x1b[0m \x1b[2m(onboarding required)\x1b[0m`
      : `\x1b[32mconfigured\x1b[0m`;
  console.log(`  \x1b[2m➜\x1b[0m  Auth:   ${authStatus}`);
  console.log('');

  return result;
};

if (!process.env.__CMUX_ELECTRON) {
  start();
}
