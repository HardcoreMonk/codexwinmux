#!/usr/bin/env node
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { chromium } from '@playwright/test';
import {
  getFreePort,
  waitFor,
} from './android-webview-smoke-lib.mjs';
import {
  collectPaneNodes,
  extractCookieHeader,
} from './runtime-v2-phase2-smoke-lib.mjs';
import { buildEnvAlias, stripLegacyRuntimeEnv } from './env-alias-lib.mjs';
import { writeSmokeArtifact } from './smoke-artifact-lib.mjs';
import { stopChildProcessTree } from './electron-smoke-lib.mjs';
import { buildTsxServerInvocation } from './server-smoke-process-lib.mjs';
import {
  buildDispatchNativeAppStateScript,
  buildInstallStatusTimelineStaleUiProbeScript,
  buildReadStatusTimelineStaleUiProbeScript,
  normalizeStatusTimelineStaleUiSmokeTimeoutMs,
} from './status-timeline-stale-ui-smoke-lib.mjs';

const PASSWORD = 'runtime-v2-status-timeline-stale-ui-smoke';
const SMOKE_NAME = 'runtime-v2-status-timeline-stale-ui';
const SESSION_ID = '55555555-5555-4555-8555-555555555555';
const rootDir = process.cwd();
const startedAt = new Date().toISOString();

const line = (value) => JSON.stringify(value);

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
  await waitFor('runtime v2 status/timeline stale UI server startup', async () => {
    if (child.exitCode !== null) throw new Error(`server exited early with ${child.exitCode}: ${output.slice(-1600)}`);
    const res = await fetch(new URL('/api/health', baseUrl)).catch(() => null);
    return res?.ok;
  }, timeoutMs);

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

const addSessionCookie = async (context, baseUrl, cookie) => {
  const [pair] = cookie.split(';');
  const separator = pair.indexOf('=');
  await context.addCookies([{
    name: pair.slice(0, separator),
    value: pair.slice(separator + 1),
    url: baseUrl,
  }]);
};

const prepareFixturePath = async (homeDir) => {
  const dir = path.join(homeDir, '.codex', 'sessions', '2026', '05', '15');
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, `${SESSION_ID}.jsonl`);
};

const writeFixture = async ({ homeDir, jsonlPath, initialUserMessage, initialAssistantMessage }) => {
  const now = new Date().toISOString();
  const content = [
    line({
      type: 'session_meta',
      timestamp: now,
      payload: {
        id: SESSION_ID,
        cwd: homeDir,
        timestamp: now,
      },
    }),
    line({
      type: 'event_msg',
      timestamp: '2026-05-15T01:00:00.000Z',
      payload: { type: 'user_message', message: initialUserMessage },
    }),
    line({
      type: 'event_msg',
      timestamp: '2026-05-15T01:00:01.000Z',
      payload: { type: 'agent_message', message: initialAssistantMessage },
    }),
  ].join('\n');
  await fs.writeFile(jsonlPath, `${content}\n`, 'utf-8');
};

const appendTimelineEntry = async ({ jsonlPath, appendedUserMessage }) => {
  await fs.appendFile(jsonlPath, `${line({
    type: 'event_msg',
    timestamp: '2026-05-15T01:00:02.000Z',
    payload: { type: 'user_message', message: appendedUserMessage },
  })}\n`, 'utf-8');
};

const createRuntimeAgentWorkspace = async ({ baseUrl, cookie, workspaceName, cwd }) => {
  const workspace = await jsonRequest(baseUrl, '/api/workspace', cookie, {
    method: 'POST',
    body: JSON.stringify({
      name: workspaceName,
      directory: cwd,
    }),
  });
  const layout = await jsonRequest(baseUrl, `/api/layout?workspace=${encodeURIComponent(workspace.id)}`, cookie);
  const pane = collectPaneNodes(layout)[0];
  const tab = pane?.tabs?.[0];
  if (!pane?.id || !tab?.id || !tab.sessionName) {
    throw new Error('runtime workspace did not include a terminal tab');
  }

  await jsonRequest(
    baseUrl,
    `/api/layout/pane/${encodeURIComponent(pane.id)}/tabs/${encodeURIComponent(tab.id)}?workspace=${encodeURIComponent(workspace.id)}`,
    cookie,
    {
      method: 'PATCH',
      body: JSON.stringify({
        panelType: 'codex',
        terminalCollapsed: true,
      }),
    },
  );

  return {
    workspaceId: workspace.id,
    paneId: pane.id,
    tabId: tab.id,
    sessionName: tab.sessionName,
  };
};

const openBrowser = async ({ baseUrl, cookie, timeoutMs }) => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  await context.addInitScript(buildInstallStatusTimelineStaleUiProbeScript());
  await addSessionCookie(context, baseUrl, cookie);
  const page = await context.newPage();
  const consoleEvents = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleEvents.push({ type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', (err) => {
    consoleEvents.push({ type: 'pageerror', text: err.message });
  });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  return { browser, page, consoleEvents };
};

const waitForBodyText = async (page, label, predicate, timeoutMs) =>
  waitFor(label, async () => {
    const text = await page.locator('body').textContent({ timeout: 1000 }).catch(() => '');
    return predicate(text || '') ? true : null;
  }, timeoutMs);

const waitForProbe = async (page, label, predicate, timeoutMs) =>
  waitFor(label, async () => {
    const probe = await page.evaluate(buildReadStatusTimelineStaleUiProbeScript());
    return predicate(probe) ? probe : null;
  }, timeoutMs);

