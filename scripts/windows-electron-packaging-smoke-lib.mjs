export const collectElectronBuilderTargets = (targetConfig) => {
  if (!targetConfig) return [];
  const targets = Array.isArray(targetConfig) ? targetConfig : [targetConfig];
  return targets
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object' && typeof entry.target === 'string') return entry.target;
      return null;
    })
    .filter(Boolean);
};

const hasElectronBuilderWin = (command) =>
  typeof command === 'string' && /\belectron-builder\b/.test(command) && /(?:^|\s)--win(?:\s|$)/.test(command);

const hasElectronBuilderWinDir = (command) =>
  hasElectronBuilderWin(command) && /(?:^|\s)--dir(?:\s|$)/.test(command);

const hasWindowsPackager = (command) =>
  hasElectronBuilderWin(command)
  || (typeof command === 'string' && /\bnode\s+scripts[\\/]pack-electron-windows\.mjs\b/.test(command));

const hasWindowsPackagerDir = (command) =>
  hasElectronBuilderWinDir(command)
  || (typeof command === 'string'
    && /\bnode\s+scripts[\\/]pack-electron-windows\.mjs\b/.test(command)
    && /(?:^|\s)--dir(?:\s|$)/.test(command));

const normalizePath = (value) => value.replace(/\\/g, '/');

const addBlocker = (blockers, ruleId, message) => {
  blockers.push({ ruleId, message });
};

const expectedNsisArtifactName = '${productName}-Setup-${version}.${ext}';

export const validateWindowsElectronPackaging = ({
  packageJson,
  builderConfig,
  resources,
  nsisIncludeText = '',
}) => {
  const blockers = [];
  const checks = [];
  const scripts = packageJson?.scripts ?? {};

  if (hasWindowsPackager(scripts['pack:electron'])) {
    checks.push('pack-electron-default-windows');
  } else {
    addBlocker(
      blockers,
      'pack-electron-default-not-windows',
      'pack:electron must be the Windows packaging command.',
    );
  }

  if (hasWindowsPackagerDir(scripts['pack:electron:dev'])) {
    checks.push('pack-electron-dev-windows-dir');
  } else {
    addBlocker(
      blockers,
      'pack-electron-dev-not-windows-dir',
      'pack:electron:dev must be the Windows unpacked packaging smoke command.',
    );
  }

  const winTargets = collectElectronBuilderTargets(builderConfig?.win?.target);
  const hasNsis = winTargets.includes('nsis');
  const hasZip = winTargets.includes('zip');
  if (hasNsis) checks.push('windows-builder-nsis-target');
  if (hasZip) checks.push('windows-builder-zip-target');
  if (!hasNsis || !hasZip) {
    addBlocker(
      blockers,
      'windows-builder-target-missing',
      'electron-builder win.target must include nsis and zip.',
    );
  }

  const nsis = builderConfig?.nsis;
  if (
    nsis?.oneClick === false
    && nsis?.perMachine === false
    && nsis?.allowToChangeInstallationDirectory === true
  ) {
    checks.push('windows-nsis-installer-options');
  } else {
    addBlocker(
      blockers,
      'windows-nsis-config-missing',
      'electron-builder nsis config must use an install wizard with per-user default install.',
    );
  }

  if (nsis?.runAfterFinish === false) {
    checks.push('windows-nsis-run-after-finish-disabled');
  } else {
    addBlocker(
      blockers,
      'windows-nsis-run-after-finish-enabled',
      'electron-builder nsis config must disable runAfterFinish for repeatable silent install smoke.',
    );
  }

  if (nsis?.artifactName === expectedNsisArtifactName) {
    checks.push('windows-nsis-artifact-name-stable');
  } else {
    addBlocker(
      blockers,
      'windows-nsis-artifact-name-unstable',
      'electron-builder nsis.artifactName must match latest.yml updater metadata.',
    );
  }

  const nsisInclude = typeof nsis?.include === 'string'
    ? normalizePath(nsis.include)
    : null;
  const installDetailsVisible = /\bShowInstDetails\s+show\b/i.test(nsisIncludeText);
  const uninstallDetailsVisible = /\bShowUninstDetails\s+show\b/i.test(nsisIncludeText);
  if (nsisInclude != null && resources.has(nsisInclude) && installDetailsVisible && uninstallDetailsVisible) {
    checks.push('windows-nsis-install-details-visible');
  } else if (nsis != null) {
    addBlocker(
      blockers,
      'windows-nsis-install-details-hidden',
      'electron-builder nsis include must keep install and uninstall detail panes visible.',
    );
  }

  const winIcon = typeof builderConfig?.win?.icon === 'string'
    ? normalizePath(builderConfig.win.icon)
    : null;
  if (winIcon?.endsWith('.ico') && resources.has(winIcon)) {
    checks.push('windows-icon-present');
  } else {
    addBlocker(
      blockers,
      'windows-icon-missing',
      'electron-builder win.icon must point to an existing .ico file.',
    );
  }

  return {
    ok: blockers.length === 0,
    checks,
    blockers,
  };
};
