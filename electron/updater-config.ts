export interface IAutoUpdaterRuntimeDefaultsTarget {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  disableWebInstaller: boolean;
}

export const applyAutoUpdaterRuntimeDefaults = (updater: IAutoUpdaterRuntimeDefaultsTarget): void => {
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.disableWebInstaller = true;
};
