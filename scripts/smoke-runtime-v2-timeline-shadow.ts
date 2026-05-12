#!/usr/bin/env tsx
import fs from 'fs/promises';
import net from 'net';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import {
  compareRuntimeTimelineEntries,
  compareRuntimeTimelineMessageCounts,
} from '@/lib/runtime/timeline-shadow-compare';
import type { IMessageCountResult } from '@/lib/timeline-message-counts';
import { buildRuntimeEnvAlias, readRuntimeEnvAlias } from './runtime-env-alias';

const PASSWORD = 'runtime-v2-timeline-shadow-smoke';
const DEFAULT_TIMEOUT_MS = Number(
  readRuntimeEnvAlias(process.env, 'CODEXMUX_RUNTIME_V2_TIMELINE_SHADOW_TIMEOUT_MS') || 30_000,
);
const rootDir = process.cwd();

interface ITimelineEntriesResult {
  entries: Array<{ type?: unknown }>;
  startByteOffset: number;
  hasMore: boolean;
}

type TServer = {
  baseUrl: string;
  getOutput: () => string;
  stop: () => Promise<void>;
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
  fn: () => Promise<T | false | null | undefined>,
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
    await sleep(150);
  }
  throw new Error(`${label} timed out${lastError instanceof Error ? `: ${lastError.message}` : ''}`);
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
    throw new Error(`${init.method ?? 'GET'} ${pathname} failed: ${res.status} ${text}`);
  }
  return data;
};

const startServer = async ({ homeDir, dbPath, port }: {
  homeDir: string;
  dbPath: string;
  port: number;
}): Promise<TServer> => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: homeDir,
    NEXT_TELEMETRY_DISABLED: '1',
    SHELL: '/bin/sh',
    ...buildRuntimeEnvAlias('CODEXMUX_RUNTIME_V2', '1'),
    ...buildRuntimeEnvAlias('CODEXMUX_RUNTIME_STORAGE_V2_MODE', 'off'),
    ...buildRuntimeEnvAlias('CODEXMUX_RUNTIME_TERMINAL_V2_MODE', 'off'),
    ...buildRuntimeEnvAlias('CODEXMUX_RUNTIME_TIMELINE_V2_MODE', 'shadow'),
    ...buildRuntimeEnvAlias('CODEXMUX_RUNTIME_STATUS_V2_MODE', 'off'),
    ...buildRuntimeEnvAlias('CODEXMUX_RUNTIME_DB', dbPath),
    PORT: String(port),
  };
  delete env.__CMUX_PRISTINE_ENV;
  env.__CMUX_PRISTINE_ENV = JSON.stringify(env);

  const child = spawn('corepack', ['pnpm', 'exec', 'tsx', 'server.ts'], {
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
  await waitFor('runtime v2 timeline shadow server startup', async () => {
    if (child.exitCode !== null) {
      throw new Error(`server exited early with ${child.exitCode}: ${output.slice(-1600)}`);
    }
    const res = await fetch(new URL('/api/health', baseUrl)).catch(() => null);
    return res?.ok ? true : null;
  });

  return {
    baseUrl,
    getOutput: () => output,
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill('SIGINT');
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
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const cookie = extractCookieHeader(res);
  if (!cookie) throw new Error('login did not return a session cookie');
  return cookie;
};

const createFixture = async (homeDir: string): Promise<{ jsonlPath: string; beforeByte: number }> => {
  const dir = path.join(homeDir, '.codex', 'sessions', '2026', '05', '04');
  await fs.mkdir(dir, { recursive: true });
  const jsonlPath = path.join(dir, 'runtime-v2-timeline-shadow.jsonl');
  const content = [
    line({
      type: 'event_msg',
      timestamp: '2026-05-04T01:00:00.000Z',
      payload: { type: 'user_message', message: 'secret user prompt' },
    }),
    line({
      type: 'event_msg',
      timestamp: '2026-05-04T01:00:01.000Z',
      payload: { type: 'agent_message', message: 'secret assistant answer' },
    }),
    line({
      type: 'response_item',
      timestamp: '2026-05-04T01:00:02.000Z',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        call_id: 'call-runtime-v2-shadow',
        arguments: JSON.stringify({ cmd: 'git status --short' }),
      },
    }),
  ].join('\n');
  await fs.writeFile(jsonlPath, `${content}\n`, 'utf-8');
  const stat = await fs.stat(jsonlPath);
  return { jsonlPath, beforeByte: stat.size };
};

const main = async (): Promise<void> => {
  const homeDir = readRuntimeEnvAlias(process.env, 'CODEXMUX_RUNTIME_V2_TIMELINE_SHADOW_HOME')
    || await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-runtime-v2-timeline-shadow-'));
  const dbPath = path.join(homeDir, 'runtime-v2', 'state.db');
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const port = Number(readRuntimeEnvAlias(process.env, 'CODEXMUX_RUNTIME_V2_TIMELINE_SHADOW_PORT') || await getFreePort());
  const checks: string[] = [];
  let server: TServer | null = null;

  try {
    const fixture = await createFixture(homeDir);
    server = await startServer({ homeDir, dbPath, port });
    const cookie = await ensureLoggedIn(server.baseUrl);
    checks.push('cookie-login');

    const messageCountsQuery = `/api/timeline/message-counts?jsonlPath=${encodeURIComponent(fixture.jsonlPath)}`;
    const runtimeMessageCountsQuery = `/api/v2/timeline/message-counts?jsonlPath=${encodeURIComponent(fixture.jsonlPath)}`;
    const legacyCounts = await jsonRequest<IMessageCountResult>(server.baseUrl, messageCountsQuery, cookie);
    const runtimeCounts = await jsonRequest<IMessageCountResult>(server.baseUrl, runtimeMessageCountsQuery, cookie);
    const countsCompare = compareRuntimeTimelineMessageCounts(legacyCounts, runtimeCounts);
    if (!countsCompare.ok) {
      throw new Error(`runtime v2 timeline message-count mismatch: ${JSON.stringify(countsCompare.mismatches)}`);
    }
    checks.push('message-counts-shadow');

    const entriesParams = new URLSearchParams({
      jsonlPath: fixture.jsonlPath,
      beforeByte: String(fixture.beforeByte),
      limit: '3',
      panelType: 'codex',
    });
    const legacyEntries = await jsonRequest<ITimelineEntriesResult>(
      server.baseUrl,
      `/api/timeline/entries?${entriesParams.toString()}`,
      cookie,
    );
    const runtimeEntries = await jsonRequest<ITimelineEntriesResult>(
      server.baseUrl,
      `/api/v2/timeline/entries?${entriesParams.toString()}`,
      cookie,
    );
    const entriesCompare = compareRuntimeTimelineEntries(legacyEntries, runtimeEntries);
    if (!entriesCompare.ok) {
      throw new Error(`runtime v2 timeline entries mismatch: ${JSON.stringify(entriesCompare.mismatches)}`);
    }
    checks.push('entries-shadow');

    console.log(JSON.stringify({
      ok: true,
      homeDir,
      port,
      counts: legacyCounts,
      entryCount: legacyEntries.entries.length,
      checks,
    }, null, 2));
  } catch (err) {
    if (server) console.error(server.getOutput().slice(-4000));
    throw err;
  } finally {
    if (server) await server.stop();
  }
};

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
