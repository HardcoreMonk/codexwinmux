import { collectStrictIdentityLegacyEnvKeys } from './env-alias-lib.mjs';

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const toBlocker = (ruleId, message, detail = undefined) => ({
  ruleId,
  message,
  ...(detail ? { detail } : {}),
});

const includesCodexwinmux = (value) => normalizeText(value).toLowerCase().includes('codexwinmux');

export const evaluateCodexwinmuxStrictIdentity = ({
  packageJson = {},
  builderConfig = {},
  env = {},
} = {}) => {
  const checks = [];
  const blockers = [];
  const bin = packageJson.bin ?? {};

  if (packageJson.name === 'codexwinmux') {
    checks.push('strict-identity-package-name-codexwinmux');
  } else {
    blockers.push(toBlocker(
      'strict-identity-package-name-mismatch',
      'package.json name must be codexwinmux.',
      packageJson.name,
    ));
  }

  if (bin.codexwinmux && bin.cwmux) {
    checks.push('strict-identity-preferred-cli-aliases-present');
  } else {
    blockers.push(toBlocker(
      'strict-identity-preferred-cli-aliases-missing',
      'package.json bin must expose codexwinmux and cwmux aliases.',
    ));
  }

  const repositoryUrl = typeof packageJson.repository === 'object'
    ? packageJson.repository?.url
    : packageJson.repository;
  const bugsUrl = typeof packageJson.bugs === 'object' ? packageJson.bugs?.url : packageJson.bugs;
  if ([repositoryUrl, packageJson.homepage, bugsUrl].every(includesCodexwinmux)) {
    checks.push('strict-identity-repository-codexwinmux');
  } else {
    blockers.push(toBlocker(
      'strict-identity-repository-mismatch',
      'Repository, homepage, and bugs URLs must point at codexwinmux.',
    ));
  }

  if (builderConfig.productName === 'codexwinmux' && includesCodexwinmux(builderConfig.appId)) {
    checks.push('strict-identity-builder-product-codexwinmux');
  } else {
    blockers.push(toBlocker(
      'strict-identity-builder-product-mismatch',
      'electron-builder appId and productName must use codexwinmux.',
    ));
  }

  if (builderConfig.publish?.repo === 'codexwinmux') {
    checks.push('strict-identity-publish-repo-codexwinmux');
  } else {
    blockers.push(toBlocker(
      'strict-identity-publish-repo-mismatch',
      'electron-builder publish.repo must be codexwinmux.',
      builderConfig.publish?.repo,
    ));
  }

  if (builderConfig.nsis?.artifactName === '${productName}-Setup-${version}.${ext}') {
    checks.push('strict-identity-installer-name-derived-from-product');
  } else {
    blockers.push(toBlocker(
      'strict-identity-installer-name-unstable',
      'NSIS artifactName must derive from productName.',
      builderConfig.nsis?.artifactName,
    ));
  }

  checks.push('strict-identity-preferred-env-aliases-present');

  if (env.CODEXWINMUX_STRICT_IDENTITY === '1') {
    const legacyEnvKeys = collectStrictIdentityLegacyEnvKeys(env);
    if (legacyEnvKeys.length > 0) {
      blockers.push(toBlocker(
        'strict-identity-legacy-env-present',
        'Strict identity canary must be driven by CODEXWINMUX_* env keys, not CODEXMUX_* external inputs.',
        legacyEnvKeys,
      ));
    } else {
      checks.push('strict-identity-no-legacy-external-env');
    }
  }

  return {
    ok: blockers.length === 0,
    mutatesSystem: false,
    checks,
    blockers,
  };
};
