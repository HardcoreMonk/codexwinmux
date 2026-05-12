import path from 'path';

export interface ITrayIconPathInput {
  platform?: NodeJS.Platform;
  isPackaged?: boolean;
  resourcesPath?: string;
  appPath?: string;
}

const getDefaultResourcesPath = (): string =>
  (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? process.cwd();

export const resolveTrayIconPath = ({
  platform = process.platform,
  isPackaged = false,
  resourcesPath = getDefaultResourcesPath(),
  appPath = process.cwd(),
}: ITrayIconPathInput = {}): string | null => {
  if (platform !== 'win32') return null;

  if (isPackaged) {
    return path.win32.join(resourcesPath, 'icon.ico');
  }

  return path.win32.join(appPath, 'build-resources', 'icon.ico');
};
