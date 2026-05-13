#!/usr/bin/env node
import fs from 'fs/promises';
import net from 'net';
import os from 'os';
import path from 'path';
import { spawn, execFileSync } from 'child_process';
import { WebSocket } from 'ws';
import { extractCookieHeader } from './runtime-v2-phase2-smoke-lib.mjs';
import {
  buildPermissionPromptCommand,
  buildStatusWsUrl,
  extractSelectedMarker,
} from './permission-prompt-smoke-lib.mjs';

const PASSWORD = 'permission-prompt-smoke';
const DEFAULT_TIMEOUT_MS = 20_000;
const TMUX_SOCKET = 'codexwinmux';
const MARKER = 'CODEXMUX_PERMISSION_SMOKE_SELECTED';
const rootDir = process.cwd();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fail = (code, message, details = {}) => {
  console.error(JSON.stringify({ ok: false, code, message, ...details }, null, 2));
  process.exit(1);
};

const getFreePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });

const waitFor = async (label, fn, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
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

const runTmux = (args, options = {}) => {
  try {
    return execFileSync('tmux', ['-L', TMUX_SOCKET, ...args], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeoutMs ?? 5_000,
      maxBuffer: 5 * 1024 * 1024,
    }).trim();
  } catch (err) {
    if (options.allowFailure) return err.stdout?.toString?.().trim?.() ?? '';
    throw new Error(`tmux ${args.join(' ')} failed: ${err.stderr?.toString?.() || err.stdout?.toString?.() || err.message}`);
  }
};

const capturePane = (session) =>
  runTmux(['capture-pane', '-p', '-S', '-100', '-t', session], { allowFailure: true });

const collectPaneNodes = (layout) => {
  const panes = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'pane') {
      panes.push(node);
      return;
    }
    if (node.type === 'split' && Array.isArray(node.children)) node.children.forEach(visit);
  };
  visit(layout?.root);
  return panes;
};

const jsonRequest = async (baseUrl, pathname, cookie, init = {}) => {
  const headers = {
    ...(cookie ? { Cookie: cookie } : {}),
    ...(init.token ? { 'x-cmux-token': init.token } : {}),
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

const startServer = async ({ homeDir, port }) => {
  const env = {
    ...process.env,
    PATH: process.env.PATH || process.env.Path,
    HOME: homeDir,
    ...(process.platform === 'win32' ? {
      USERPROFILE: homeDir,
      APPDATA: path.join(homeDir, 'AppData', 'Roaming'),
      LOCALAPPDATA: path.join(homeDir, 'AppData', 'Local'),
    } : {}),
    SHELL: '/bin/bash',
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
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitFor('permission smoke server startup', async () => {
    if (child.exitCode !== null) throw new Error(`server exited early with ${child.exitCode}: ${output.slice(-1200)}`);
    const res = await fetch(new URL('/api/health', baseUrl)).catch(() => null);
    return res?.ok;
  }, 30_000);

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
          child.kill('SIGTERM');
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

const connectStatus = (baseUrl, cookie) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(buildStatusWsUrl(baseUrl), { headers: { Cookie: cookie } });
    const messages = [];
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('status websocket open timed out'));
    }, 8_000);

    ws.on('open', () => {
      clearTimeout(timer);
      resolve({
        ws,
        messages,
        waitForTabState: (tabId, state, timeoutMs = DEFAULT_TIMEOUT_MS) =>
          waitFor(`status ${tabId} ${state}`, () => {
            for (let i = messages.length - 1; i >= 0; i -= 1) {
              const msg = messages[i];
              if (msg.type === 'status:update' && msg.tabId === tabId && msg.cliState === state) return msg;
              if (msg.type === 'status:sync' && msg.tabs?.[tabId]?.cliState === state) {
                return { tabId, ...msg.tabs[tabId] };
              }
            }
            return null;
          }, timeoutMs),
      });
    });
    ws.on('message', (raw) => {
      try {
        messages.push(JSON.parse(raw.toString()));
      } catch {
        // ignore invalid status smoke frames
      }
    });
    ws.on('error', reject);
  });

