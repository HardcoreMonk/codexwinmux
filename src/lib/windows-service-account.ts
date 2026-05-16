import path from 'path';

export interface IWindowsServiceAccountMigrationPlanInput {
  env?: Record<string, string | undefined>;
  repoRoot?: string;
  accountName?: string;
  sourceUserProfile?: string;
  serviceProfileRoot?: string;
}

export interface IWindowsServiceAccountMigrationPlan {
  account: {
    name: string;
    qualifiedName: string;
    passwordEnv: string;
    rotationPasswordEnv: string;
  };
  secretValuesPresent: boolean;
  profile: {
    root: string;
    userProfile: string;
    localAppData: string;
    appData: string;
  };
  environment: {
    HOME: string;
    USERPROFILE: string;
    LOCALAPPDATA: string;
    APPDATA: string;
  };
  migrations: Array<{
    id: string;
    source: string;
    target: string;
    sensitive: boolean;
    requiresExplicitCredentialCopy: boolean;
  }>;
  aclTargets: Array<{
    path: string;
    rights: 'Modify' | 'ReadAndExecute';
    reason: string;
  }>;
  rotation: {
    supported: true;
    restartRequired: true;
    passwordEnv: string;
  };
  smokeGates: Array<{
    id: 'health' | 'upgrade' | 'uninstall' | 'reboot';
    command: string;
    mutatesSystem: boolean;
  }>;
}

export interface IWindowsServiceAccountMigrationValidation {
  ok: boolean;
  failures: string[];
}

const defaultAccountName = 'codexwinmux-svc';
const passwordEnv = 'CODEXWINMUX_WINDOWS_SERVICE_ACCOUNT_PASSWORD';
const rotationPasswordEnv = 'CODEXWINMUX_WINDOWS_SERVICE_ACCOUNT_ROTATION_PASSWORD';

const readEnv = (env: Record<string, string | undefined>, key: string): string | undefined => {
  const value = env[key]?.trim();
  return value ? value : undefined;
};

const inferLocalAppData = (
  env: Record<string, string | undefined>,
  sourceUserProfile: string,
): string =>
  readEnv(env, 'LOCALAPPDATA')
  || path.win32.join(sourceUserProfile, 'AppData', 'Local');

export const resolveWindowsServiceAccountMigrationPlan = ({
  env = process.env,
  repoRoot = process.cwd(),
  accountName = defaultAccountName,
  sourceUserProfile = readEnv(env, 'USERPROFILE') || 'C:\\Users\\yohan',
  serviceProfileRoot = path.win32.join(readEnv(env, 'ProgramData') || 'C:\\ProgramData', 'codexwinmux', 'service-profile'),
}: IWindowsServiceAccountMigrationPlanInput = {}): IWindowsServiceAccountMigrationPlan => {
  const serviceLocalAppData = path.win32.join(serviceProfileRoot, 'AppData', 'Local');
  const serviceAppData = path.win32.join(serviceProfileRoot, 'AppData', 'Roaming');
  const sourceLocalAppData = inferLocalAppData(env, sourceUserProfile);
  const releaseDir = path.win32.join(repoRoot, 'release', 'win-unpacked');
  const serviceDir = path.win32.join(sourceLocalAppData, 'codexwinmux', 'service');

  return {
    account: {
      name: accountName,
      qualifiedName: `.\\${accountName}`,
      passwordEnv,
      rotationPasswordEnv,
    },
    secretValuesPresent: Boolean(readEnv(env, passwordEnv) || readEnv(env, rotationPasswordEnv)),
    profile: {
      root: serviceProfileRoot,
      userProfile: serviceProfileRoot,
      localAppData: serviceLocalAppData,
      appData: serviceAppData,
    },
    environment: {
      HOME: serviceProfileRoot,
      USERPROFILE: serviceProfileRoot,
      LOCALAPPDATA: serviceLocalAppData,
      APPDATA: serviceAppData,
    },
    migrations: [
      {
        id: 'codex-credential-session-migration',
        source: path.win32.join(sourceUserProfile, '.codex'),
        target: path.win32.join(serviceProfileRoot, '.codex'),
        sensitive: true,
        requiresExplicitCredentialCopy: true,
      },
      {
        id: 'codexwinmux-runtime-data-migration',
        source: path.win32.join(sourceUserProfile, '.codexwinmux'),
        target: path.win32.join(serviceProfileRoot, '.codexwinmux'),
        sensitive: true,
        requiresExplicitCredentialCopy: false,
      },
    ],
    aclTargets: [
      {
        path: serviceProfileRoot,
        rights: 'Modify',
        reason: 'service profile, Codex credentials, sessions, and codexwinmux runtime data',
      },
      {
        path: releaseDir,
        rights: 'ReadAndExecute',
        reason: 'packaged executable and runtime assets',
      },
      {
        path: serviceDir,
        rights: 'ReadAndExecute',
        reason: 'WinSW wrapper binaries and XML configs',
      },
    ],
    rotation: {
      supported: true,
      restartRequired: true,
      passwordEnv: rotationPasswordEnv,
    },
    smokeGates: [
      {
        id: 'health',
        command: 'corepack pnpm windows:service:health',
        mutatesSystem: false,
      },
      {
        id: 'upgrade',
        command: 'corepack pnpm smoke:windows:updater-local-feed',
        mutatesSystem: true,
      },
      {
        id: 'uninstall',
        command: 'corepack pnpm smoke:windows:installer-install',
        mutatesSystem: true,
      },
      {
        id: 'reboot',
        command: 'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows-service-account.ps1 verify-reboot-readiness',
        mutatesSystem: false,
      },
    ],
  };
};

export const validateWindowsServiceAccountMigrationPlan = (
  plan: IWindowsServiceAccountMigrationPlan,
): IWindowsServiceAccountMigrationValidation => {
  const failures: string[] = [];
  if (!plan.account.name) failures.push('missing-account-name');
  if (!plan.account.qualifiedName.startsWith('.\\')) failures.push('account-must-be-local');
  if (plan.profile.root !== plan.environment.HOME) failures.push('profile-home-mismatch');
  if (!plan.migrations.some((migration) => migration.id === 'codex-credential-session-migration')) {
    failures.push('missing-codex-credential-session-migration');
  }
  if (!plan.migrations.some((migration) => migration.id === 'codexwinmux-runtime-data-migration')) {
    failures.push('missing-codexwinmux-runtime-data-migration');
  }
  if (!plan.aclTargets.some((target) => target.rights === 'Modify')) failures.push('missing-modify-acl');
  if (!plan.aclTargets.some((target) => target.rights === 'ReadAndExecute')) failures.push('missing-read-execute-acl');
  for (const id of ['health', 'upgrade', 'uninstall', 'reboot'] as const) {
    if (!plan.smokeGates.some((gate) => gate.id === id)) failures.push(`missing-smoke-gate:${id}`);
  }
  return {
    ok: failures.length === 0,
    failures,
  };
};
