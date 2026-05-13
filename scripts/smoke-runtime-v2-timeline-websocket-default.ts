#!/usr/bin/env tsx
import fs from 'fs/promises';
import net from 'net';
import os from 'os';
import path from 'path';
import { execFileSync, spawn } from 'child_process';
import { WebSocket } from 'ws';
import { buildRuntimeEnvAlias, readRuntimeEnvAlias } from './runtime-env-alias';

const PASSWORD = 'runtime-v2-timeline-websocket-default-smoke';
const DEFAULT_TIMEOUT_MS = Number(
  readRuntimeEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_V2_TIMELINE_WEBSOCKET_DEFAULT_TIMEOUT_MS') || 30_000,
);
const TMUX_SOCKET = 'codexwinmux';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const INITIAL_ENTRY_COUNT = 2;
const APPEND_ENTRY_COUNT = 1;
const SERVER_CLEANUP_GRACE_MS = 3_000;
const rootDir = process.cwd();

interface ITimelineMessage {
  type: string;
  reason?: string;
  newSessionId?: string;
  entries?: Array<{ id?: string; type?: string }>;
  totalEntries?: number;
  jsonlPath?: string | null;
  isAgentStarting?: boolean;
}

interface IPerfSnapshot {
  runtime?: {
    counters?: Record<string, number>;
  };
}

interface IRuntimeHealth {
  timelineV2Mode?: string;
  timeline?: {
    ok?: boolean;
  };
}

type TServer = {
  baseUrl: string;
  stop: () => Promise<void>;
  sanitize: (value: string) => string;
};

type TTimelineClient = {
  ws: WebSocket;
  messages: ITimelineMessage[];
  waitFor: (label: string, predicate: (message: ITimelineMessage) => boolean) => Promise<ITimelineMessage>;
  close: () => Promise<void>;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const line = (value: unknown): string => JSON.stringify(value);

const waitForProcessExit = async (
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<boolean> => {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
  });
};

const stopServerChild = async (
  child: ReturnType<typeof spawn>,
  label: string,
  graceMs = SERVER_CLEANUP_GRACE_MS,
): Promise<void> => {
  if (await waitForProcessExit(child, 0)) return;

  if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        child.kill('SIGINT');
      }
  if (await waitForProcessExit(child, graceMs)) return;

  child.kill('SIGTERM');
  if (await waitForProcessExit(child, graceMs)) return;

  child.kill('SIGKILL');
  if (await waitForProcessExit(child, graceMs)) return;

  throw new Error(`${label} cleanup timed out after SIGKILL`);
};

const getFreePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });

const waitFor = async <T>(
  label: string,
  fn: () => Promise<T | false | null | undefined> | T | false | null | undefined,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (err) {
      lastError = err;
    }
    await sleep(100);
  }
  throw new Error(`${label} timed out${lastError instanceof Error ? `: ${lastError.message}` : ''}`);
};

const runTmux = (args: string[], options: { cwd?: string; allowFailure?: boolean } = {}): string => {
  try {
    return execFileSync('tmux', ['-L', TMUX_SOCKET, ...args], {
      cwd: options.cwd ?? rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    }).trim();
  } catch (err) {
    if (options.allowFailure) return '';
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`tmux command failed: ${detail}`);
  }
};

const extractCookieHeader = (response: Response): string => {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const raw = cookies[0] ?? headers.get('set-cookie');
  return raw?.split(';')[0] ?? '';
};

