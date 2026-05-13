const hasEnvValue = (value) => value !== undefined && value !== null && String(value) !== '';

export const preferredCodexwinmuxEnvKey = (legacyKey) =>
  String(legacyKey).replace(/^CODEXMUX_/, 'CODEXWINMUX_');

const isRuntimeLegacyKey = (legacyKey) =>
  String(legacyKey).startsWith('CODEXMUX_RUNTIME_');

export const readEnvAlias = (env, legacyKey) => {
  const preferredKey = preferredCodexwinmuxEnvKey(legacyKey);
  if (hasEnvValue(env?.[preferredKey])) return env[preferredKey];
  if (isRuntimeLegacyKey(legacyKey)) return undefined;
  return env?.[legacyKey];
};

export const buildEnvAlias = (legacyKey, value) => (
  isRuntimeLegacyKey(legacyKey)
    ? { [preferredCodexwinmuxEnvKey(legacyKey)]: value }
    : {
      [preferredCodexwinmuxEnvKey(legacyKey)]: value,
      [legacyKey]: value,
    }
);

export const stripLegacyRuntimeEnv = (env = {}) =>
  Object.fromEntries(
    Object.entries(env).filter(([key]) => !String(key).startsWith('CODEXMUX_RUNTIME_')),
  );

export const hasPreferredEnvAlias = (env, legacyKey) =>
  hasEnvValue(env?.[preferredCodexwinmuxEnvKey(legacyKey)]);

export const knownStrictIdentityLegacyEnvKeys = [
  'CODEXMUX_SMOKE_ARTIFACT_DIR',
  'CODEXMUX_SMARTSCREEN_EVIDENCE_PATH',
  'CODEXMUX_SMARTSCREEN_STATUS',
  'CODEXMUX_SMARTSCREEN_CHECKED_AT',
  'CODEXMUX_SMARTSCREEN_ENVIRONMENT',
  'CODEXMUX_SMARTSCREEN_PUBLIC_RELEASE',
  'CODEXMUX_SMARTSCREEN_DOWNLOAD_URL',
  'CODEXMUX_SMARTSCREEN_EXPECTED_SHA256',
  'CODEXMUX_SMARTSCREEN_PUBLIC_TIMEOUT_MS',
  'CODEXMUX_SMARTSCREEN_PUBLIC_SMOKE_ROOT',
  'CODEXMUX_SMARTSCREEN_PUBLIC_KEEP_ROOT',
  'CODEXMUX_SMARTSCREEN_PUBLIC_EVIDENCE_OUTPUT',
  'CODEXMUX_LEGACY_SUNSET',
  'CODEXMUX_WINDOWS_RELEASE_DIR',
  'CODEXMUX_WINDOWS_CERTIFICATE_SHA1',
  'CODEXMUX_WINDOWS_PUBLISHER_NAME',
  'CODEXMUX_WINDOWS_TIMESTAMP_SERVER',
  'CODEXMUX_WINDOWS_SIGNTOOL_PATH',
  'CODEXMUX_WINDOWS_SIGNING_INSTALLER_PATH',
  'CODEXMUX_WINDOWS_SIGNING_UNPACKED_EXE_PATH',
  'CODEXMUX_POWERSHELL_PATH',
  'CODEXMUX_ELECTRON_UPDATER_FEED_URL',
  'CODEXMUX_ELECTRON_UPDATER_SMOKE',
  'CODEXMUX_ELECTRON_UPDATER_SMOKE_STATUS_PATH',
  'CODEXMUX_ELECTRON_UPDATER_SMOKE_AUTO_DOWNLOAD',
  'CODEXMUX_ELECTRON_UPDATER_SMOKE_AUTO_INSTALL',
  'CODEXMUX_ELECTRON_UPDATER_SMOKE_INSTALL_DIR',
  'CODEXMUX_ELECTRON_UPDATER_DISABLE_DIFFERENTIAL',
  'CODEXMUX_WINDOWS_UPDATER_CURRENT_VERSION',
  'CODEXMUX_WINDOWS_UPDATER_BASE_INSTALLER_PATH',
  'CODEXMUX_WINDOWS_UPDATER_GITHUB_OWNER',
  'CODEXMUX_WINDOWS_UPDATER_GITHUB_REPO',
  'CODEXMUX_WINDOWS_UPDATER_GITHUB_TAG',
  'CODEXMUX_WINDOWS_UPDATER_GITHUB_FEED_POST_INSTALL_HOLD_MS',
];

export const collectStrictIdentityLegacyEnvKeys = (env) =>
  Object.keys(env || {})
    .filter((key) => (
      knownStrictIdentityLegacyEnvKeys.includes(key) ||
      /^CODEXMUX_(SMOKE|SMARTSCREEN|WINDOWS|ELECTRON|OPS_SMOKE|POWERSHELL|LEGACY|RUNTIME)_/.test(key)
    ))
    .filter((key) => hasEnvValue(env?.[key]))
    .sort();
