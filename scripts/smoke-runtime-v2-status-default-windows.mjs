#!/usr/bin/env node
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { WebSocket } from 'ws';
import { getFreePort, waitFor } from './android-webview-smoke-lib.mjs';
import { collectPaneNodes, extractCookieHeader } from './runtime-v2-phase2-smoke-lib.mjs';
import { buildEnvAlias, readEnvAlias, stripLegacyRuntimeEnv } from './env-alias-lib.mjs';
import { stopChildProcessTree } from './electron-smoke-lib.mjs';
import { buildTsxServerInvocation } from './server-smoke-process-lib.mjs';
import { buildStatusWsUrl } from './permission-prompt-smoke-lib.mjs';

const PASSWORD = 'runtime-v2-status-default-windows-smoke';
const DEFAULT_TIMEOUT_MS = Number(
  readEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_V2_STATUS_DEFAULT_TIMEOUT_MS') || 30_000,
);
const rootDir = process.cwd();

const fail = (code, message, details = {}) => {
  console.error(JSON.stringify({ ok: false, code, message, ...details }, null, 2));
  process.exit(1);
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

const startServer = async ({ homeDir, dbPath, port }) => {
  const env = {
    ...stripLegacyRuntimeEnv(process.env),
    PATH: process.env.PATH || process.env.Path,
    HOME: homeDir,
    USERPROFILE: homeDir,
    APPDATA: path.join(homeDir, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(homeDir, 'AppData', 'Local'),
    NEXT_TELEMETRY_DISABLED: '1',
    SHELL: '/bin/sh',
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_V2', '1'),
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_STORAGE_V2_MODE', 'default'),
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE', 'new-tabs'),
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_STATUS_V2_MODE', 'default'),
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE', 'off'),
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER', 'windows'),
    ...buildEnvAlias('CODEXWINMUX_RUNTIME_DB', dbPath),
    PORT: String(port),
  };
  delete env.__CMUX_PRISTINE_ENV;
  env.__CMUX_PRISTINE_ENV = JSON.stringify(env);

  const invocation = buildTsxServerInvocation({ rootDir });
  const child = spawn(invocation.command, invocation.args, {
    cwd: rootDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitFor('runtime v2 status default Windows server startup', async () => {
    if (child.exitCode !== null) throw new Error(`server exited early with ${child.exitCode}: ${output.slice(-1600)}`);
    const res = await fetch(new URL('/api/health', baseUrl)).catch(() => null);
    return res?.ok;
  }, DEFAULT_TIMEOUT_MS);

  return {
    baseUrl,
    getOutput: () => output,
    stop: async () => {
      if (child.exitCode !== null) return;
      await stopChildProcessTree(child, { timeoutMs: 10_000 });
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

    const findTabMessage = (tabId, predicate = () => true) => {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const msg = messages[i];
        if (msg.type === 'status:update' && msg.tabId === tabId && predicate(msg)) return msg;
        if (msg.type === 'status:sync' && msg.tabs?.[tabId] && predicate(msg.tabs[tabId])) {
          return { tabId, ...msg.tabs[tabId] };
        }
      }
      return null;
    };

    ws.on('open', () => {
      clearTimeout(timer);
      resolve({
        ws,
        messages,
        waitForTab: (tabId) =>
          waitFor(`status ${tabId} sync`, () => findTabMessage(tabId), DEFAULT_TIMEOUT_MS),
        waitForTabState: (tabId, state) =>
          waitFor(`status ${tabId} ${state}`, () =>
            findTabMessage(tabId, (message) => message.cliState === state), DEFAULT_TIMEOUT_MS),
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
  const homeDir = readEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_V2_STATUS_DEFAULT_HOME')
    || await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-runtime-v2-status-default-windows-'));
  const dbPath = path.join(homeDir, 'runtime-v2', 'state.db');
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const port = Number(readEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_V2_STATUS_DEFAULT_PORT') || await getFreePort());
  const checks = [];
  let server = null;
  let status = null;
  let workspaceId = null;

  try {
    server = await startServer({ homeDir, dbPath, port });
    const cookie = await ensureLoggedIn(server.baseUrl);
    const tokenPath = path.join(homeDir, '.codexwinmux', 'cli-token');
    const token = (await fs.readFile(tokenPath, 'utf8')).trim();
    checks.push('server-login');

    const runtimeHealth = await jsonRequest(server.baseUrl, '/api/v2/runtime/health', cookie);
    if (runtimeHealth.statusV2Mode !== 'default' || runtimeHealth.status?.ok !== true) {
      throw new Error('runtime health did not report status default mode');
    }
    checks.push('runtime-health-default');

    status = await connectStatus(server.baseUrl, cookie);
    checks.push('status-ws-open');

    const workspace = await jsonRequest(server.baseUrl, '/api/workspace', cookie, {
      method: 'POST',
      body: JSON.stringify({
        name: `Status Default Runtime ${Date.now()}`,
        directory: rootDir,
      }),
    });
    workspaceId = workspace.id;
    const layout = await jsonRequest(server.baseUrl, `/api/layout?workspace=${encodeURIComponent(workspaceId)}`, cookie);
    const pane = collectPaneNodes(layout)[0];
    const tab = pane?.tabs?.[0];
    if (!tab?.id || !tab.sessionName) throw new Error('runtime workspace did not include a terminal tab');
    checks.push('windows-runtime-tab');

    await status.waitForTab(tab.id);
    checks.push('status-tab-sync');

    await jsonRequest(server.baseUrl, '/api/status/hook', '', {
      token,
      method: 'POST',
      body: JSON.stringify({
        event: 'notification',
        session: tab.sessionName,
        notificationType: 'permission_prompt',
      }),
    });
    const needsInput = await status.waitForTabState(tab.id, 'needs-input');
    const eventSeq = needsInput.lastEvent?.seq ?? needsInput.eventSeq;
    if (typeof eventSeq !== 'number') throw new Error(`needs-input update did not include event seq: ${JSON.stringify(needsInput)}`);
    checks.push('status-needs-input');

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
      sessionName: tab.sessionName,
      statusV2Mode: runtimeHealth.statusV2Mode,
      checks,
    }, null, 2));
  } catch (err) {
    if (server) console.error(server.getOutput().slice(-4000));
    fail('runtime-v2-status-default-windows-smoke-failed', err instanceof Error ? err.message : String(err), {
      homeDir,
      port,
      workspaceId,
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
    if (server) await server.stop();
  }
};

main();