const jsonRequest = async <T>(
  baseUrl: string,
  pathname: string,
  cookie: string,
  init: RequestInit = {},
): Promise<T> => {
  const headers = {
    ...(cookie ? { Cookie: cookie } : {}),
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers ?? {}),
  };
  const res = await fetch(new URL(pathname, baseUrl), { ...init, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) as T : null as T;
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${pathname} failed: ${res.status}`);
  return data;
};

const startServer = async ({ homeDir, dbPath, port, jsonlPath }: {
  homeDir: string;
  dbPath: string;
  port: number;
  jsonlPath: string;
}): Promise<TServer> => {
  const sanitize = (value: string): string =>
    value
      .split(homeDir).join('[home]')
      .split(jsonlPath).join('[jsonl]')
      .replace(/secret-default-[a-z0-9-]+/g, '[content]')
      .replace(/codexmux_session=[^;\s]+/g, 'codexmux_session=[cookie]');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: process.env.PATH || process.env.Path,
    HOME: homeDir,
    ...(process.platform === 'win32' ? {
      USERPROFILE: homeDir,
      APPDATA: path.join(homeDir, 'AppData', 'Roaming'),
      LOCALAPPDATA: path.join(homeDir, 'AppData', 'Local'),
    } : {}),
    NEXT_TELEMETRY_DISABLED: '1',
    SHELL: '/bin/sh',
    ...buildRuntimeEnvAlias('CODEXWINMUX_RUNTIME_V2', '1'),
    ...buildRuntimeEnvAlias('CODEXWINMUX_RUNTIME_STORAGE_V2_MODE', 'off'),
    ...buildRuntimeEnvAlias('CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE', 'off'),

    ...(process.platform === 'win32' ? buildRuntimeEnvAlias('CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER', 'windows') : {}),
    ...buildRuntimeEnvAlias('CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE', 'default'),
    ...buildRuntimeEnvAlias('CODEXWINMUX_RUNTIME_STATUS_V2_MODE', 'off'),
    ...buildRuntimeEnvAlias('CODEXWINMUX_RUNTIME_DB', dbPath),
    PORT: String(port),
  };
  delete env.__CMUX_PRISTINE_ENV;
  env.__CMUX_PRISTINE_ENV = JSON.stringify(env);

  const child = spawn(
    process.platform === 'win32' ? 'cmd.exe' : 'corepack',
    process.platform === 'win32'
      ? ['/d', '/s', '/c', 'corepack pnpm exec tsx server.ts']
      : ['pnpm', 'exec', 'tsx', 'server.ts'],
    {
    cwd: rootDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout?.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    output += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitFor('runtime v2 timeline websocket default server startup', async () => {
      if (child.exitCode !== null) {
        throw new Error(`server exited early with ${child.exitCode}: ${sanitize(output.slice(-1600))}`);
      }
      const res = await fetch(new URL('/api/health', baseUrl)).catch(() => null);
      return res?.ok ? true : null;
    });
  } catch (err) {
    let cleanupError: unknown;
    try {
      await stopServerChild(child, 'startup server');
    } catch (cleanupErr) {
      cleanupError = cleanupErr;
    }

    const detail = err instanceof Error ? err.message : String(err);
    const cleanupDetail = cleanupError instanceof Error
      ? `; cleanup failed: ${cleanupError.message}`
      : cleanupError
        ? `; cleanup failed: ${String(cleanupError)}`
        : '';
    throw new Error(sanitize(`${detail}${cleanupDetail}`));
  }

  return {
    baseUrl,
    sanitize,
    stop: async () => {
      await stopServerChild(child, 'server');
    },
  };
};

const ensureLoggedIn = async (baseUrl: string): Promise<string> => {
  const setup = await jsonRequest<{ needsSetup?: boolean }>(baseUrl, '/api/auth/setup', '').catch(() => null);
  if (setup?.needsSetup) {
    await jsonRequest(baseUrl, '/api/auth/setup', '', {
      method: 'POST',
      body: JSON.stringify({
        authPassword: PASSWORD,
        locale: 'ko',
        appTheme: 'dark',
        dangerouslySkipPermissions: true,
        networkAccess: 'localhost',
      }),
    });
  }

  const res = await fetch(new URL('/api/auth/login', baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const cookie = extractCookieHeader(res);
  if (!cookie) throw new Error('login did not return a session cookie');
  return cookie;
};

const prepareFixturePath = async (homeDir: string): Promise<string> => {
  const dir = path.join(homeDir, '.codex', 'sessions', '2026', '05', '05');
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, `${SESSION_ID}.jsonl`);
};

const writeFixture = async (homeDir: string, jsonlPath: string): Promise<void> => {
  const startedAt = new Date().toISOString();
  const content = [
    line({
      type: 'session_meta',
      timestamp: startedAt,
      payload: {
        id: SESSION_ID,
        cwd: homeDir,
        timestamp: startedAt,
      },
    }),
    line({
      type: 'event_msg',
      timestamp: '2026-05-05T01:00:00.000Z',
      payload: { type: 'user_message', message: 'secret-default-initial-user' },
    }),
    line({
      type: 'event_msg',
      timestamp: '2026-05-05T01:00:01.000Z',
      payload: { type: 'agent_message', message: 'secret-default-initial-assistant' },
    }),
  ].join('\n');
  await fs.writeFile(jsonlPath, `${content}\n`, 'utf-8');
};

const appendTimelineEntry = async (jsonlPath: string): Promise<void> => {
  await fs.appendFile(jsonlPath, `${line({
    type: 'event_msg',
    timestamp: '2026-05-05T01:00:02.000Z',
    payload: { type: 'user_message', message: 'secret-default-appended-user' },
  })}\n`, 'utf-8');
};

const createTmuxSession = (sessionName: string, cwd: string): void => {
  runTmux(['kill-session', '-t', sessionName], { allowFailure: true });
  runTmux([
    'new-session',
    '-d',
    '-s',
    sessionName,
    '-c',
    cwd,
    `bash -lc 'bash -c "exec -a codex-${SESSION_ID} sleep 300" & wait'`,
  ], { cwd });
};

const timelineWsUrl = (baseUrl: string, sessionName: string): string => {
  const url = new URL('/api/timeline', baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('session', sessionName);
  url.searchParams.set('panelType', 'codex');
  return url.toString();
};

const connectTimeline = (baseUrl: string, cookie: string, sessionName: string): Promise<TTimelineClient> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(timelineWsUrl(baseUrl, sessionName), { headers: { Cookie: cookie } });
    const messages: ITimelineMessage[] = [];
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('timeline websocket open timed out'));
    }, 8_000);

    const waitForMessage = (
      label: string,
      predicate: (message: ITimelineMessage) => boolean,
    ): Promise<ITimelineMessage> =>
      waitFor(label, () => messages.find(predicate) ?? null);

    ws.on('open', () => {
      clearTimeout(timer);
      resolve({
        ws,
        messages,
        waitFor: waitForMessage,
        close: () => new Promise<void>((finish) => {
          if (ws.readyState === WebSocket.CLOSED) {
            finish();
            return;
          }
          ws.once('close', () => finish());
          ws.close();
          setTimeout(finish, 1000);
        }),
      });
    });
    ws.on('message', (raw) => {
      try {
        messages.push(JSON.parse(raw.toString()) as ITimelineMessage);
      } catch {
        // ignore malformed frames in smoke collection
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    ws.on('close', (code, reason) => {
      clearTimeout(timer);
      if (messages.length === 0) {
        reject(new Error(`timeline websocket closed before messages: ${code} ${reason.toString()}`));
      }
    });
  });

const waitForRuntimeCounters = async (baseUrl: string, cookie: string): Promise<Record<string, number>> => {
  const snapshot = await waitFor<IPerfSnapshot>('runtime v2 timeline websocket default counters', async () => {
    const data = await jsonRequest<IPerfSnapshot>(baseUrl, '/api/debug/perf', cookie);
    const counters = data.runtime?.counters ?? {};
    const init = counters['runtime_v2.timeline_ws.default.init'] ?? 0;
    const append = counters['runtime_v2.timeline_ws.default.append'] ?? 0;
    if (init >= 1 && append >= 1) return data;
    return null;
  });
  return snapshot.runtime?.counters ?? {};
};

const appendEntryCount = (message: ITimelineMessage): number =>
  message.entries?.length ?? 0;

const summarizeMessages = (messages: ITimelineMessage[]): Array<{
  type: string;
  reason?: string;
  hasSessionId?: boolean;
  entryCount?: number;
  totalEntries?: number;
  hasJsonlPath?: boolean;
  isAgentStarting?: boolean;
}> =>
  messages.slice(-8).map((message) => ({
    type: message.type,
    ...(message.reason ? { reason: message.reason } : {}),
    ...(message.newSessionId !== undefined ? { hasSessionId: Boolean(message.newSessionId) } : {}),
    ...(message.entries ? { entryCount: message.entries.length } : {}),
    ...(typeof message.totalEntries === 'number' ? { totalEntries: message.totalEntries } : {}),
    ...(message.jsonlPath !== undefined ? { hasJsonlPath: Boolean(message.jsonlPath) } : {}),
    ...(message.isAgentStarting !== undefined ? { isAgentStarting: message.isAgentStarting } : {}),
  }));

const main = async (): Promise<void> => {
  const homeDir = readRuntimeEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_V2_TIMELINE_WEBSOCKET_DEFAULT_HOME')
    || await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-runtime-v2-timeline-websocket-default-'));
  const dbPath = path.join(homeDir, 'runtime-v2', 'state.db');
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const jsonlPath = await prepareFixturePath(homeDir);
  const port = Number(readRuntimeEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_V2_TIMELINE_WEBSOCKET_DEFAULT_PORT') || await getFreePort());
  const sessionName = `pt-rv2-timeline-default-${process.pid}`;
  const checks: string[] = [];
  let server: TServer | null = null;
  let timeline: TTimelineClient | null = null;

  try {
    server = await startServer({ homeDir, dbPath, port, jsonlPath });
    const cookie = await ensureLoggedIn(server.baseUrl);
    checks.push('cookie-login');

    createTmuxSession(sessionName, homeDir);
    checks.push('tmux-codex');

    await sleep(250);
    await writeFixture(homeDir, jsonlPath);
    checks.push('jsonl-fixture');

    timeline = await connectTimeline(server.baseUrl, cookie, sessionName);
    checks.push('timeline-ws-open');

    const init = await timeline.waitFor('timeline init for fixture', (message) =>
      message.type === 'timeline:init'
      && message.totalEntries === INITIAL_ENTRY_COUNT
      && Boolean(message.jsonlPath))
      .catch((err) => {
        throw new Error(`${err instanceof Error ? err.message : err}; messages=${JSON.stringify(summarizeMessages(timeline?.messages ?? []))}`);
      });
    checks.push('timeline-init');

    await sleep(250);
    await appendTimelineEntry(jsonlPath);
    const append = await timeline.waitFor('timeline append', (message) =>
      message.type === 'timeline:append'
      && appendEntryCount(message) === APPEND_ENTRY_COUNT)
      .catch((err) => {
        throw new Error(`${err instanceof Error ? err.message : err}; messages=${JSON.stringify(summarizeMessages(timeline?.messages ?? []))}`);
      });
    checks.push('timeline-append');

    const runtimeHealth = await jsonRequest<IRuntimeHealth>(server.baseUrl, '/api/v2/runtime/health', cookie);
    if (runtimeHealth.timelineV2Mode !== 'default' || runtimeHealth.timeline?.ok !== true) {
      throw new Error('runtime health did not report timeline default mode');
    }
    checks.push('runtime-health-default');

    const counters = await waitForRuntimeCounters(server.baseUrl, cookie);
    checks.push('runtime-counters');

    console.log(JSON.stringify({
      ok: true,
      timelineV2Mode: runtimeHealth.timelineV2Mode,
      checks,
      initTotalEntries: init.totalEntries,
      appendEntries: appendEntryCount(append),
      runtimeCounters: {
        init: counters['runtime_v2.timeline_ws.default.init'] ?? 0,
        append: counters['runtime_v2.timeline_ws.default.append'] ?? 0,
      },
    }, null, 2));
  } catch (err) {
    const message = err instanceof Error ? err.stack || err.message : String(err);
    throw new Error(server ? server.sanitize(message) : message);
  } finally {
    if (timeline) await timeline.close().catch(() => undefined);
    runTmux(['kill-session', '-t', sessionName], { allowFailure: true });
    if (server) await server.stop();
  }
};

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
