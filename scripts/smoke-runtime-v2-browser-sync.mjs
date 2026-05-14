#!/usr/bin/env node
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { chromium } from '@playwright/test';
import {
  getFreePort,
  sleep,
  waitFor,
} from './android-webview-smoke-lib.mjs';
import { extractCookieHeader } from './runtime-v2-phase2-smoke-lib.mjs';
import { buildEnvAlias, stripLegacyRuntimeEnv } from './env-alias-lib.mjs';
import { writeSmokeArtifact } from './smoke-artifact-lib.mjs';
import {
  buildInstallBrowserSyncProbeScript,
  buildReadBrowserSyncProbeEventScript,
  buildReadBrowserSyncProbeReadyScript,
  normalizeBrowserSyncSmokeTimeoutMs,
} from './browser-sync-smoke-lib.mjs';

const PASSWORD = 'runtime-v2-browser-sync-smoke';
const SMOKE_NAME = 'runtime-v2-browser-sync';
const rootDir = process.cwd();
const startedAt = new Date().toISOString();

const writeArtifact = async (status, payload) =>
  writeSmokeArtifact({
    smokeName: SMOKE_NAME,
    status,
    startedAt,
    payload,
  }).catch((err) => {
    console.error(JSON.stringify({
      ok: false,
      code: 'smoke-artifact-write-failed',
      message: err instanceof Error ? err.message : String(err),
    }, null, 2));
  });

const fail = async (code, message, details = {}) => {
  const payload = { ok: false, code, message, ...details };
  await writeArtifact('failed', payload);
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
};

const jsonRequest = async (baseUrl, pathname, cookie, init = {}) => {
  const headers = {
    ...(cookie ? { Cookie: cookie } : {}),
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers ?? {}),
  };
  const res = await fetch(new URL(pathname, baseUrl), { ...init, headers });
  if (res.status === 204) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${pathname} failed: ${res.status} ${text}`);
  return data;
};

const startServer = async ({ homeDir, dbPath, port, timeoutMs }) => {
  const env = {
    ...stripLegacyRuntimeEnv(process.env),
    PATH: process.env.PATH || process.env.Path,
    HOME: homeDir,
    ...(process.platform === 'win32' ? {
      USERPROFILE: homeDir,
      APPDATA: path.join(homeDir, 'AppData', 'Roaming'),
      LOCALAPPDATA: path.join(homeDir, 'AppData', 'Local'),
    } : {}),
    NEXT_TELEMETRY_DISABLED: '1',
    SHELL: '/bin/sh',
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_V2', '1'),
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE', 'new-tabs'),
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_STORAGE_V2_MODE', 'default'),
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE', 'default'),
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_STATUS_V2_MODE', 'default'),
    ...(process.platform === 'win32' ? buildEnvAlias('CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER', 'windows') : {}),
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_DB', dbPath),
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
    },
  );

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitFor('runtime v2 browser sync smoke server startup', async () => {
    if (child.exitCode !== null) throw new Error(`server exited early with ${child.exitCode}: ${output.slice(-1600)}`);
    const res = await fetch(new URL('/api/health', baseUrl)).catch(() => null);
    return res?.ok;
  }, timeoutMs);

  return {
    baseUrl,
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

const ensureLoggedIn = async (baseUrl) => {
  const setup = await jsonRequest(baseUrl, '/api/auth/setup', '');
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

const addSessionCookie = async (context, baseUrl, cookie) => {
  const [pair] = cookie.split(';');
  const separator = pair.indexOf('=');
  const name = pair.slice(0, separator);
  const value = pair.slice(separator + 1);
  await context.addCookies([{
    name,
    value,
    url: baseUrl,
  }]);
};

const runBrowserAssertion = async ({ baseUrl, cookie, workspaceName, timeoutMs }) => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  await addSessionCookie(context, baseUrl, cookie);
  const page = await context.newPage();
  const consoleEvents = [];
  page.on('console', (msg) => {
    consoleEvents.push({ type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', (err) => {
    consoleEvents.push({ type: 'error', text: err.message });
  });

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.evaluate(buildInstallBrowserSyncProbeScript({
      expectedType: 'workspace',
      timeoutMs,
    }));
    await page.evaluate(buildReadBrowserSyncProbeReadyScript());

    return {
      page,
      browser,
      finish: async () => {
        const syncEvent = await page.evaluate(buildReadBrowserSyncProbeEventScript());
        await page.getByText(workspaceName, { exact: true }).waitFor({ state: 'visible', timeout: timeoutMs });
        return {
          syncEvent,
          consoleEventCount: consoleEvents.length,
          pageUrl: page.url(),
        };
      },
    };
  } catch (err) {
    await browser.close().catch(() => undefined);
    throw err;
  }
};

const main = async () => {
  const timeoutMs = normalizeBrowserSyncSmokeTimeoutMs(process.env.CODEXWINMUX_BROWSER_SYNC_SMOKE_TIMEOUT_MS);
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-runtime-v2-browser-sync-'));
  const dbPath = path.join(homeDir, 'runtime-v2', 'state.db');
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const port = await getFreePort();
  const createdWorkspaceIds = [];
  let server = null;
  let assertion = null;

  try {
    server = await startServer({ homeDir, dbPath, port, timeoutMs });
    const { baseUrl } = server;
    const cookie = await ensureLoggedIn(baseUrl);

    const initial = await jsonRequest(baseUrl, '/api/v2/workspaces', cookie, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Browser Sync Initial',
        defaultCwd: rootDir,
      }),
    });
    createdWorkspaceIds.push(initial.id);

    const workspaceName = `Browser Sync ${Date.now()}`;
    assertion = await runBrowserAssertion({
      baseUrl,
      cookie,
      workspaceName,
      timeoutMs,
    });

    const created = await jsonRequest(baseUrl, '/api/v2/workspaces', cookie, {
      method: 'POST',
      body: JSON.stringify({
        name: workspaceName,
        defaultCwd: rootDir,
      }),
    });
    createdWorkspaceIds.push(created.id);

    const browser = await assertion.finish();
    const payload = {
      ok: true,
      baseUrl,
      workspaceId: created.id,
      workspaceName,
      checks: [
        'browser-sync-websocket-workspace-event',
        'browser-workspace-list-updated',
        'runtime-v2-storage-default-no-tmux-kill',
      ],
      browser,
    };
    await writeArtifact('passed', payload);
    console.log(JSON.stringify(payload, null, 2));
  } catch (err) {
    await fail('runtime-v2-browser-sync-smoke-failed', err instanceof Error ? err.message : String(err), {
      serverOutput: server?.getOutput?.().slice(-2000),
    });
  } finally {
    await assertion?.browser?.close?.().catch(() => undefined);
    if (server) {
      const baseUrl = `http://127.0.0.1:${port}`;
      const cookie = await ensureLoggedIn(baseUrl).catch(() => null);
      if (cookie) {
        for (const workspaceId of createdWorkspaceIds.reverse()) {
          await jsonRequest(baseUrl, `/api/v2/workspaces/${encodeURIComponent(workspaceId)}`, cookie, { method: 'DELETE' })
            .catch(() => undefined);
        }
      }
    }
    await server?.stop?.();
    await fs.rm(homeDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

main();
