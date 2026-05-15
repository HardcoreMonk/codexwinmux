import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createRuntimeSupervisorForTest } from '@/lib/runtime/supervisor';
import {
  buildWindowsRuntimeSmokeEchoCommand,
  createWindowsRuntimeV2TerminalSmokeEnv,
  hasWindowsRuntimeSmokeMarker,
} from './windows-runtime-v2-terminal-smoke-lib';
import { readRuntimeEnvAlias } from './runtime-env-alias';

const rootDir = process.cwd();

const readCodexwinmuxAlias = (legacyKey: string): string | undefined => {
  const preferred = process.env[legacyKey.replace(/^CODEXMUX_/, 'CODEXWINMUX_')];
  if (preferred) return preferred;
  return process.env[legacyKey];
};

const DEFAULT_TIMEOUT_MS = Number(readCodexwinmuxAlias('CODEXMUX_WINDOWS_TERMINAL_SMOKE_TIMEOUT_MS') || 20_000);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (
  label: string,
  predicate: () => boolean,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(50);
  }
  throw new Error(`${label} timed out`);
};

const assignProcessEnv = (env: NodeJS.ProcessEnv): void => {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};

const resolveWindowsShell = (): string =>
  readCodexwinmuxAlias('CODEXMUX_WINDOWS_TERMINAL_SMOKE_SHELL')
  || process.env.ComSpec
  || process.env.COMSPEC
  || 'cmd.exe';

const main = async (): Promise<void> => {
  if (process.platform !== 'win32') {
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      reason: 'Windows runtime v2 terminal smoke only runs on win32.',
    }, null, 2));
    return;
  }

  const configuredHomeDir = readCodexwinmuxAlias('CODEXMUX_WINDOWS_TERMINAL_SMOKE_HOME');
  const homeDir = configuredHomeDir
    || await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-windows-terminal-smoke-'));
  const dbPath = readRuntimeEnvAlias(process.env, 'CODEXWINMUX_RUNTIME_DB') || path.join(homeDir, 'runtime-v2', 'state.db');
  await fs.mkdir(path.dirname(dbPath), { recursive: true });

  const env = createWindowsRuntimeV2TerminalSmokeEnv({
    env: process.env,
    homeDir,
    dbPath,
    shell: resolveWindowsShell(),
  });
  assignProcessEnv(env);

  const supervisor = createRuntimeSupervisorForTest({
    dbPath,
    runtimeReset: true,
  });
  const checks: string[] = [];
  let tabId: string | null = null;
  let workspaceId: string | null = 'ws-windows-terminal-smoke';

  try {
    await supervisor.ensureStarted();
    const health = await supervisor.health();
    const terminalHealth = health.terminal as { adapter?: string; ok?: boolean };
    if (terminalHealth.adapter !== 'windows' || terminalHealth.ok !== true) {
      throw new Error(`terminal worker did not start with Windows adapter: ${JSON.stringify(terminalHealth)}`);
    }
    checks.push('worker-health-windows-adapter');

    const tab = await supervisor.createTerminalTab({
      workspaceId,
      paneId: 'pane-windows-terminal-smoke',
      cwd: rootDir,
      ensureWorkspacePane: {
        workspaceName: 'Windows Terminal Smoke',
        defaultCwd: rootDir,
      },
    });
    tabId = tab.id;
    checks.push('create-terminal-tab');

    let output = '';
    const closed: Array<{ code: number; reason: string }> = [];
    const attached = await supervisor.attachTerminal({
      sessionName: tab.sessionName,
      cols: 100,
      rows: 30,
      send: (data) => {
        output += data;
      },
      close: (code, reason) => {
        closed.push({ code, reason });
      },
    });
    checks.push('attach-terminal');

    await supervisor.resizeTerminal({
      sessionName: tab.sessionName,
      subscriberId: attached.subscriberId,
      cols: 120,
      rows: 40,
    });
    checks.push('resize-terminal');

    const firstMarker = `cmux-windows-runtime-${Date.now()}`;
    await supervisor.writeTerminal({
      sessionName: tab.sessionName,
      subscriberId: attached.subscriberId,
      data: buildWindowsRuntimeSmokeEchoCommand(firstMarker),
    });
    await waitFor('first Windows terminal marker', () =>
      hasWindowsRuntimeSmokeMarker(output, firstMarker));
    checks.push('write-terminal');

    await supervisor.detachTerminal({
      sessionName: tab.sessionName,
      subscriberId: attached.subscriberId,
    });
    checks.push('detach-terminal');

    const reattached = await supervisor.attachTerminal({
      sessionName: tab.sessionName,
      cols: 100,
      rows: 30,
      send: (data) => {
        output += data;
      },
      close: (code, reason) => {
        closed.push({ code, reason });
      },
    });
    const secondMarker = `cmux-windows-runtime-reattach-${Date.now()}`;
    await supervisor.writeTerminal({
      sessionName: tab.sessionName,
      subscriberId: reattached.subscriberId,
      data: buildWindowsRuntimeSmokeEchoCommand(secondMarker),
    });
    await waitFor('reattached Windows terminal marker', () =>
      hasWindowsRuntimeSmokeMarker(output, secondMarker));
    checks.push('reattach-terminal');

    const deleted = await supervisor.deleteTerminalTab(tab.id);
    tabId = null;
    if (deleted.killedSession !== tab.sessionName || deleted.failedKill) {
      throw new Error(`terminal tab delete did not kill the Windows session: ${JSON.stringify(deleted)}`);
    }
    checks.push('delete-terminal-tab-kills-session');

    const workspaceDeleted = await supervisor.deleteWorkspace(workspaceId);
    workspaceId = null;
    if (!workspaceDeleted.deleted || workspaceDeleted.failedKills.length > 0) {
      throw new Error(`workspace cleanup failed: ${JSON.stringify(workspaceDeleted)}`);
    }
    checks.push('workspace-delete');

    console.log(JSON.stringify({
      ok: true,
      homeDir,
      dbPath,
      checks,
      outputTail: output.slice(-400),
      closed,
    }, null, 2));
  } finally {
    if (tabId) {
      await supervisor.deleteTerminalTab(tabId).catch(() => undefined);
    }
    if (workspaceId) {
      await supervisor.deleteWorkspace(workspaceId).catch(() => undefined);
    }
    supervisor.shutdown();
    if (!configuredHomeDir) {
      await fs.rm(homeDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
};

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
