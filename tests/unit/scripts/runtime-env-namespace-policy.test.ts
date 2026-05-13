import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const activeRuntimeEnvFiles = [
  'electron/main.ts',
  'electron/runtime-env.ts',
  'scripts/ops-smoke-batch.mjs',
  'scripts/smoke-android-runtime-v2-foreground.mjs',
  'scripts/smoke-android-timeline-foreground.mjs',
  'scripts/smoke-electron-runtime-v2.mjs',
  'scripts/smoke-runtime-v2-isolated.mjs',
  'scripts/smoke-runtime-v2-phase2-gate.mjs',
  'scripts/smoke-runtime-v2-phase6-default-gate.mjs',
  'scripts/smoke-runtime-v2-status-default.mjs',
  'scripts/smoke-runtime-v2.mjs',
  'scripts/smoke-windows-packaged-launch.mjs',
  'scripts/smoke-windows-runtime-v2-terminal.ts',
  'scripts/verify-runtime-native-bindings.mjs',
  'scripts/windows-runtime-v2-terminal-smoke-lib.ts',
  'scripts/windows-updater-local-feed-smoke-lib.mjs',
  'src/lib/runtime/env.ts',
  'src/lib/runtime/status-mode.ts',
  'src/lib/runtime/storage-mode.ts',
  'src/lib/runtime/storage-read-owner.ts',
  'src/lib/runtime/supervisor.ts',
  'src/lib/runtime/terminal-mode.ts',
  'src/lib/runtime/terminal/terminal-runtime-adapter-factory.ts',
  'src/lib/runtime/timeline-mode.ts',
  'src/lib/runtime/worker-client.ts',
  'src/lib/windows-service-host.ts',
];

const legacyRuntimeAliasCallPatterns = [
  /\bapplyAliasedDefault\(.*'CODEXMUX_RUNTIME_/,
  /\bbuildCodexwinmuxAliasEnv\(.*'CODEXMUX_RUNTIME_/,
  /\bbuildEnvAlias\(.*'CODEXMUX_RUNTIME_/,
  /\bbuildRuntimeEnvAliasRecord\(.*'CODEXMUX_RUNTIME_/,
  /\breadCodexwinmuxAlias\(.*'CODEXMUX_RUNTIME_/,
  /\breadEnvAlias\(.*'CODEXMUX_RUNTIME_/,
  /\breadRuntimeEnvAlias\(.*'CODEXMUX_RUNTIME_/,
  /\bwriteRuntimeEnvAlias\(.*'CODEXMUX_RUNTIME_/,
];

describe('runtime env namespace policy', () => {
  it('uses CODEXWINMUX runtime keys at active smoke and bootstrap call sites', () => {
    const offenders = activeRuntimeEnvFiles.flatMap((relativePath) => {
      const content = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
      return content.split(/\r?\n/).flatMap((line, index) =>
        legacyRuntimeAliasCallPatterns
          .filter((pattern) => pattern.test(line))
          .map((pattern) => `${relativePath}:${index + 1}: ${pattern.source}`));
    });

    expect(offenders).toEqual([]);
  });
});