const main = async () => {
  const timeoutMs = normalizeStatusTimelineStaleUiSmokeTimeoutMs(process.env.CODEXWINMUX_STATUS_TIMELINE_STALE_UI_SMOKE_TIMEOUT_MS);
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-runtime-v2-status-timeline-stale-ui-'));
  const dbPath = path.join(homeDir, 'runtime-v2', 'state.db');
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const port = await getFreePort();
  const jsonlPath = await prepareFixturePath(homeDir);
  const unique = `${Date.now()}-${process.pid}`;
  const workspaceName = `Stale UI Evidence ${unique}`;
  const initialUserMessage = `stale-ui-initial-user-${unique}`;
  const initialAssistantMessage = `stale-ui-initial-assistant-${unique}`;
  const appendedUserMessage = `stale-ui-foreground-user-${unique}`;
  const checks = [];
  let server = null;
  let browser = null;
  let workspaceId = null;

  try {
    await writeFixture({ homeDir, jsonlPath, initialUserMessage, initialAssistantMessage });
    checks.push('jsonl-fixture');

    server = await startServer({ homeDir, dbPath, port, timeoutMs });
    const { baseUrl } = server;
    const cookie = await ensureLoggedIn(baseUrl);
    const tokenPath = path.join(homeDir, '.codexwinmux', 'cli-token');
    const token = (await fs.readFile(tokenPath, 'utf8')).trim();
    checks.push('server-login');

    const runtimeHealth = await jsonRequest(baseUrl, '/api/v2/runtime/health', cookie);
    if (runtimeHealth.timelineV2Mode !== 'default' || runtimeHealth.statusV2Mode !== 'default') {
      throw new Error(`runtime health did not report status/timeline default: ${JSON.stringify(runtimeHealth)}`);
    }
    checks.push('runtime-health-default');

    const runtimeWorkspace = await createRuntimeAgentWorkspace({
      baseUrl,
      cookie,
      workspaceName,
      cwd: homeDir,
    });
    workspaceId = runtimeWorkspace.workspaceId;
    checks.push('runtime-agent-workspace');

    const browserSession = await openBrowser({ baseUrl, cookie, timeoutMs });
    browser = browserSession.browser;
    const page = browserSession.page;
    await waitForBodyText(page, 'workspace visible', (text) => text.includes(workspaceName), timeoutMs);
    checks.push('browser-workspace-visible');

    await waitForProbe(page, 'initial status/timeline sockets open', (probe) =>
      probe.counts.statusOpen >= 1 && probe.counts.timelineOpen >= 1, timeoutMs);
    checks.push('status-timeline-websockets-open');

    const sessionButton = page.getByRole('button', { name: new RegExp(initialUserMessage) });
    await sessionButton.waitFor({ state: 'attached', timeout: timeoutMs });
    await sessionButton.evaluate((button) => button.click());
    await page.getByText(initialAssistantMessage, { exact: false }).waitFor({ state: 'visible', timeout: timeoutMs });
    checks.push('browser-timeline-initial-visible');

    await page.evaluate(buildDispatchNativeAppStateScript(false));
    await waitForProbe(page, 'native background closed status/timeline sockets', (probe) =>
      probe.counts.statusClose >= 1 && probe.counts.timelineClose >= 1, timeoutMs);
    checks.push('native-background-sockets-closed');

    await appendTimelineEntry({ jsonlPath, appendedUserMessage });
    await jsonRequest(baseUrl, '/api/status/hook', '', {
      token,
      method: 'POST',
      body: JSON.stringify({
        event: 'notification',
        session: runtimeWorkspace.sessionName,
        notificationType: 'permission_prompt',
      }),
    });
    checks.push('background-status-timeline-mutated');

    await page.evaluate(buildDispatchNativeAppStateScript(true));
    const foregroundProbe = await waitForProbe(page, 'native foreground reopened status/timeline sockets', (probe) =>
      probe.counts.statusOpen >= 2 && probe.counts.timelineOpen >= 2, timeoutMs);
    checks.push('native-foreground-sockets-reopened');

    await waitForBodyText(page, 'foreground timeline UI appended text', (text) =>
      text.includes(appendedUserMessage), timeoutMs);
    checks.push('foreground-timeline-ui-refreshed');

    await waitForBodyText(page, 'foreground status UI needs input', (text) =>
      text.includes('입력 대기') || text.includes('Waiting for input') || text.includes('Needs Input'), timeoutMs);
    checks.push('foreground-status-ui-refreshed');

    const payload = {
      ok: true,
      checks,
      workspaceId,
      tabId: runtimeWorkspace.tabId,
      statusV2Mode: runtimeHealth.statusV2Mode,
      timelineV2Mode: runtimeHealth.timelineV2Mode,
      websocketCounts: foregroundProbe.counts,
      browser: {
        consoleErrorCount: browserSession.consoleEvents.length,
        pageUrl: page.url(),
      },
    };
    await writeArtifact('passed', payload);
    console.log(JSON.stringify(payload, null, 2));
  } catch (err) {
    await fail('runtime-v2-status-timeline-stale-ui-smoke-failed', err instanceof Error ? err.message : String(err), {
      checks,
      serverOutput: server?.getOutput?.().slice(-3000),
      workspaceId,
    });
  } finally {
    await browser?.close?.().catch(() => undefined);
    if (server) {
      const baseUrl = `http://127.0.0.1:${port}`;
      const cookie = await ensureLoggedIn(baseUrl).catch(() => null);
      if (cookie && workspaceId) {
        await jsonRequest(baseUrl, `/api/workspace/${encodeURIComponent(workspaceId)}`, cookie, { method: 'DELETE' })
          .catch(() => undefined);
      }
    }
    await server?.stop?.();
    await fs.rm(homeDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

main();
