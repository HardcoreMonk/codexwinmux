import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/lifecycle-rollback-dry-run-lib.mjs')).href);

let tempDir: string;

describe('lifecycle rollback mutation helpers', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-lifecycle-rollback-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('dry-runs explicit rollback flag mutation without deleting the drop-in', async () => {
    const { buildLifecycleRollbackDryRun, rollbackRuntimeEnv } = await loadLib();
    const dropInPath = path.join(tempDir, 'codexmux.service.d', 'runtime-v2-shadow.conf');
    await fs.mkdir(path.dirname(dropInPath), { recursive: true });
    await fs.writeFile(dropInPath, [
      '[Service]',
      'Environment=CODEXWINMUX_RUNTIME_V2=1',
      'Environment=CODEXWINMUX_RUNTIME_STORAGE_V2_MODE=default',
      'Environment=CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE=new-tabs',
      'Environment=CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE=default',
      'Environment=CODEXWINMUX_RUNTIME_STATUS_V2_MODE=default',
      '',
    ].join('\n'));

    const result = await buildLifecycleRollbackDryRun({ dropInPath });

    expect(result).toMatchObject({
      dropInExists: true,
      mutates: false,
      targetEnv: rollbackRuntimeEnv,
      commands: [
        `write ${dropInPath} with rollback runtime flags`,
        'systemctl --user daemon-reload',
        'systemctl --user restart codexmux.service',
      ],
    });
    expect(result.commands).not.toContain(`rm ${dropInPath}`);
  });

  it('backs up and rewrites the runtime drop-in before reloading and restarting systemd', async () => {
    const { applyLifecycleRollbackMutation, buildRuntimeDropInContent, rollbackRuntimeEnv } = await loadLib();
    const dropInPath = path.join(tempDir, 'codexmux.service.d', 'runtime-v2-shadow.conf');
    const backupStamp = '2026-05-08T14-30-00-000Z';
    const systemctlCalls: string[][] = [];
    await fs.mkdir(path.dirname(dropInPath), { recursive: true });
    await fs.writeFile(dropInPath, [
      '[Service]',
      'Environment=CODEXWINMUX_RUNTIME_V2=1',
      'Environment=CODEXWINMUX_RUNTIME_STORAGE_V2_MODE=default',
      'Environment=CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE=new-tabs',
      'Environment=CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE=default',
      'Environment=CODEXWINMUX_RUNTIME_STATUS_V2_MODE=default',
      'Environment=TOKEN=do-not-report',
      '',
    ].join('\n'));

    const result = await applyLifecycleRollbackMutation({
      dropInPath,
      generatedAt: '2026-05-08T14:30:00.000Z',
      backupStamp,
      execFile: async (command: string, args: string[]) => {
        systemctlCalls.push([command, ...args]);
      },
    });

    const backupPath = `${dropInPath}.${backupStamp}.bak`;
    await expect(fs.readFile(backupPath, 'utf-8')).resolves.toContain('TOKEN=do-not-report');
    await expect(fs.readFile(dropInPath, 'utf-8')).resolves.toBe(buildRuntimeDropInContent(rollbackRuntimeEnv));
    expect(systemctlCalls).toEqual([
      ['systemctl', '--user', 'daemon-reload'],
      ['systemctl', '--user', 'restart', 'codexmux.service'],
    ]);
    expect(result).toMatchObject({
      schemaVersion: 1,
      generatedAt: '2026-05-08T14:30:00.000Z',
      service: 'codexmux.service',
      dropInPath,
      backupPath,
      previousDropInExists: true,
      appliedEnv: rollbackRuntimeEnv,
      mutates: true,
      systemctl: [
        { command: 'systemctl', args: ['--user', 'daemon-reload'], ok: true },
        { command: 'systemctl', args: ['--user', 'restart', 'codexmux.service'], ok: true },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('do-not-report');
  });

  it('still parses legacy CODEXMUX runtime env lines during the staged migration', async () => {
    const { buildLifecycleRollbackDryRun } = await loadLib();
    const dropInPath = path.join(tempDir, 'codexmux.service.d', 'runtime-v2-shadow.conf');
    await fs.mkdir(path.dirname(dropInPath), { recursive: true });
    await fs.writeFile(dropInPath, [
      '[Service]',
      'Environment=CODEXMUX_RUNTIME_V2=1',
      'Environment=CODEXMUX_RUNTIME_STORAGE_V2_MODE=default',
      '',
    ].join('\n'));

    const result = await buildLifecycleRollbackDryRun({ dropInPath });

    expect(result.runtimeEnv).toMatchObject({
      CODEXMUX_RUNTIME_V2: '1',
      CODEXMUX_RUNTIME_STORAGE_V2_MODE: 'default',
    });
    expect(Object.keys(result.targetEnv)).toContain('CODEXWINMUX_RUNTIME_V2');
  });

  it('creates a missing runtime drop-in and reports a non-secret warning', async () => {
    const { applyLifecycleRollbackMutation, buildRuntimeDropInContent, rollbackRuntimeEnv } = await loadLib();
    const dropInPath = path.join(tempDir, 'codexmux.service.d', 'runtime-v2-shadow.conf');

    const result = await applyLifecycleRollbackMutation({
      dropInPath,
      generatedAt: '2026-05-08T14:35:00.000Z',
      execFile: vi.fn().mockResolvedValue(undefined),
    });

    await expect(fs.readFile(dropInPath, 'utf-8')).resolves.toBe(buildRuntimeDropInContent(rollbackRuntimeEnv));
    expect(result).toMatchObject({
      previousDropInExists: false,
      backupPath: null,
      warnings: ['runtime drop-in not found; rollback file created'],
    });
  });

  it('does not leak systemctl stderr when reload or restart fails', async () => {
    const { applyLifecycleRollbackMutation } = await loadLib();
    const dropInPath = path.join(tempDir, 'codexmux.service.d', 'runtime-v2-shadow.conf');

    await expect(applyLifecycleRollbackMutation({
      dropInPath,
      execFile: async () => {
        throw new Error('Command failed: systemctl --user daemon-reload\nstderr TOKEN=do-not-report');
      },
    })).rejects.toThrow('systemctl-daemon-reload-failed');
  });
});
