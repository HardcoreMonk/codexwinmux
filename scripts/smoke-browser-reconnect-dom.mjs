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
import {
  collectLayoutTabs,
  collectPaneNodes,
  extractCookieHeader,
} from './runtime-v2-phase2-smoke-lib.mjs';
import { writeSmokeArtifact } from './smoke-artifact-lib.mjs';

const PASSWORD = 'browser-reconnect-dom-smoke';
const DEFAULT_TIMEOUT_MS = 30_000;
const SMOKE_NAME = 'browser-reconnect';
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
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${pathname} failed: ${res.status} ${text}`);
  }
  return data;
};

const startServer = async ({ homeDir, port }) => {
  const env = {
    ...process.env,
    HOME: homeDir,
    NEXT_TELEMETRY_DISABLED: '1',
    SHELL: '/bin/sh',
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
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitFor('browser reconnect DOM smoke server startup', async () => {
    if (child.exitCode !== null) throw new Error(`server exited early with ${child.exitCode}: ${output.slice(-1600)}`);
    const res = await fetch(new URL('/api/health', baseUrl)).catch(() => null);
    return res?.ok;
  }, DEFAULT_TIMEOUT_MS);

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

const killTmuxSession = (sessionName) =>
  new Promise((resolve, reject) => {
    const child = spawn('tmux', ['-L', 'codexwinmux', 'kill-session', '-t', sessionName], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tmux kill-session ${sessionName} failed ${code}: ${stderr}`));
    });
  });

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

const runBrowserAssertion = async ({ baseUrl, cookie }) => {
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
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
    await page.getByText('세션을 찾을 수 없습니다').waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS });

    const floatingReconnectCount = await page
      .getByRole('button', { name: '다시 연결' })
      .count();
    if (floatingReconnectCount !== 0) {
      throw new Error(`floating reconnect button should be hidden, found ${floatingReconnectCount}`);
    }

    await page.getByRole('button', { name: '새 터미널로 시작' }).click();
    await page.getByText('세션을 찾을 수 없습니다').waitFor({ state: 'hidden', timeout: DEFAULT_TIMEOUT_MS });

    return {
      consoleEventCount: consoleEvents.length,
      pageUrl: page.url(),
    };
  } finally {
    await browser.close();
  }
};

const main = async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-browser-reconnect-'));
  const port = await getFreePort();
  const createdSessions = [];
  let server = null;

  try {
    server = await startServer({ homeDir, port });
    const { baseUrl } = server;
    const cookie = await ensureLoggedIn(baseUrl);

    const workspace = await jsonRequest(baseUrl, '/api/workspace', cookie, {
      method: 'POST',
      body: JSON.stringify({
        directory: rootDir,
        name: 'Browser reconnect DOM smoke',
      }),
    });
    const layout = await jsonRequest(baseUrl, `/api/layout?workspace=${encodeURIComponent(workspace.id)}`, cookie);
    const pane = collectPaneNodes(layout)[0];
    const tab = collectLayoutTabs(layout)[0];
    if (!pane || !tab?.sessionName) throw new Error('default workspace pane/tab not found');

    createdSessions.push(tab.sessionName);
    await jsonRequest(
      baseUrl,
      `/api/layout/pane/${encodeURIComponent(pane.id)}/tabs/${encodeURIComponent(tab.id)}?workspace=${encodeURIComponent(workspace.id)}`,
      cookie,
      {
        method: 'PATCH',
        body: JSON.stringify({ lastCommand: 'echo reconnect-smoke' }),
      },
    );
    await killTmuxSession(tab.sessionName);

    const browser = await runBrowserAssertion({ baseUrl, cookie });

    const payload = {
      ok: true,
      baseUrl,
      workspaceId: workspace.id,
      tabId: tab.id,
      sessionName: tab.sessionName,
      checks: [
        'session-not-found-overlay-visible',
        'floating-reconnect-hidden',
        'restart-new-terminal-clickable',
      ],
      browser,
    };
    await writeArtifact('passed', payload);
    console.log(JSON.stringify(payload, null, 2));
  } catch (err) {
    await fail('browser-reconnect-dom-smoke-failed', err instanceof Error ? err.message : String(err), {
      serverOutput: server?.getOutput?.().slice(-2000),
    });
  } finally {
    for (const sessionName of createdSessions) {
      await killTmuxSession(sessionName).catch(() => {});
    }
    await server?.stop?.();
    await fs.rm(homeDir, { recursive: true, force: true }).catch(() => {});
  }
};

main();
