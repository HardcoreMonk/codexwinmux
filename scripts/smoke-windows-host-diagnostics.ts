import { resolveWindowsHostDiagnostics } from '@/lib/windows-host-diagnostics';

const sensitiveOutputMarkers = ['token', 'secret', 'prompt', 'session'];

const assertOutputKeysAreSanitized = (value: unknown): void => {
  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const item of value) assertOutputKeysAreSanitized(item);
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    const marker = sensitiveOutputMarkers.find((candidate) => normalizedKey.includes(candidate));
    if (marker) {
      throw new Error(`Windows host diagnostics smoke output contains sensitive field: ${key}`);
    }
    assertOutputKeysAreSanitized(nestedValue);
  }
};

const main = async (): Promise<void> => {
  const diagnostics = resolveWindowsHostDiagnostics({
    platform: process.platform,
    env: process.env,
    appDir: process.cwd(),
  });

  if (process.platform !== 'win32') {
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      reason: diagnostics.reason,
    }, null, 2));
    return;
  }

  const checks: string[] = [];

  if (diagnostics.skipped) {
    throw new Error(`Windows host diagnostics unexpectedly skipped: ${JSON.stringify(diagnostics)}`);
  }
  checks.push('platform-win32');

  if (diagnostics.reason) {
    throw new Error(`Windows host diagnostics is not ready: ${diagnostics.reason}`);
  }
  checks.push('host-plan-ready');

  if (diagnostics.mutatesSystem) {
    throw new Error('Windows host diagnostics smoke must not mutate the system.');
  }
  checks.push('dry-run-no-system-mutation');

  if (!diagnostics.paths.dataDir.endsWith('.codexwinmux')) {
    throw new Error(`unexpected Windows data directory: ${diagnostics.paths.dataDir}`);
  }
  if (!diagnostics.paths.codexDir.endsWith('.codex')) {
    throw new Error(`unexpected Windows Codex directory: ${diagnostics.paths.codexDir}`);
  }
  if (!diagnostics.paths.logDir.endsWith('\\codexmux\\logs')) {
    throw new Error(`unexpected Windows log directory: ${diagnostics.paths.logDir}`);
  }
  checks.push('windows-data-and-log-paths');

  if (diagnostics.health.baseUrl.includes('0.0.0.0')) {
    throw new Error(`health probe must use a loopback URL, not wildcard binding: ${diagnostics.health.baseUrl}`);
  }
  if (!diagnostics.health.healthUrl.endsWith('/api/health')) {
    throw new Error(`unexpected health URL: ${diagnostics.health.healthUrl}`);
  }
  if (!diagnostics.health.runtimeHealthUrl.endsWith('/api/v2/runtime/health')) {
    throw new Error(`unexpected runtime health URL: ${diagnostics.health.runtimeHealthUrl}`);
  }
  checks.push('health-probe-urls');

  if (!diagnostics.health.authenticatedRuntimeHealth) {
    throw new Error('runtime v2 health endpoint must be marked as authenticated.');
  }
  checks.push('runtime-health-authenticated');

  const output = {
    ok: true,
    checks,
    paths: diagnostics.paths,
    hostBinding: diagnostics.hostBinding,
    health: diagnostics.health,
    serviceHost: diagnostics.serviceHost,
  };

  assertOutputKeysAreSanitized(output);
  console.log(JSON.stringify(output, null, 2));
};

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
