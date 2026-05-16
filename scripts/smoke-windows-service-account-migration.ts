import { readFileSync } from 'fs';
import path from 'path';
import {
  resolveWindowsServiceAccountMigrationPlan,
  validateWindowsServiceAccountMigrationPlan,
} from '@/lib/windows-service-account';

const assertIncludes = (haystack: string, needle: string, label: string): void => {
  if (!haystack.includes(needle)) {
    throw new Error(`${label} missing ${needle}`);
  }
};

const main = (): void => {
  const plan = resolveWindowsServiceAccountMigrationPlan({
    env: process.env,
    repoRoot: process.cwd(),
  });
  const validation = validateWindowsServiceAccountMigrationPlan(plan);
  if (!validation.ok) {
    throw new Error(`invalid Windows service account migration plan: ${validation.failures.join(', ')}`);
  }

  const checks: string[] = [
    'service-account-plan-valid',
    'service-account-secret-values-redacted',
  ];

  const migrationIds = plan.migrations.map((migration) => migration.id);
  for (const id of ['codex-credential-session-migration', 'codexwinmux-runtime-data-migration']) {
    if (!migrationIds.includes(id)) {
      throw new Error(`missing migration ${id}`);
    }
  }
  checks.push('service-account-profile-data-migrations');

  const aclRights = new Set(plan.aclTargets.map((target) => target.rights));
  if (!aclRights.has('Modify') || !aclRights.has('ReadAndExecute')) {
    throw new Error(`missing ACL right set: ${JSON.stringify(plan.aclTargets)}`);
  }
  checks.push('service-account-acl-targets');

  const smokeGateIds = plan.smokeGates.map((gate) => gate.id);
  for (const id of ['health', 'upgrade', 'uninstall', 'reboot'] as const) {
    if (!smokeGateIds.includes(id)) throw new Error(`missing smoke gate ${id}`);
  }
  checks.push('service-account-upgrade-uninstall-reboot-health-gates');

  const accountHelperPath = path.join(process.cwd(), 'scripts', 'windows-service-account.ps1');
  const accountHelper = readFileSync(accountHelperPath, 'utf8');
  for (const action of [
    'prepare-profile',
    'migrate-data',
    'apply-acl',
    'configure-service-logon',
    'rotate-password',
    'stop-services',
    'restart-services',
    'health',
    'verify-reboot-readiness',
  ]) {
    assertIncludes(accountHelper, action, accountHelperPath);
  }
  assertIncludes(accountHelper, 'CODEXWINMUX_WINDOWS_SERVICE_ACCOUNT_PASSWORD', accountHelperPath);
  assertIncludes(accountHelper, 'CODEXWINMUX_WINDOWS_SERVICE_ACCOUNT_ROTATION_PASSWORD', accountHelperPath);
  assertIncludes(accountHelper, 'IncludeCodexCredentials', accountHelperPath);
  assertIncludes(accountHelper, 'Invoke-CimMethod', accountHelperPath);
  assertIncludes(accountHelper, 'SeServiceLogonRight', accountHelperPath);
  assertIncludes(accountHelper, 'secedit', accountHelperPath);
  assertIncludes(accountHelper, 'icacls', accountHelperPath);
  checks.push('service-account-runbook-helper');
  checks.push('service-account-rotation-helper');

  const serviceHelperPath = path.join(process.cwd(), 'scripts', 'windows-service.ps1');
  const serviceHelper = readFileSync(serviceHelperPath, 'utf8');
  for (const parameter of [
    'ServiceAccountName',
    'ServiceUserProfilePath',
    'ServiceLocalAppDataPath',
    'ServiceAppDataPath',
    'ServiceLogPath',
  ]) {
    assertIncludes(serviceHelper, parameter, serviceHelperPath);
  }
  assertIncludes(serviceHelper, 'Test-DedicatedServiceAccountConfigured', serviceHelperPath);
  assertIncludes(serviceHelper, 'codexwinmux\\service-profile', serviceHelperPath);
  checks.push('service-account-profile-env-service-config');

  const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  for (const script of [
    'windows:service-account:plan',
    'windows:service-account:prepare-profile',
    'windows:service-account:migrate-data',
    'windows:service-account:apply-acl',
    'windows:service-account:configure-service-logon',
    'windows:service-account:rotate-password',
    'windows:service-account:stop-services',
    'windows:service-account:restart-services',
    'windows:service-account:health',
    'windows:service-account:verify',
    'windows:service-account:verify-reboot-readiness',
  ]) {
    if (typeof packageJson.scripts?.[script] !== 'string') {
      throw new Error(`package.json missing ${script}`);
    }
  }
  checks.push('service-account-package-scripts');

  console.log(JSON.stringify({
    ok: true,
    mutatesSystem: false,
    checks,
    account: plan.account.name,
    profile: plan.profile,
    migrations: plan.migrations.map((migration) => ({
      id: migration.id,
      sensitive: migration.sensitive,
      requiresExplicitCredentialCopy: migration.requiresExplicitCredentialCopy,
    })),
    aclTargets: plan.aclTargets,
    smokeGates: plan.smokeGates,
  }, null, 2));
};

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
}
