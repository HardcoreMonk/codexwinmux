#!/usr/bin/env node
import fs from 'fs/promises';
import net from 'net';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { WebSocket } from 'ws';
import {
  appendRuntimeV2SmokeFrame,
  encodeResize,
  encodeStdin,
} from './runtime-v2-smoke-lib.mjs';
import {
  buildSmokeTerminalWsUrl,
  collectLayoutTabs,
  collectPaneNodes,
  extractCookieHeader,
  resolveSmokeTerminalEndpoint,
} from './runtime-v2-phase2-smoke-lib.mjs';
import { buildEnvAlias } from './env-alias-lib.mjs';

const PASSWORD = 'runtime-v2-phase2-smoke';
const DEFAULT_TIMEOUT_MS = 20_000;
const rootDir = process.cwd();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  let lastError;
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

const jsonRequest = async (baseUrl, pathname, cookie, init = {}) => {
  const headers = {
    ...(cookie ? { Cookie: cookie } : {}),
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers ?? {}),
  };
  let res;
  try {
    res = await fetch(new URL(pathname, baseUrl), {
      ...init,
      headers,
    });
  } catch (err) {
    throw new Error(`${init.method ?? 'GET'} ${pathname} fetch failed: ${err instanceof Error ? err.message : err}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${pathname} failed: ${res.status} ${text}`);
  }
  return data;
};

const startServer = async ({ homeDir, dbPath, port, terminalMode }) => {
  const env = {
    ...process.env,
    HOME: homeDir,
    SHELL: '/bin/sh',
    ...buildEnvAlias('CODEXMUX_RUNTIME_V2', '1'),
    ...buildEnvAlias('CODEXMUX_RUNTIME_TERMINAL_V2_MODE', terminalMode),
    ...buildEnvAlias('CODEXMUX_RUNTIME_DB', dbPath),
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
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitFor(`server ${terminalMode} startup`, async () => {
    if (child.exitCode !== null) {
      throw new Error(`server exited early with ${child.exitCode}: ${output.slice(-1000)}`);
    }
    let res;
    try {
      res = await fetch(new URL('/api/health', baseUrl));
    } catch {
      return false;
    }
    if (child.exitCode !== null) {
      throw new Error(`server exited early with ${child.exitCode}: ${output.slice(-1000)}`);
    }
    return res.ok;
  });

  return {
    baseUrl,
    child,
    getOutput: () => output,
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill('SIGINT');
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
  const setup = await waitFor('auth setup', () =>
    jsonRequest(baseUrl, '/api/auth/setup', '').catch(() => null));
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

  const res = await waitFor('auth login', async () => {
    try {
      return await fetch(new URL('/api/auth/login', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: PASSWORD }),
      });
    } catch {
      return null;
    }
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const cookie = extractCookieHeader(res);
  if (!cookie) throw new Error('login did not return a session cookie');
  return cookie;
};

const findTab = (layout, predicate) => {
  const tab = collectLayoutTabs(layout).find(predicate);
  if (!tab) throw new Error('expected tab was not found in layout');
  return tab;
};

const attachAndAssertOutput = ({ baseUrl, cookie, tab, label }) =>
  new Promise((resolve, reject) => {
    const endpoint = resolveSmokeTerminalEndpoint(tab);
    const marker = `phase2-${label}-${Date.now()}`;
    let output = '';
    let settled = false;
    let markerInterval = null;
    let markerSends = 0;
    const ws = new WebSocket(buildSmokeTerminalWsUrl({
      baseUrl,
      endpoint,
      sessionName: tab.sessionName,
      clientId: `phase2-${label}`,
      cols: 100,
      rows: 30,
    }), { headers: { Cookie: cookie } });

    const timer = setTimeout(() => {
      settled = true;
      void (async () => {
        let diagnostics = '';
        try {
          const res = await fetch(new URL('/api/debug/perf', baseUrl), {
            headers: { Cookie: cookie },
            signal: AbortSignal.timeout(2000),
          });
          diagnostics = JSON.stringify((await res.json())?.services?.runtimeWorkers ?? null);
        } catch (err) {
          diagnostics = `diagnostics unavailable: ${err instanceof Error ? err.message : err}`;
        }
        ws.close();
        reject(new Error(`${label} timed out waiting for ${marker}; marker sends=${markerSends}; ws state=${ws.readyState}; diagnostics=${diagnostics}; got ${JSON.stringify(output.slice(-200))}`));
      })();
    }, DEFAULT_TIMEOUT_MS);

    const finish = () => {
      if (settled || !output.includes(marker)) return;
      settled = true;
      clearTimeout(timer);
      if (markerInterval) clearInterval(markerInterval);
      setTimeout(() => {
        ws.close();
        resolve({ endpoint, marker });
      }, 500);
    };

    const sendMarker = () => {
      if (ws.readyState === WebSocket.OPEN) {
        markerSends += 1;
        ws.send(encodeStdin(`printf '%s\\n' '${marker}'\r`));
      }
    };

    ws.on('open', () => {
      ws.send(encodeResize(100, 30));
      setTimeout(() => {
        sendMarker();
        markerInterval = setInterval(sendMarker, 500);
      }, 100);
    });
    ws.on('message', (data) => {
      output = appendRuntimeV2SmokeFrame(output, data);
      finish();
    });
    ws.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (markerInterval) clearInterval(markerInterval);
      reject(err);
    });
    ws.on('close', (code, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (markerInterval) clearInterval(markerInterval);
      reject(new Error(`${label} closed before output: ${code} ${reason.toString()}; got ${JSON.stringify(output.slice(-200))}`));
    });
  });