const main = async () => {
  const homeDir = process.env.CODEXMUX_PERMISSION_SMOKE_HOME
    || await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-permission-smoke-'));
  const port = Number(process.env.CODEXMUX_PERMISSION_SMOKE_PORT || await getFreePort());
  const checks = [];
  let server = null;
  let status = null;
  let workspaceId = null;
  let sessionName = null;

  try {
    server = await startServer({ homeDir, port });
    const cookie = await ensureLoggedIn(server.baseUrl);
    const tokenPath = path.join(homeDir, '.codexwinmux', 'cli-token');
    const token = (await fs.readFile(tokenPath, 'utf8')).trim();
    checks.push('server-login');

    const expectedStatusMode = process.env.CODEXMUX_PERMISSION_SMOKE_EXPECT_STATUS_MODE;
    if (expectedStatusMode) {
      const runtimeHealth = await jsonRequest(server.baseUrl, '/api/v2/runtime/health', cookie);
      if (runtimeHealth.statusV2Mode !== expectedStatusMode) {
        throw new Error(`expected statusV2Mode=${expectedStatusMode}, got ${runtimeHealth.statusV2Mode}`);
      }
      checks.push(`status-mode-${expectedStatusMode}`);
    }

    const workspace = await jsonRequest(server.baseUrl, '/api/workspace', cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'Permission Prompt Smoke', directory: rootDir }),
    });
    workspaceId = workspace.id;
    checks.push('workspace-create');

    const layout = await jsonRequest(server.baseUrl, `/api/layout?workspace=${encodeURIComponent(workspaceId)}`, cookie);
    const pane = collectPaneNodes(layout)[0];
    const tab = pane?.tabs?.[0];
    if (!pane || !tab?.sessionName || !tab?.id) throw new Error('workspace layout did not include a default terminal tab');
    sessionName = tab.sessionName;
    checks.push('layout-read');

    const command = buildPermissionPromptCommand({
      marker: MARKER,
      prompt: 'Do you want to proceed?',
      options: ['Yes', 'No'],
    });
    runTmux(['send-keys', '-t', sessionName, 'C-c'], { allowFailure: true });
    runTmux(['send-keys', '-t', sessionName, command, 'Enter']);
    checks.push('prompt-started');

    status = await connectStatus(server.baseUrl, cookie);
    await jsonRequest(server.baseUrl, '/api/status/hook', '', {
      token,
      method: 'POST',
      body: JSON.stringify({
        event: 'notification',
        session: sessionName,
        notificationType: 'permission_prompt',
      }),
    });
    const needsInput = await status.waitForTabState(tab.id, 'needs-input');
    const eventSeq = needsInput.lastEvent?.seq ?? needsInput.eventSeq;
    if (typeof eventSeq !== 'number') throw new Error(`needs-input update did not include event seq: ${JSON.stringify(needsInput)}`);
    checks.push('status-needs-input');

    const permission = await waitFor('permission options', async () => {
      const data = await jsonRequest(
        server.baseUrl,
        `/api/tmux/permission-options?session=${encodeURIComponent(sessionName)}`,
        cookie,
      );
      return Array.isArray(data.options) && data.options.length >= 2 ? data : null;
    });
    if (permission.options[0] !== '1. Yes' || permission.options[1] !== '2. No') {
      throw new Error(`unexpected permission options: ${JSON.stringify(permission.options)}`);
    }
    checks.push('permission-options');

    await jsonRequest(server.baseUrl, '/api/tmux/send-input', cookie, {
      method: 'POST',
      body: JSON.stringify({ session: sessionName, input: '2' }),
    });
    const selected = await waitFor('permission selected marker', () => {
      const content = capturePane(sessionName);
      return extractSelectedMarker(content, MARKER);
    });
    if (selected !== '2') throw new Error(`expected selected marker 2, got ${selected}`);
    checks.push('selection-stdin');

    status.ws.send(JSON.stringify({ type: 'status:ack-notification', tabId: tab.id, seq: eventSeq }));
    await status.waitForTabState(tab.id, 'busy');
    checks.push('status-ack-busy');

    await jsonRequest(server.baseUrl, `/api/workspace/${encodeURIComponent(workspaceId)}`, cookie, { method: 'DELETE' });
    workspaceId = null;
    checks.push('workspace-delete');

    console.log(JSON.stringify({
      ok: true,
      homeDir,
      port,
      workspaceId: workspace.id,
      tabId: tab.id,
      sessionName,
      options: permission.options,
      selected,
      checks,
    }, null, 2));
  } catch (err) {
    if (server) console.error(server.getOutput().slice(-4000));
    fail('permission-prompt-smoke-failed', err instanceof Error ? err.message : String(err), {
      homeDir,
      port,
      workspaceId,
      sessionName,
      checks,
    });
  } finally {
    if (status?.ws) status.ws.close();
    if (workspaceId && server) {
      try {
        const cookie = await ensureLoggedIn(server.baseUrl);
        await jsonRequest(server.baseUrl, `/api/workspace/${encodeURIComponent(workspaceId)}`, cookie, { method: 'DELETE' });
      } catch {
        // best-effort cleanup
      }
    }
    if (sessionName) runTmux(['kill-session', '-t', sessionName], { allowFailure: true });
    if (server) await server.stop();
  }
};

main();
