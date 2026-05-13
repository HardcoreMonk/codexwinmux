#!/usr/bin/env tsx
import fs from 'fs/promises';
import net from 'net';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import {
  collectRuntimeStorageShadowTabs,
  compareRuntimeStorageShadowTabs,
} from '@/lib/runtime/storage-shadow-compare';
import type { ILayoutData, IPaneNode, TLayoutNode } from '@/types/terminal';
import { buildRuntimeEnvAlias, readRuntimeEnvAlias } from './runtime-env-alias';
import { resolveStorageShadowFixtureMode } from './runtime-v2-storage-shadow-smoke-lib';

const PASSWORD = 'runtime-v2-storage-shadow-smoke';
const DEFAULT_TIMEOUT_MS = Number(
  readRuntimeEnvAlias(process.env, 'CODEXMUX_RUNTIME_V2_STORAGE_SHADOW_TIMEOUT_MS') || 30_000,
);
const rootDir = process.cwd();

type TServer = {
  baseUrl: string;
  child: ReturnType<typeof spawn>;
  getOutput: () => string;
  stop: () => Promise<void>;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

const collectPaneNodes = (node: TLayoutNode): IPaneNode[] => {
  if (node.type === 'pane') return [node];
  return node.children.flatMap(collectPaneNodes);
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
    PATH: process.env.PATH || process.env.Path,
    HOME: homeDir,
    ...(process.platform === 'win32' ? {
      USERPROFILE: homeDir,
      APPDATA: path.join(homeDir, 'AppData', 'Roaming'),
      LOCALAPPDATA: path.join(homeDir, 'AppData', 'Local'),
    } : {}),
    NEXT_TELEMETRY_DISABLED: '1',
    SHELL: '/bin/sh',
    ...buildRuntimeEnvAlias('CODEXMUX_RUNTIME_V2', '1'),
    ...buildRuntimeEnvAlias('CODEXMUX_RUNTIME_STORAGE_V2_MODE', 'off'),
    ...buildRuntimeEnvAlias('CODEXMUX_RUNTIME_TERMINAL_V2_MODE', 'new-tabs'),

    ...(process.platform === 'win32' ? buildRuntimeEnvAlias('CODEXMUX_RUNTIME_TERMINAL_ADAPTER', 'windows') : {}),
    ...buildRuntimeEnvAlias('CODEXMUX_RUNTIME_TIMELINE_V2_MODE', 'off'),
    ...buildRuntimeEnvAlias('CODEXMUX_RUNTIME_STATUS_V2_MODE', 'off'),
    ...buildRuntimeEnvAlias('CODEXMUX_RUNTIME_DB', dbPath),
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
  await waitFor('runtime v2 storage shadow server startup', async () => {
    if (child.exitCode !== null) {
      throw new Error(`server exited early with ${child.exitCode}: ${output.slice(-1600)}`);
    }
    const res = await fetch(new URL('/api/health', baseUrl)).catch(() => null);
    return res?.ok ? true : null;
  });

  return {
    baseUrl,
    child,
    getOutput: () => output,
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
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const cookie = extractCookieHeader(res);
  if (!cookie) throw new Error('login did not return a session cookie');
  return cookie;
};

const main = async (): Promise<void> => {
  const homeDir = readRuntimeEnvAlias(process.env, 'CODEXMUX_RUNTIME_V2_STORAGE_SHADOW_HOME')
    || await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-runtime-v2-storage-shadow-'));
  const dbPath = path.join(homeDir, 'runtime-v2', 'state.db');
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const port = Number(readRuntimeEnvAlias(process.env, 'CODEXMUX_RUNTIME_V2_STORAGE_SHADOW_PORT') || await getFreePort());
  const checks: string[] = [];
  let server: TServer | null = null;
  let workspaceId: string | null = null;
  let workspaceDeletePath: string | null = null;

  try {
    const fixtureMode = resolveStorageShadowFixtureMode({ platform: process.platform, env: process.env });
    server = await startServer({ homeDir, dbPath, port });
    const cookie = await ensureLoggedIn(server.baseUrl);
    checks.push('cookie-login');

    if (fixtureMode === 'runtime-v2-api') {
      const workspace = await jsonRequest<{ id: string; rootPaneId: string }>(server.baseUrl, '/api/v2/workspaces', cookie, {
        method: 'POST',
        body: JSON.stringify({
          name: 'Runtime v2 Storage Shadow',
          defaultCwd: rootDir,
        }),
      });
      workspaceId = workspace.id;
      workspaceDeletePath = `/api/v2/workspaces/${encodeURIComponent(workspaceId)}`;
      checks.push('v2-workspace-create');

      await jsonRequest(
        server.baseUrl,
        '/api/v2/tabs',
        cookie,
        {
          method: 'POST',
          body: JSON.stringify({
            workspaceId,
            paneId: workspace.rootPaneId,
            cwd: rootDir,
          }),
        },
      );
      checks.push('v2-tab-create');

      const runtimeLayout = await jsonRequest<ILayoutData>(
        server.baseUrl,
        `/api/v2/workspaces/${encodeURIComponent(workspaceId)}/layout`,
        cookie,
      );
      const actualTabs = collectRuntimeStorageShadowTabs({
        workspaceId,
        layout: runtimeLayout,
      });
      if (actualTabs.length < 1) {
        throw new Error(`runtime v2 storage shadow v2 fixture did not create runtime tabs: ${JSON.stringify(runtimeLayout)}`);
      }
      checks.push('v2-layout-read');

      await jsonRequest(server.baseUrl, workspaceDeletePath, cookie, { method: 'DELETE' });
      workspaceId = null;
      workspaceDeletePath = null;
      checks.push('v2-workspace-delete');

      console.log(JSON.stringify({
        ok: true,
        fixtureMode,
        homeDir,
        port,
        actualRuntimeV2Tabs: actualTabs.length,
        checks,
      }, null, 2));
      return;
    }

    const workspace = await jsonRequest<{ id: string }>(server.baseUrl, '/api/workspace', cookie, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Runtime v2 Storage Shadow',
        directory: rootDir,
      }),
    });
    workspaceId = workspace.id;
    workspaceDeletePath = `/api/workspace/${encodeURIComponent(workspaceId)}`;
    checks.push('workspace-create');

    const initialLayout = await jsonRequest<ILayoutData>(
      server.baseUrl,
      `/api/layout?workspace=${encodeURIComponent(workspaceId)}`,
      cookie,
    );
    const pane = collectPaneNodes(initialLayout.root)[0];
    if (!pane) throw new Error('workspace layout did not include a pane');

    await jsonRequest(
      server.baseUrl,
      `/api/layout/pane/${encodeURIComponent(pane.id)}/tabs?workspace=${encodeURIComponent(workspaceId)}`,
      cookie,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Runtime v2 shadow tab',
          cwd: rootDir,
        }),
      },
    );
    checks.push('runtime-v2-tab-create');

    const legacyLayout = await jsonRequest<ILayoutData>(
      server.baseUrl,
      `/api/layout?workspace=${encodeURIComponent(workspaceId)}`,
      cookie,
    );
    const runtimeLayout = await jsonRequest<ILayoutData>(
      server.baseUrl,
      `/api/v2/workspaces/${encodeURIComponent(workspaceId)}/layout`,
      cookie,
    );

    const expectedTabs = collectRuntimeStorageShadowTabs({
      workspaceId,
      layout: legacyLayout,
      runtimeVersion: 2,
    });
    const actualTabs = collectRuntimeStorageShadowTabs({
      workspaceId,
      layout: runtimeLayout,
    });
    const compare = compareRuntimeStorageShadowTabs(expectedTabs, actualTabs);
    if (!compare.ok) {
      throw new Error(`runtime v2 storage shadow mismatch: ${JSON.stringify(compare.mismatches)}`);
    }
    checks.push('shadow-compare');

    await jsonRequest(server.baseUrl, workspaceDeletePath, cookie, { method: 'DELETE' });
    workspaceId = null;
    workspaceDeletePath = null;
    checks.push('workspace-delete');

    console.log(JSON.stringify({
      ok: true,
      fixtureMode,
      homeDir,
      port,
      expectedRuntimeV2Tabs: expectedTabs.length,
      actualRuntimeV2Tabs: actualTabs.length,
      checks,
    }, null, 2));
  } catch (err) {
    if (server) console.error(server.getOutput().slice(-4000));
    throw err;
  } finally {
    if (workspaceId && server) {
      try {
        const cookie = await ensureLoggedIn(server.baseUrl);
        await jsonRequest(
          server.baseUrl,
          workspaceDeletePath ?? `/api/workspace/${encodeURIComponent(workspaceId)}`,
          cookie,
          { method: 'DELETE' },
        );
      } catch {
        // best-effort smoke cleanup
      }
    }
    if (server) await server.stop();
  }
};

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
