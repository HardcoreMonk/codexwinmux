import { describe, expect, it } from 'vitest';
import {
  resolveWindowsServiceAccountMigrationPlan,
  validateWindowsServiceAccountMigrationPlan,
} from '@/lib/windows-service-account';

describe('Windows service account migration plan', () => {
  it('plans profile/data, Codex credential/session, ACL, rotation, and service smoke gates without secrets', () => {
    const plan = resolveWindowsServiceAccountMigrationPlan({
      env: {
        USERPROFILE: 'C:\\Users\\yohan',
        ProgramData: 'C:\\ProgramData',
      },
      repoRoot: 'D:\\data\\projects\\codex-zone\\codexwinmux',
    });

    expect(plan.account).toMatchObject({
      name: 'codexwinmux-svc',
      qualifiedName: '.\\codexwinmux-svc',
      passwordEnv: 'CODEXWINMUX_WINDOWS_SERVICE_ACCOUNT_PASSWORD',
      rotationPasswordEnv: 'CODEXWINMUX_WINDOWS_SERVICE_ACCOUNT_ROTATION_PASSWORD',
      serviceLogonRight: 'SeServiceLogonRight',
    });
    expect(plan.secretValuesPresent).toBe(false);
    expect(plan.profile).toMatchObject({
      root: 'C:\\ProgramData\\codexwinmux\\service-profile',
      userProfile: 'C:\\ProgramData\\codexwinmux\\service-profile',
      localAppData: 'C:\\ProgramData\\codexwinmux\\service-profile\\AppData\\Local',
      appData: 'C:\\ProgramData\\codexwinmux\\service-profile\\AppData\\Roaming',
    });
    expect(plan.environment).toMatchObject({
      HOME: 'C:\\ProgramData\\codexwinmux\\service-profile',
      USERPROFILE: 'C:\\ProgramData\\codexwinmux\\service-profile',
      LOCALAPPDATA: 'C:\\ProgramData\\codexwinmux\\service-profile\\AppData\\Local',
      APPDATA: 'C:\\ProgramData\\codexwinmux\\service-profile\\AppData\\Roaming',
    });
    expect(plan.migrations.map((migration) => migration.id)).toEqual([
      'codex-credential-session-migration',
      'codexwinmux-runtime-data-migration',
    ]);
    expect(plan.migrations[0]).toMatchObject({
      source: 'C:\\Users\\yohan\\.codex',
      target: 'C:\\ProgramData\\codexwinmux\\service-profile\\.codex',
      sensitive: true,
      requiresExplicitCredentialCopy: true,
    });
    expect(plan.aclTargets).toEqual([
      {
        path: 'C:\\ProgramData\\codexwinmux\\service-profile',
        rights: 'Modify',
        reason: 'service profile, Codex credentials, sessions, and codexwinmux runtime data',
      },
      {
        path: 'D:\\data\\projects\\codex-zone\\codexwinmux\\release\\win-unpacked',
        rights: 'ReadAndExecute',
        reason: 'packaged executable and runtime assets',
      },
      {
        path: 'C:\\Users\\yohan\\AppData\\Local\\codexwinmux\\service',
        rights: 'ReadAndExecute',
        reason: 'WinSW wrapper binaries and XML configs',
      },
    ]);
    expect(plan.rotation).toMatchObject({
      supported: true,
      restartRequired: true,
      passwordEnv: 'CODEXWINMUX_WINDOWS_SERVICE_ACCOUNT_ROTATION_PASSWORD',
    });
    expect(plan.smokeGates.map((gate) => gate.id)).toEqual([
      'health',
      'upgrade',
      'uninstall',
      'reboot',
    ]);
    expect(validateWindowsServiceAccountMigrationPlan(plan)).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('records password env presence without serializing secret values', () => {
    const plan = resolveWindowsServiceAccountMigrationPlan({
      env: {
        USERPROFILE: 'C:\\Users\\yohan',
        ProgramData: 'C:\\ProgramData',
        CODEXWINMUX_WINDOWS_SERVICE_ACCOUNT_PASSWORD: 'do-not-print-this',
      },
      repoRoot: 'D:\\data\\projects\\codex-zone\\codexwinmux',
    });

    expect(plan.secretValuesPresent).toBe(true);
    expect(JSON.stringify(plan)).not.toContain('do-not-print-this');
    expect(validateWindowsServiceAccountMigrationPlan(plan).ok).toBe(true);
  });
});
