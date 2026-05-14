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

  const invocation = buildTsxServerInvocation({ rootDir });
  const child = spawn(
    invocation.command,
    invocation.args,
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
  const name = pair.slice(0, separator);
  const value = pair.slice(separator + 1);
  await context.addCookies([{
    name,
    value,
    url: baseUrl,
  }]);
};

const createRuntimeWorkspaceWithTab = async ({ baseUrl, cookie, name, defaultCwd }) => {
  const workspace = await jsonRequest(baseUrl, '/api/v2/workspaces', cookie, {
    method: 'POST',
    body: JSON.stringify({
      name,
      defaultCwd,
    }),
  });
  await jsonRequest(baseUrl, '/api/v2/tabs', cookie, {
    method: 'POST',
    body: JSON.stringify({
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      cwd: defaultCwd,
    }),
  });
  return workspace;
};

const responsePathMatches = (response, pathname, searchParams = {}) => {
  const url = new URL(response.url());
  if (url.pathname !== pathname) return false;
  for (const [key, value] of Object.entries(searchParams)) {
    if (url.searchParams.get(key) !== value) return false;
  }
  return response.status() >= 200 && response.status() < 300;
};

const runBrowserAssertion = async ({ baseUrl, cookie, timeoutMs }) => {
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

    return {
      page,
      browser,
      waitForText: async (text, { exact = true } = {}) => {
        try {
          await page.getByText(text, { exact }).waitFor({ state: 'visible', timeout: timeoutMs });
        } catch (err) {
          const bodyText = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`${message}\nVisible body text:\n${bodyText.slice(0, 2000)}`);
        }
      },
      waitForSyncMutation: async ({ expectedType, workspaceId, mutate }) => {
        await page.evaluate(buildInstallBrowserSyncProbeScript({
          expectedType,
          workspaceId,
          timeoutMs,
        }));
        await page.evaluate(buildReadBrowserSyncProbeReadyScript());
        const eventPromise = page.evaluate(buildReadBrowserSyncProbeEventScript());
        const result = await mutate();
        const syncEvent = await eventPromise;
        return {
          syncEvent,
          result,
        };
      },
      waitForLayoutRefresh: (workspaceId) =>
        page.waitForResponse((response) =>
          response.request().method() === 'GET'
          && responsePathMatches(response, '/api/layout', { workspace: workspaceId }), { timeout: timeoutMs }),
      waitForConfigRefresh: () =>
        page.waitForResponse((response) =>
          response.request().method() === 'GET'
          && responsePathMatches(response, '/api/config'), { timeout: timeoutMs }),
      waitForKeybindingsRefresh: () =>
        page.waitForResponse((response) =>
          response.request().method() === 'GET'
          && responsePathMatches(response, '/api/keybindings'), { timeout: timeoutMs }),
      getBrowserResult: () => ({
        consoleEventCount: consoleEvents.length,
        pageUrl: page.url(),
      }),
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

    const initialName = `Browser Sync Initial ${Date.now()}`;
    const initial = await createRuntimeWorkspaceWithTab({
      baseUrl,
      cookie,
      name: initialName,
      defaultCwd: rootDir,
    });
    createdWorkspaceIds.push(initial.id);

    assertion = await runBrowserAssertion({
      baseUrl,
      cookie,
      timeoutMs,
    });
    await assertion.waitForText(initialName);

    const checks = [
      'runtime-v2-storage-default-no-tmux-kill',
      'browser-initial-workspace-visible',
    ];
    const syncEvents = [];

    const workspaceName = `Browser Sync Workspace ${Date.now()}`;
    const created = (await assertion.waitForSyncMutation({
      expectedType: 'workspace',
      mutate: () => createRuntimeWorkspaceWithTab({
        baseUrl,
        cookie,
        name: workspaceName,
        defaultCwd: rootDir,
      }),
    })).result;
    createdWorkspaceIds.push(created.id);
    syncEvents.push({ label: 'workspace-create', type: 'workspace' });
    await assertion.waitForText(workspaceName);
    checks.push('browser-sync-websocket-workspace-create-event', 'browser-workspace-list-create-updated');

    const renamedName = `Browser Sync Renamed ${Date.now()}`;
    syncEvents.push({
      label: 'workspace-rename',
      ...(await assertion.waitForSyncMutation({
        expectedType: 'workspace',
        mutate: () => jsonRequest(baseUrl, `/api/workspace/${encodeURIComponent(initial.id)}`, cookie, {
          method: 'PATCH',
          body: JSON.stringify({ name: renamedName }),
        }),
      })).syncEvent,
    });
    await assertion.waitForText(renamedName);
    checks.push('browser-sync-websocket-workspace-rename-event', 'browser-workspace-list-rename-updated');

    const groupName = `Browser Sync Group ${Date.now()}`;
    const group = (await assertion.waitForSyncMutation({
      expectedType: 'workspace',
      mutate: () => jsonRequest(baseUrl, '/api/workspace/group', cookie, {
        method: 'POST',
        body: JSON.stringify({ name: groupName }),
      }),
    })).result;
    syncEvents.push({ label: 'workspace-group-create', type: 'workspace' });
    await assertion.waitForSyncMutation({
      expectedType: 'workspace',
      mutate: () => jsonRequest(baseUrl, `/api/workspace/${encodeURIComponent(initial.id)}`, cookie, {
        method: 'PATCH',
        body: JSON.stringify({ groupId: group.id }),
      }),
    });
    await assertion.waitForText(groupName, { exact: false });
    checks.push('browser-sync-websocket-workspace-group-event', 'browser-workspace-group-updated');

    await assertion.waitForSyncMutation({
      expectedType: 'workspace',
      mutate: () => jsonRequest(baseUrl, '/api/workspace/reorder', cookie, {
        method: 'PATCH',
        body: JSON.stringify({
          items: [
            { id: created.id, groupId: null },
            { id: initial.id, groupId: group.id },
          ],
        }),
      }),
    });
    await assertion.waitForSyncMutation({
      expectedType: 'workspace',
      mutate: () => jsonRequest(baseUrl, '/api/workspace/group/reorder', cookie, {
        method: 'PATCH',
        body: JSON.stringify({ groupIds: [group.id] }),
      }),
    });
    checks.push('browser-sync-websocket-workspace-order-event', 'browser-sync-websocket-group-order-event');

    const refreshedInitial = await jsonRequest(baseUrl, `/api/layout?workspace=${encodeURIComponent(initial.id)}`, cookie);
    const rootPane = collectPaneNodes(refreshedInitial)[0];
    if (!rootPane) throw new Error('browser sync matrix workspace did not include a pane');
    const initialRootPaneTabIds = rootPane.tabs.map((tab) => tab.id);

    const layoutMutation = async (label, mutate) => {
      const refreshPromise = assertion.waitForLayoutRefresh(initial.id);
      const { syncEvent, result } = await assertion.waitForSyncMutation({
        expectedType: 'layout',
        workspaceId: initial.id,
        mutate,
      });
      await refreshPromise;
      syncEvents.push({ label, ...syncEvent });
      checks.push(`browser-sync-websocket-${label}-layout-event`, `browser-layout-${label}-refetched`);
      return result;
    };

    const tabA = await layoutMutation('tab-create-a', () =>
      jsonRequest(
        baseUrl,
        `/api/layout/pane/${encodeURIComponent(rootPane.id)}/tabs?workspace=${encodeURIComponent(initial.id)}`,
        cookie,
        {
          method: 'POST',
          body: JSON.stringify({ name: 'Browser Sync Tab A', cwd: rootDir }),
        },
      ));
    const tabB = await layoutMutation('tab-create-b', () =>
      jsonRequest(
        baseUrl,
        `/api/layout/pane/${encodeURIComponent(rootPane.id)}/tabs?workspace=${encodeURIComponent(initial.id)}`,
        cookie,
        {
          method: 'POST',
          body: JSON.stringify({ name: 'Browser Sync Tab B', cwd: rootDir }),
        },
      ));

    await layoutMutation('tab-patch', () =>
      jsonRequest(
        baseUrl,
        `/api/layout/pane/${encodeURIComponent(rootPane.id)}/tabs/${encodeURIComponent(tabA.id)}?workspace=${encodeURIComponent(initial.id)}`,
        cookie,
        {
          method: 'PATCH',
          body: JSON.stringify({ name: 'Browser Sync Patched Tab', terminalCollapsed: true }),
        },
      ));
    const patchedLayout = await jsonRequest(baseUrl, `/api/layout?workspace=${encodeURIComponent(initial.id)}`, cookie);
    const patchedTab = collectPaneNodes(patchedLayout)
      .flatMap((pane) => pane.tabs)
      .find((tab) => tab.id === tabA.id);
    if (patchedTab?.name !== 'Browser Sync Patched Tab' || patchedTab?.terminalCollapsed !== true) {
      throw new Error(`patched tab state was not stored: ${JSON.stringify(patchedTab)}`);
    }
    checks.push('runtime-v2-layout-tab-patch-stored');

    await layoutMutation('tab-reorder', () =>
      jsonRequest(
        baseUrl,
        `/api/layout/pane/${encodeURIComponent(rootPane.id)}/tabs/order?workspace=${encodeURIComponent(initial.id)}`,
        cookie,
        {
          method: 'PATCH',
          body: JSON.stringify({ tabIds: [tabB.id, tabA.id, ...initialRootPaneTabIds] }),
        },
      ));

    const splitLayout = await layoutMutation('pane-split', () =>
      jsonRequest(
        baseUrl,
        `/api/layout/pane?workspace=${encodeURIComponent(initial.id)}`,
        cookie,
        {
          method: 'POST',
          body: JSON.stringify({ sourcePaneId: rootPane.id, orientation: 'horizontal', cwd: rootDir, panelType: 'terminal' }),
        },
      ));
    const splitPanes = collectPaneNodes(splitLayout);
    const targetPane = splitPanes.find((pane) => pane.id !== rootPane.id);
    if (!targetPane) throw new Error('pane split did not create a second pane');

    await layoutMutation('tab-move', () =>
      jsonRequest(
        baseUrl,
        `/api/layout/pane/${encodeURIComponent(rootPane.id)}/tabs/${encodeURIComponent(tabA.id)}/move?workspace=${encodeURIComponent(initial.id)}`,
        cookie,
        {
          method: 'POST',
          body: JSON.stringify({ toPaneId: targetPane.id, toIndex: 0 }),
        },
      ));

    await layoutMutation('layout-patch', () =>
      jsonRequest(baseUrl, `/api/layout?workspace=${encodeURIComponent(initial.id)}`, cookie, {
        method: 'PATCH',
        body: JSON.stringify({ activePaneId: targetPane.id }),
      }));

    await layoutMutation('pane-close', () =>
      jsonRequest(
        baseUrl,
        `/api/layout/pane/${encodeURIComponent(targetPane.id)}?workspace=${encodeURIComponent(initial.id)}`,
        cookie,
        { method: 'DELETE' },
      ));

    const configRefreshPromise = assertion.waitForConfigRefresh();
    await assertion.waitForSyncMutation({
      expectedType: 'config',
      mutate: () => jsonRequest(baseUrl, '/api/config', cookie, {
        method: 'PATCH',
        body: JSON.stringify({ codexShowTerminal: false }),
      }),
    });
    await configRefreshPromise;
    checks.push('browser-sync-websocket-config-event', 'browser-config-refetched');

    const keybindingsRefreshPromise = assertion.waitForKeybindingsRefresh();
    await assertion.waitForSyncMutation({
      expectedType: 'config',
      mutate: () => jsonRequest(baseUrl, '/api/keybindings', cookie, {
        method: 'PATCH',
        body: JSON.stringify({ id: 'workspace.new', key: 'ctrl+alt+n' }),
      }),
    });
    await keybindingsRefreshPromise;
    checks.push('browser-sync-websocket-keybindings-config-event', 'browser-keybindings-refetched');

    const browser = assertion.getBrowserResult();
    const payload = {
      ok: true,
      baseUrl,
      workspaceId: initial.id,
      workspaceName: renamedName,
      secondaryWorkspaceId: created.id,
      groupId: group.id,
      checks,
      syncEvents,
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