const main = async () => {
  const homeDir = process.env.CODEXMUX_PHASE2_SMOKE_HOME
    || await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-runtime-v2-phase2-gate-'));
  const dbPath = path.join(homeDir, 'runtime-v2', 'state.db');
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const port = Number(process.env.CODEXMUX_PHASE2_SMOKE_PORT || await getFreePort());
  const checks = [];
  let server = null;
  let workspaceId = null;

  try {
    server = await startServer({ homeDir, dbPath, port, terminalMode: 'new-tabs' });
    let cookie = await ensureLoggedIn(server.baseUrl);
    checks.push('cookie-login');

    const workspace = await jsonRequest(server.baseUrl, '/api/workspace', cookie, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Runtime v2 Phase 2 Gate',
        directory: rootDir,
      }),
    });
    workspaceId = workspace.id;
    checks.push('workspace-create');

    let layout = await jsonRequest(server.baseUrl, `/api/layout?workspace=${encodeURIComponent(workspaceId)}`, cookie);
    const pane = collectPaneNodes(layout)[0];
    if (!pane) throw new Error('workspace layout did not include a pane');
    const legacyTab = findTab(layout, (tab) => tab.runtimeVersion !== 2);
    if (resolveSmokeTerminalEndpoint(legacyTab) !== '/api/terminal') {
      throw new Error('default workspace tab did not resolve to legacy terminal endpoint');
    }
    await attachAndAssertOutput({ baseUrl: server.baseUrl, cookie, tab: legacyTab, label: 'legacy-initial' });
    checks.push('legacy-route-initial');

    const runtimeTab = await jsonRequest(
      server.baseUrl,
      `/api/layout/pane/${encodeURIComponent(pane.id)}/tabs?workspace=${encodeURIComponent(workspaceId)}`,
      cookie,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Runtime v2',
          cwd: rootDir,
        }),
      },
    );
    if (runtimeTab.runtimeVersion !== 2 || resolveSmokeTerminalEndpoint(runtimeTab) !== '/api/v2/terminal') {
      throw new Error(`plain new tab did not route to runtime v2: ${JSON.stringify(runtimeTab)}`);
    }
    await attachAndAssertOutput({ baseUrl: server.baseUrl, cookie, tab: runtimeTab, label: 'v2-initial' });
    checks.push('new-tab-v2-route');

    layout = await jsonRequest(server.baseUrl, `/api/layout?workspace=${encodeURIComponent(workspaceId)}`, cookie);
    const reloadedRuntimeTab = findTab(layout, (tab) => tab.id === runtimeTab.id && tab.runtimeVersion === 2);
    await attachAndAssertOutput({ baseUrl: server.baseUrl, cookie, tab: reloadedRuntimeTab, label: 'v2-browser-reload' });
    checks.push('browser-reload-v2-reattach');

    await server.stop();
    server = await startServer({ homeDir, dbPath, port, terminalMode: 'new-tabs' });
    cookie = await ensureLoggedIn(server.baseUrl);
    layout = await jsonRequest(server.baseUrl, `/api/layout?workspace=${encodeURIComponent(workspaceId)}`, cookie);
    const restartedLegacyTab = findTab(layout, (tab) => tab.id === legacyTab.id);
    const restartedRuntimeTab = findTab(layout, (tab) => tab.id === runtimeTab.id && tab.runtimeVersion === 2);
    await attachAndAssertOutput({ baseUrl: server.baseUrl, cookie, tab: restartedLegacyTab, label: 'legacy-server-restart' });
    await attachAndAssertOutput({ baseUrl: server.baseUrl, cookie, tab: restartedRuntimeTab, label: 'v2-server-restart' });
    checks.push('server-restart-legacy-route');
    checks.push('server-restart-v2-reattach');

    await server.stop();
    server = await startServer({ homeDir, dbPath, port, terminalMode: 'off' });
    cookie = await ensureLoggedIn(server.baseUrl);
    const health = await jsonRequest(server.baseUrl, '/api/v2/runtime/health', cookie);
    if (health.terminalV2Mode !== 'off') {
      throw new Error(`runtime health did not expose terminal mode off: ${JSON.stringify(health)}`);
    }
    checks.push('terminal-mode-off-health');

    layout = await jsonRequest(server.baseUrl, `/api/layout?workspace=${encodeURIComponent(workspaceId)}`, cookie);
    const offPane = collectPaneNodes(layout)[0];
    const offModeTab = await jsonRequest(
      server.baseUrl,
      `/api/layout/pane/${encodeURIComponent(offPane.id)}/tabs?workspace=${encodeURIComponent(workspaceId)}`,
      cookie,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Rollback legacy',
          cwd: rootDir,
        }),
      },
    );
    if (offModeTab.runtimeVersion === 2 || resolveSmokeTerminalEndpoint(offModeTab) !== '/api/terminal') {
      throw new Error(`terminal mode off created a v2 tab: ${JSON.stringify(offModeTab)}`);
    }
    await attachAndAssertOutput({ baseUrl: server.baseUrl, cookie, tab: offModeTab, label: 'terminal-mode-off-legacy' });
    checks.push('terminal-mode-off-new-tab-legacy');

    await jsonRequest(server.baseUrl, `/api/workspace/${encodeURIComponent(workspaceId)}`, cookie, { method: 'DELETE' });
    workspaceId = null;
    checks.push('workspace-delete');

    console.log(JSON.stringify({
      ok: true,
      homeDir,
      port,
      checks,
    }, null, 2));
  } catch (err) {
    if (server) {
      console.error(server.getOutput().slice(-4000));
    }
    throw err;
  } finally {
    if (workspaceId && server) {
      try {
        const cleanupCookie = await ensureLoggedIn(server.baseUrl);
        await jsonRequest(server.baseUrl, `/api/workspace/${encodeURIComponent(workspaceId)}`, cleanupCookie, { method: 'DELETE' });
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
