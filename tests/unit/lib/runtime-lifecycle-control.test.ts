import { describe, expect, it } from 'vitest';
import {
  buildLifecycleViewModel,
  buildRollbackRunbook,
  getObservationGate,
  selectTopPerfTimings,
} from '@/lib/runtime/lifecycle-control';

const dayMs = 24 * 60 * 60 * 1000;

describe('runtime lifecycle control helpers', () => {
  it('keeps the observation gate pending before 24 hours', () => {
    const sampledSince = '2026-05-01T00:00:00.000Z';
    const generatedAt = '2026-05-01T12:30:00.000Z';

    expect(getObservationGate({ sampledSince, generatedAt })).toEqual({
      state: 'pending',
      sampledSince,
      generatedAt,
      endsAt: '2026-05-02T00:00:00.000Z',
      uptimeMs: 12.5 * 60 * 60 * 1000,
    });
  });

  it('marks the observation gate complete after 24 hours', () => {
    const sampledSince = '2026-05-01T00:00:00.000Z';
    const generatedAt = new Date(new Date(sampledSince).getTime() + dayMs).toISOString();

    expect(getObservationGate({ sampledSince, generatedAt })).toEqual({
      state: 'complete',
      sampledSince,
      generatedAt,
      endsAt: '2026-05-02T00:00:00.000Z',
      uptimeMs: dayMs,
    });
  });

  it('returns unknown observation state for missing or invalid timestamps', () => {
    expect(getObservationGate({ sampledSince: null, generatedAt: '2026-05-01T00:00:00.000Z' })).toEqual({
      state: 'unknown',
      sampledSince: null,
      generatedAt: '2026-05-01T00:00:00.000Z',
      endsAt: null,
      uptimeMs: null,
    });
    expect(getObservationGate({ sampledSince: 'invalid', generatedAt: '2026-05-01T00:00:00.000Z' }).state).toBe('unknown');
    expect(getObservationGate({ sampledSince: '2026-05-01T00:00:00.000Z', generatedAt: 'invalid' }).state).toBe('unknown');
  });

  it('selects top perf timings by max, average, then name', () => {
    const timings = {
      beta: { count: 3, lastMs: 10, maxMs: 90, averageMs: 20, totalMs: 60 },
      alpha: { count: 2, lastMs: 12, maxMs: 90, averageMs: 30, totalMs: 60 },
      gamma: { count: 1, lastMs: 9, maxMs: 90, averageMs: 30, totalMs: 30 },
      delta: { count: 4, lastMs: 50, maxMs: 120, averageMs: 10, totalMs: 40 },
    };

    expect(selectTopPerfTimings(timings, 3)).toEqual([
      { name: 'delta', count: 4, lastMs: 50, maxMs: 120, averageMs: 10, totalMs: 40 },
      { name: 'alpha', count: 2, lastMs: 12, maxMs: 90, averageMs: 30, totalMs: 60 },
      { name: 'gamma', count: 1, lastMs: 9, maxMs: 90, averageMs: 30, totalMs: 30 },
    ]);
  });

  it('builds a lifecycle view model without leaking sensitive fields', () => {
    const viewModel = buildLifecycleViewModel({
      health: {
        app: 'codexwinmux',
        version: '1.2.3',
        commit: 'abc123',
        buildTime: '2026-05-01T00:00:00.000Z',
      },
      runtimeHealth: {
        ok: true,
        terminalV2Mode: 'new-tabs',
        storageV2Mode: 'write',
        timelineV2Mode: 'shadow',
        statusV2Mode: '',
        sessionName: 'rtv2-sensitive-session',
        token: 'secret-token',
        cwd: '/data/projects/codex-zone/codexmux',
        jsonlPath: '/data/projects/codex-zone/codexmux/session.jsonl',
        prompt: 'sensitive prompt',
        assistantText: 'sensitive assistant text',
        terminalOutput: 'sensitive terminal output',
        storage: { sessionName: 'rtv2-storage-session' },
        terminal: { cwd: '/data/projects/codex-zone/codexmux' },
      },
      perf: {
        runtime: {
          sampledSince: '2026-05-01T00:00:00.000Z',
          generatedAt: '2026-05-02T01:00:00.000Z',
          timings: {
            slow: { count: 1, lastMs: 400, maxMs: 400, averageMs: 400, totalMs: 400 },
            partial: { maxMs: 100 },
          },
        },
        services: {
          runtimeWorkers: {
            storage: {
              commandFailures: 1,
              restarts: 0,
              timeouts: 0,
              healthFailures: 0,
              readyFailures: 0,
              errors: 0,
              lastError: {
                message: [
                  'write failed at /data/projects/secret',
                  'x-cmux-token secret-token',
                  'x-cmux-token: colon-token',
                  'Authorization: Bearer bearer-token',
                  'token=query-token',
                  'token: query-colon-token',
                  'x-cmux-token=equals-token',
                  'x-cmux-token:no-space-token',
                  'cwd /data/projects/error',
                  'cwd=/data/projects/eq',
                  'cwd:/data/projects/colon',
                  'session rtv2-error-session',
                  'sessionName rtv2-error-session',
                  'sessionName: rtv2-colon-session',
                  'sessionName=rtv2-eq-session',
                  'sessionName:rtv2-no-space-session',
                  'sessionName worker-space',
                  'sessionName=worker-eq',
                  'sessionName:worker-colon',
                  'jsonlPath /data/projects/error/session.jsonl',
                  'jsonlPath=/data/projects/eq/session.jsonl',
                  'jsonlPath:/data/projects/colon/session.jsonl',
                  'session timed out',
                  'cwd lookup failed',
                  'prompt template failed',
                  '{"cwd":"/data/projects/json","sessionName":"rtv2-json-session","jsonlPath":"/data/projects/json/session.jsonl","token":"json-token","prompt":"json prompt","assistantText":"json assistant","terminalOutput":"json terminal"}',
                  '{"sessionName":"worker-main"}',
                  'prompt: worker prompt',
                  'prompt=eq prompt',
                  'prompt:colon prompt',
                  'assistantText: worker assistant text',
                  'assistantText=eq assistant',
                  'assistantText:colon assistant',
                  'terminalOutput: worker terminal output',
                  'terminalOutput=eq terminal',
                  'terminalOutput:colon terminal',
                ].join(' '),
                sessionName: 'rtv2-error-session',
                cwd: '/data/projects/error',
                jsonlPath: '/data/projects/error/session.jsonl',
                prompt: 'worker prompt',
                assistantText: 'worker assistant text',
                terminalOutput: 'worker terminal output',
              },
            },
            terminal: { restarts: 1, timeouts: 0, commandFailures: 0, healthFailures: 0, readyFailures: 0, errors: 0, lastError: null },
            timeline: { timeouts: 1, commandFailures: 0, healthFailures: 0, readyFailures: 0, errors: 0, lastError: { message: 'timed out' } },
            status: { restarts: 0, timeouts: 0, commandFailures: 0, healthFailures: 0, readyFailures: 0, errors: 0, lastError: null },
          },
        },
      },
      lifecycleActions: {
        actions: [
          {
            id: 'phase6-gate',
            label: 'Run Phase 6 Gate',
            description: 'Run read-only smoke',
            command: 'corepack',
            args: ['pnpm', 'smoke:runtime-v2:phase6-default-gate'],
            confirmationPhrase: null,
          },
          {
            id: 'restart-service',
            label: 'Restart Service',
            description: 'Restart service',
            command: 'systemctl',
            args: ['--user', 'restart', 'codexmux.service'],
            confirmationPhrase: 'restart codexmux.service',
          },
        ],
        events: [
          {
            id: 'event-a',
            actionId: 'phase6-gate',
            status: 'failed',
            startedAt: '2026-05-02T02:00:00.000Z',
            finishedAt: '2026-05-02T02:00:01.000Z',
            durationMs: 1000,
            exitCode: 1,
            error: 'failed cwd /data/projects/secret x-cmux-token lifecycle-secret sessionName rtv2-action-secret',
          },
        ],
      },
    });

    expect(viewModel).toMatchObject({
      release: {
        app: 'codexwinmux',
        version: '1.2.3',
        commit: 'abc123',
        buildTime: '2026-05-01T00:00:00.000Z',
      },
      runtimeOk: true,
      modes: [
        { name: 'terminal', value: 'new-tabs', state: 'active' },
        { name: 'storage', value: 'write', state: 'active' },
        { name: 'timeline', value: 'shadow', state: 'active' },
        { name: 'status', value: '', state: 'unknown' },
      ],
      observation: {
        state: 'complete',
        sampledSince: '2026-05-01T00:00:00.000Z',
        generatedAt: '2026-05-02T01:00:00.000Z',
        endsAt: '2026-05-02T00:00:00.000Z',
        uptimeMs: dayMs + 60 * 60 * 1000,
      },
      workers: [
        {
          name: 'storage',
          state: 'degraded',
          restarts: 0,
          timeouts: 0,
          failures: 1,
          lastError: 'write failed at [path] [secret] [secret] [secret] [secret] [secret] [secret] [secret] [path] [path] [path] [runtime-session] [runtime-session] [runtime-session] [runtime-session] [runtime-session] [runtime-session] [runtime-session] [runtime-session] [path] [path] [path] session timed out cwd lookup failed prompt template failed {[path],[runtime-session],[path],[secret],[redacted],[redacted],[redacted]} {[runtime-session]} [redacted] [redacted] [redacted]',
        },
        { name: 'terminal', state: 'degraded', restarts: 1, timeouts: 0, failures: 0, lastError: null },
        { name: 'timeline', state: 'degraded', restarts: 0, timeouts: 1, failures: 0, lastError: 'timed out' },
        { name: 'status', state: 'healthy', restarts: 0, timeouts: 0, failures: 0, lastError: null },
      ],
      perfTimings: [
        { name: 'slow', count: 1, lastMs: 400, maxMs: 400, averageMs: 400, totalMs: 400 },
        { name: 'partial', count: 0, lastMs: 0, maxMs: 100, averageMs: 0, totalMs: 0 },
      ],
      actions: [
        {
          id: 'phase6-gate',
          label: 'Run Phase 6 Gate',
          description: 'Run read-only smoke',
          confirmationPhrase: null,
        },
        {
          id: 'restart-service',
          label: 'Restart Service',
          description: 'Restart service',
          confirmationPhrase: 'restart codexmux.service',
        },
      ],
      actionEvents: [
        {
          id: 'event-a',
          actionId: 'phase6-gate',
          status: 'failed',
          startedAt: '2026-05-02T02:00:00.000Z',
          finishedAt: '2026-05-02T02:00:01.000Z',
          durationMs: 1000,
          exitCode: 1,
          error: 'failed [path] [secret] [runtime-session]',
        },
      ],
    });
    expect(viewModel.rollbackRunbook).toBe(buildRollbackRunbook());
    expect(viewModel.workers[0]?.lastError).toContain('session timed out');
    expect(viewModel.workers[0]?.lastError).toContain('cwd lookup failed');
    expect(viewModel.workers[0]?.lastError).toContain('prompt template failed');
    const actionsJson = JSON.stringify(viewModel.actions);

    const json = JSON.stringify(viewModel);
    expect(json).not.toContain('/data/projects');
    expect(actionsJson).not.toContain('corepack');
    expect(actionsJson).not.toContain('systemctl');
    expect(json).not.toContain('lifecycle-secret');
    expect(json).not.toContain('secret-token');
    expect(json).not.toContain('colon-token');
    expect(json).not.toContain('query-colon-token');
    expect(json).not.toContain('equals-token');
    expect(json).not.toContain('no-space-token');
    expect(json).not.toContain('bearer-token');
    expect(json).not.toContain('query-token');
    expect(json).not.toContain('json-token');
    expect(json).not.toContain('x-cmux-token');
    expect(json).not.toContain('Authorization: Bearer');
    expect(json).not.toContain('token=');
    expect(json).not.toContain('token:');
    expect(json).not.toContain('x-cmux-token:');
    expect(json).not.toContain('"token"');
    expect(json).not.toContain('~/.codexwinmux/cli-token');
    expect(json).not.toContain('"cwd"');
    expect(json).not.toContain('sessionName');
    expect(json).not.toContain('"jsonlPath"');
    expect(json).not.toContain('json prompt');
    expect(json).not.toContain('json assistant');
    expect(json).not.toContain('json terminal');
    expect(json).not.toContain('rtv2-sensitive-session');
    expect(json).not.toContain('rtv2-error-session');
    expect(json).not.toContain('rtv2-colon-session');
    expect(json).not.toContain('rtv2-eq-session');
    expect(json).not.toContain('rtv2-no-space-session');
    expect(json).not.toContain('rtv2-json-session');
    expect(json).not.toContain('worker-main');
    expect(json).not.toContain('worker-space');
    expect(json).not.toContain('worker-eq');
    expect(json).not.toContain('worker-colon');
    expect(json).not.toContain('worker prompt');
    expect(json).not.toContain('eq prompt');
    expect(json).not.toContain('colon prompt');
    expect(json).not.toContain('worker assistant text');
    expect(json).not.toContain('eq assistant');
    expect(json).not.toContain('colon assistant');
    expect(json).not.toContain('worker terminal output');
    expect(json).not.toContain('eq terminal');
    expect(json).not.toContain('colon terminal');
  });

  it('builds an automation-first rollback runbook without secrets', () => {
    const runbook = buildRollbackRunbook();

    expect(runbook).toContain('corepack pnpm lifecycle:rollback-dry-run');
    expect(runbook).toContain('corepack pnpm lifecycle:rollback-apply');
    expect(runbook).toContain('CODEXWINMUX_RUNTIME_STORAGE_V2_MODE=write');
    expect(runbook).toContain('CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE=off');
    expect(runbook).toContain('CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE=off');
    expect(runbook).toContain('CODEXWINMUX_RUNTIME_STATUS_V2_MODE=off');
    expect(runbook).toContain('legacy systemctl --user restart codexmux.service');
    expect(runbook).not.toContain('x-cmux-token');
    expect(runbook).not.toContain('~/.codexwinmux/cli-token');
  });
});
