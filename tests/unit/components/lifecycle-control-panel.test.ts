import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LifecycleControlPanel } from '@/components/features/runtime/lifecycle-control-panel';
import type { ILifecycleViewModel } from '@/lib/runtime/lifecycle-control';

const healthyValue: ILifecycleViewModel = {
  release: {
    app: 'codexwinmux',
    version: '1.2.3',
    commit: 'abc1234',
    buildTime: '2026-05-01T00:00:00.000Z',
  },
  runtimeOk: true,
  modes: [
    { name: 'terminal', value: 'new-tabs', state: 'active' },
    { name: 'storage', value: 'default', state: 'active' },
    { name: 'timeline', value: 'shadow', state: 'active' },
    { name: 'status', value: 'shadow', state: 'active' },
  ],
  observation: {
    state: 'complete',
    sampledSince: '2026-05-01T00:00:00.000Z',
    generatedAt: '2026-05-02T01:00:00.000Z',
    endsAt: '2026-05-02T00:00:00.000Z',
    uptimeMs: 25 * 60 * 60 * 1000,
  },
  workers: [
    { name: 'storage', state: 'healthy', restarts: 0, timeouts: 0, failures: 0, lastError: null },
    { name: 'terminal', state: 'healthy', restarts: 0, timeouts: 0, failures: 0, lastError: null },
    { name: 'timeline', state: 'healthy', restarts: 0, timeouts: 0, failures: 0, lastError: null },
    { name: 'status', state: 'healthy', restarts: 0, timeouts: 0, failures: 0, lastError: null },
  ],
  perfTimings: [
    { name: 'stats.cache.build', count: 2, lastMs: 42, maxMs: 1200, averageMs: 300, totalMs: 600 },
  ],
  actions: [
    {
      id: 'phase6-gate',
      label: 'Run Phase 6 Gate',
      description: 'Run the read-only runtime v2 Phase 6 default gate smoke.',
      confirmationPhrase: null,
    },
    {
      id: 'restart-service',
      label: 'Restart Service',
      description: 'Restart the legacy Linux user service with systemd.',
      confirmationPhrase: 'restart codexmux.service',
    },
    {
      id: 'rollback-runtime-flags',
      label: 'Apply Rollback Flags',
      description: 'Write explicit CODEXWINMUX_RUNTIME rollback flags to the legacy systemd user drop-in and restart the service.',
      confirmationPhrase: 'rollback runtime v2',
    },
  ],
  actionEvents: [
    {
      id: 'event-a',
      actionId: 'phase6-gate',
      status: 'succeeded',
      startedAt: '2026-05-02T02:00:00.000Z',
      finishedAt: '2026-05-02T02:00:01.000Z',
      durationMs: 1000,
      exitCode: 0,
      error: null,
    },
  ],
  rollbackRunbook: [
    'Runtime v2 rollback runbook:',
    '1. Run corepack pnpm lifecycle:rollback-dry-run.',
    '2. Run corepack pnpm lifecycle:rollback-apply or Lifecycle Action "Apply Rollback Flags".',
    '3. Confirm CODEXWINMUX_RUNTIME_STORAGE_V2_MODE=write.',
    '4. Confirm CODEXWINMUX_RUNTIME_TERMINAL_V2_MODE=off.',
    '5. Confirm CODEXWINMUX_RUNTIME_TIMELINE_V2_MODE=off.',
    '6. Confirm CODEXWINMUX_RUNTIME_STATUS_V2_MODE=off.',
    '7. Confirm legacy systemctl --user restart codexmux.service completed, then recheck lifecycle health and worker diagnostics.',
  ].join('\n'),
};

const renderPanel = (value: ILifecycleViewModel): string =>
  renderToStaticMarkup(React.createElement(LifecycleControlPanel, { value }));

describe('LifecycleControlPanel', () => {
  it('renders the healthy lifecycle summary without fetching data', () => {
    const markup = renderPanel(healthyValue);

    expect(markup).toContain('1.2.3');
    expect(markup).toContain('2026-05-01 00:00:00 UTC');
    expect(markup).toContain('new-tabs');
    expect(markup).toContain('default');
    expect(markup).toContain('stats.cache.build');
    expect(markup).toContain('systemctl --user restart codexmux.service');
  });

  it('renders degraded worker errors while preserving the other sections', () => {
    const value: ILifecycleViewModel = {
      ...healthyValue,
      runtimeOk: false,
      workers: healthyValue.workers.map((worker) =>
        worker.name === 'terminal'
          ? { ...worker, state: 'degraded', failures: 2, lastError: 'spawn timeout after 5000ms' }
          : worker),
    };

    const markup = renderPanel(value);

    expect(markup).toContain('spawn timeout after 5000ms');
    expect(markup).toContain('Release');
    expect(markup).toContain('Modes');
    expect(markup).toContain('Perf Watch');
    expect(markup).toContain('Rollback Runbook');
  });

  it('renders unknown and pending gate states', () => {
    const value: ILifecycleViewModel = {
      ...healthyValue,
      modes: [
        ...healthyValue.modes.slice(0, 3),
        { name: 'status', value: '', state: 'unknown' },
      ],
      observation: {
        state: 'pending',
        sampledSince: '2026-05-01T00:00:00.000Z',
        generatedAt: '2026-05-01T12:00:00.000Z',
        endsAt: '2026-05-02T00:00:00.000Z',
        uptimeMs: 12 * 60 * 60 * 1000,
      },
    };

    const markup = renderPanel(value);

    expect(markup).toContain('unknown');
    expect(markup).toContain('pending');
  });

  it('renders lifecycle actions without exposing server command argv', () => {
    const markup = renderPanel(healthyValue);

    expect(markup).toContain('Lifecycle Actions');
    expect(markup).toContain('Run Phase 6 Gate');
    expect(markup).toContain('Restart Service');
    expect(markup).toContain('Apply Rollback Flags');
    expect(markup).toContain('rollback runtime v2');
    expect(markup).toContain('restart codexmux.service');
    expect(markup).toContain('succeeded');
    expect(markup).not.toContain('smoke:runtime-v2:phase6-default-gate');
    expect(markup).not.toContain('deploy:local');
  });
});
