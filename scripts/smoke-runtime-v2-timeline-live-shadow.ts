#!/usr/bin/env tsx
import fs from 'fs/promises';
import net from 'net';
import os from 'os';
import path from 'path';
import { execFileSync, spawn } from 'child_process';
import { WebSocket } from 'ws';
import { buildRuntimeEnvAlias, readRuntimeEnvAlias } from './runtime-env-alias';

const PASSWORD = 'runtime-v2-timeline-live-shadow-smoke';
const DEFAULT_TIMEOUT_MS = Number(
  readRuntimeEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_V2_TIMELINE_LIVE_SHADOW_TIMEOUT_MS') || 30_000,
);
const TMUX_SOCKET = 'codexwinmux';
const INITIAL_ENTRY_COUNT = 3;
const APPEND_PAIR_COUNT = 12;
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const rootDir = process.cwd();

interface ITimelineMessage {
  type: string;
  entries?: Array<{ id?: string; type?: string }>;
  totalEntries?: number;
  jsonlPath?: string | null;
}

interface IPerfSnapshot {
  runtime?: {
    counters?: Record<string, number>;
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
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${pathname} failed: ${res.status}`);
  }
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
      .replace(/secret-live-[a-z0-9-]+/g, '[content]');

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
    ...buildRuntimeEnvAlias('CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE', 'shadow'),
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
  await waitFor('runtime v2 timeline live shadow server startup', async () => {
    if (child.exitCode !== null) {
      throw new Error(`server exited early with ${child.exitCode}: ${sanitize(output.slice(-1600))}`);
    }
    const res = await fetch(new URL('/api/health', baseUrl)).catch(() => null);
    return res?.ok ? true : null;
  });

  return {
    baseUrl,
    sanitize,
    stop: async () => {
      if (child.exitCode !== null) return;
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        child.kill('SIGINT');
      }
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        sleep(10_000).then(() => {
          if (child.exitCode === null) child.kill('SIGTERM');
          return new Promise((resolve) => child.once('exit', resolve));
        }),
      ]);
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

const createFixture = async (homeDir: string): Promise<{ jsonlPath: string }> => {
  const dir = path.join(homeDir, '.codex', 'sessions', '2026', '05', '05');
  await fs.mkdir(dir, { recursive: true });
  const jsonlPath = path.join(dir, 'runtime-v2-timeline-live-shadow.jsonl');
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
      payload: { type: 'user_message', message: 'secret-live-initial-user' },
    }),
    line({
      type: 'event_msg',
      timestamp: '2026-05-05T01:00:01.000Z',
      payload: { type: 'agent_message', message: 'secret-live-initial-assistant' },
    }),
    line({
      type: 'response_item',
      timestamp: '2026-05-05T01:00:02.000Z',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        call_id: 'call-runtime-v2-live-shadow',
        arguments: JSON.stringify({ cmd: 'secret-live-command' }),
      },
    }),
  ].join('\n');
  await fs.writeFile(jsonlPath, `${content}\n`, 'utf-8');
  return { jsonlPath };
};

const createTmuxSession = (sessionName: string, cwd: string): void => {
  runTmux(['kill-session', '-t', sessionName], { allowFailure: true });
  runTmux(['new-session', '-d', '-s', sessionName, '-c', cwd, 'bash -lc "exec -a codex sleep 300"'], { cwd });
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

const appendLongTimeline = async (jsonlPath: string): Promise<void> => {
  const rows: string[] = [];
  for (let index = 0; index < APPEND_PAIR_COUNT; index += 1) {
    const second = String(index + 3).padStart(2, '0');
    rows.push(line({
      type: 'event_msg',
      timestamp: `2026-05-05T01:00:${second}.000Z`,
      payload: { type: 'user_message', message: `secret-live-user-${index}` },
    }));
    rows.push(line({
      type: 'event_msg',
      timestamp: `2026-05-05T01:01:${second}.000Z`,
      payload: { type: 'agent_message', message: `secret-live-assistant-${index}` },
    }));
  }
  await fs.appendFile(jsonlPath, `${rows.join('\n')}\n`, 'utf-8');
};

const appendCount = (messages: ITimelineMessage[]): number =>
  messages
    .filter((message) => message.type === 'timeline:append')
    .reduce((total, message) => total + (message.entries?.length ?? 0), 0);

const summarizeMessages = (messages: ITimelineMessage[]): Array<{
  type: string;
  entryCount?: number;
  totalEntries?: number;
  hasJsonlPath?: boolean;
}> =>
  messages.slice(-8).map((message) => ({
    type: message.type,
    ...(message.entries ? { entryCount: message.entries.length } : {}),
    ...(typeof message.totalEntries === 'number' ? { totalEntries: message.totalEntries } : {}),
    ...(message.jsonlPath !== undefined ? { hasJsonlPath: Boolean(message.jsonlPath) } : {}),
  }));

const assistantIds = (messages: ITimelineMessage[]): string[] =>
  messages
    .filter((message) => message.type === 'timeline:append')
    .flatMap((message) => message.entries ?? [])
    .filter((entry) => entry.type === 'assistant-message' && entry.id)
    .map((entry) => entry.id as string);

const assertNoDuplicateAssistantIds = (messages: ITimelineMessage[]): void => {
  const ids = assistantIds(messages);
  if (ids.length === 0) throw new Error('timeline append did not include assistant entries');
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    throw new Error('timeline append included duplicate assistant entries');
  }
};

const waitForShadowCounters = async (baseUrl: string, cookie: string): Promise<Record<string, number>> => {
  const snapshot = await waitFor<IPerfSnapshot>('runtime v2 timeline live shadow counters', async () => {
    const data = await jsonRequest<IPerfSnapshot>(baseUrl, '/api/debug/perf', cookie);
    const counters = data.runtime?.counters ?? {};
    const initMatches = counters['runtime_v2.timeline_shadow.init_match'] ?? 0;
    const appendMatches = counters['runtime_v2.timeline_shadow.append_match'] ?? 0;
    const initMismatches = counters['runtime_v2.timeline_shadow.init_mismatch'] ?? 0;
    const appendMismatches = counters['runtime_v2.timeline_shadow.append_mismatch'] ?? 0;
    const errors = counters['runtime_v2.timeline_shadow.error'] ?? 0;
    const startErrors = counters['runtime_v2.timeline_shadow.start_error'] ?? 0;
    if (initMatches >= 1 && appendMatches >= 1 && initMismatches === 0 && appendMismatches === 0 && errors === 0 && startErrors === 0) {
      return data;
    }
    return null;
  });
  return snapshot.runtime?.counters ?? {};
};

const main = async (): Promise<void> => {
  const homeDir = readRuntimeEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_V2_TIMELINE_LIVE_SHADOW_HOME')
    || await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-runtime-v2-timeline-live-shadow-'));
  const dbPath = path.join(homeDir, 'runtime-v2', 'state.db');
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const fixture = await createFixture(homeDir);
  const port = Number(readRuntimeEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_V2_TIMELINE_LIVE_SHADOW_PORT') || await getFreePort());
  const sessionName = `pt-rv2-timeline-live-${process.pid}`;
  const checks: string[] = [];
  let server: TServer | null = null;
  let timeline: TTimelineClient | null = null;

  try {
    server = await startServer({ homeDir, dbPath, port, jsonlPath: fixture.jsonlPath });
    const cookie = await ensureLoggedIn(server.baseUrl);
    checks.push('cookie-login');

    createTmuxSession(sessionName, homeDir);
    checks.push('tmux-session');

    timeline = await connectTimeline(server.baseUrl, cookie, sessionName);
    checks.push('timeline-ws-open');

    await waitFor('timeline init for fixture', () => {
      const found = timeline?.messages.find((message) =>
        message.type === 'timeline:init'
        && message.totalEntries === INITIAL_ENTRY_COUNT
        && message.jsonlPath === fixture.jsonlPath);
      if (found) return found;
      return null;
    }).catch((err) => {
      throw new Error(`${err instanceof Error ? err.message : err}; messages=${JSON.stringify(summarizeMessages(timeline?.messages ?? []))}`);
    });
    checks.push('legacy-init');

    await sleep(250);
    await appendLongTimeline(fixture.jsonlPath);
    await waitFor('timeline append frames', () => appendCount(timeline?.messages ?? []) >= APPEND_PAIR_COUNT * 2)
      .catch((err) => {
        throw new Error(`${err instanceof Error ? err.message : err}; messages=${JSON.stringify(summarizeMessages(timeline?.messages ?? []))}`);
      });
    assertNoDuplicateAssistantIds(timeline.messages);
    checks.push('legacy-append');

    const counters = await waitForShadowCounters(server.baseUrl, cookie);
    checks.push('shadow-counters');

    console.log(JSON.stringify({
      ok: true,
      port,
      appendedEntries: APPEND_PAIR_COUNT * 2,
      shadow: {
        initMatches: counters['runtime_v2.timeline_shadow.init_match'] ?? 0,
        appendMatches: counters['runtime_v2.timeline_shadow.append_match'] ?? 0,
        initMismatches: counters['runtime_v2.timeline_shadow.init_mismatch'] ?? 0,
        appendMismatches: counters['runtime_v2.timeline_shadow.append_mismatch'] ?? 0,
        errors: counters['runtime_v2.timeline_shadow.error'] ?? 0,
      },
      checks,
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
