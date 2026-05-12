import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempHome: string;

describe('runtime lifecycle actions', () => {
  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-lifecycle-actions-'));
    vi.resetModules();
    vi.stubEnv('HOME', tempHome);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  it('runs only allowlisted actions with fixed argv and writes sanitized audit', async () => {
    const appDir = path.join(tempHome, 'checkout');
    vi.stubEnv('__CMUX_APP_DIR', appDir);
    vi.stubEnv('__CMUX_PRISTINE_ENV', JSON.stringify({
      HOME: tempHome,
      PATH: '/usr/bin',
      NODE_ENV: 'production',
      PORT: '8122',
    }));
    vi.stubEnv('__NEXT_PRIVATE_STANDALONE_CONFIG', 'polluted');
    const executed: Array<{ command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }> = [];
    const { createLifecycleActionService } = await import('@/lib/runtime/lifecycle-actions');
    const service = createLifecycleActionService({
      execute: async (command, args, options) => {
        executed.push({ command, args, cwd: options.cwd, env: options.env });
        return { exitCode: 0 };
      },
    });

    const result = await service.runAction({ actionId: 'phase6-gate' });

    expect(result.ok).toBe(true);
    expect(executed).toEqual([
      {
        command: 'corepack',
        args: ['pnpm', 'smoke:runtime-v2:phase6-default-gate'],
        cwd: appDir,
        env: expect.objectContaining({
          HOME: tempHome,
          PATH: '/usr/bin',
          NODE_ENV: 'production',
          PORT: '8122',
          __CMUX_APP_DIR: appDir,
        }) as NodeJS.ProcessEnv,
      },
    ]);
    expect(executed[0]?.env.__NEXT_PRIVATE_STANDALONE_CONFIG).toBeUndefined();
    const events = await service.readAuditEvents({ limit: 10 });
    expect(events[0]).toMatchObject({
      actionId: 'phase6-gate',
      status: 'succeeded',
      exitCode: 0,
      error: null,
    });
  });

  it('rejects guarded actions without the exact confirmation phrase', async () => {
    const { createLifecycleActionService } = await import('@/lib/runtime/lifecycle-actions');
    const service = createLifecycleActionService({
      execute: async () => {
        throw new Error('must not execute');
      },
    });

    const result = await service.runAction({ actionId: 'restart-service', confirmation: 'restart' });

    expect(result.ok).toBe(false);
    expect(result.event).toMatchObject({
      actionId: 'restart-service',
      status: 'rejected',
      exitCode: null,
      error: 'confirmation-required',
    });
  });

  it('runs rollback flag mutation through the allowlist only after confirmation', async () => {
    const executed: Array<{ command: string; args: string[] }> = [];
    const { createLifecycleActionService } = await import('@/lib/runtime/lifecycle-actions');
    const service = createLifecycleActionService({
      execute: async (command, args) => {
        executed.push({ command, args });
        return { exitCode: 0 };
      },
    });

    const rejected = await service.runAction({ actionId: 'rollback-runtime-flags', confirmation: 'rollback' });
    const accepted = await service.runAction({
      actionId: 'rollback-runtime-flags',
      confirmation: 'rollback runtime v2',
    });

    expect(rejected.ok).toBe(false);
    expect(rejected.event).toMatchObject({
      actionId: 'rollback-runtime-flags',
      status: 'rejected',
      error: 'confirmation-required',
    });
    expect(accepted.ok).toBe(true);
    expect(executed).toEqual([
      {
        command: 'corepack',
        args: ['pnpm', 'lifecycle:rollback-apply'],
      },
    ]);
  });

  it('blocks concurrent actions and records the rejected request', async () => {
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const { createLifecycleActionService } = await import('@/lib/runtime/lifecycle-actions');
    const service = createLifecycleActionService({
      execute: async () => {
        await blocker;
        return { exitCode: 0 };
      },
    });

    const first = service.runAction({ actionId: 'phase6-gate' });
    const second = await service.runAction({ actionId: 'phase6-gate' });
    release();
    await first;

    expect(second.ok).toBe(false);
    expect(second.event).toMatchObject({
      actionId: 'phase6-gate',
      status: 'rejected',
      error: 'action-already-running',
    });
  });

  it('stores only a sanitized failure label when action execution throws', async () => {
    const { createLifecycleActionService } = await import('@/lib/runtime/lifecycle-actions');
    const service = createLifecycleActionService({
      execute: async () => {
        throw new Error('failed cwd /data/projects/secret x-cmux-token secret-token sessionName rtv2-secret');
      },
    });

    const result = await service.runAction({ actionId: 'phase6-gate' });
    const raw = await fs.readFile(path.join(tempHome, '.codexwinmux', 'lifecycle-actions.jsonl'), 'utf-8');

    expect(result.ok).toBe(false);
    expect(result.event.error).toBe('action-execution-failed');
    expect(raw).not.toContain('/data/projects/secret');
    expect(raw).not.toContain('secret-token');
    expect(raw).not.toContain('rtv2-secret');
  });

  it('does not persist command output from exec failures', async () => {
    const { createLifecycleActionService } = await import('@/lib/runtime/lifecycle-actions');
    const service = createLifecycleActionService({
      execute: async () => {
        const err = new Error([
          'Command failed: corepack pnpm deploy:local',
          'sh: 1: next: not found',
          'cwd /data/projects/secret',
          'x-cmux-token leaked-token',
        ].join('\n')) as Error & { code: number };
        err.code = 1;
        throw err;
      },
    });

    const result = await service.runAction({ actionId: 'deploy-local', confirmation: 'deploy local' });
    const raw = await fs.readFile(path.join(tempHome, '.codexwinmux', 'lifecycle-actions.jsonl'), 'utf-8');

    expect(result.ok).toBe(false);
    expect(result.event.error).toBe('exit-code-1');
    expect(raw).not.toContain('Command failed');
    expect(raw).not.toContain('next: not found');
    expect(raw).not.toContain('/data/projects/secret');
    expect(raw).not.toContain('leaked-token');
  });
});
