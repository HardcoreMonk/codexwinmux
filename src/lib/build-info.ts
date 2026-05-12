import fs from 'node:fs';
import path from 'node:path';
import packageJson from '../../package.json';

interface IBuildInfoFile {
  commit?: string | null;
  buildTime?: string | null;
}

export interface IBuildInfo {
  app: 'codexwinmux';
  version: string;
  commit: string | null;
  buildTime: string | null;
}

let cachedFileInfo: IBuildInfoFile | undefined;

const resolveBuildInfoDir = (): string =>
  process.env.__CMUX_APP_DIR || process.cwd();

const readBuildInfoFile = (): IBuildInfoFile => {
  if (cachedFileInfo) return cachedFileInfo;

  const filePath = path.join(resolveBuildInfoDir(), 'dist', 'build-info.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as IBuildInfoFile;
    cachedFileInfo = {
      commit: typeof parsed.commit === 'string' ? parsed.commit : null,
      buildTime: typeof parsed.buildTime === 'string' ? parsed.buildTime : null,
    };
  } catch {
    cachedFileInfo = {};
  }

  return cachedFileInfo;
};

export const getBuildInfo = (): IBuildInfo => {
  const fileInfo = readBuildInfoFile();

  return {
    app: 'codexwinmux',
    version: packageJson.version,
    commit: process.env.NEXT_PUBLIC_COMMIT_HASH || process.env.COMMIT_HASH || fileInfo.commit || null,
    buildTime: process.env.NEXT_PUBLIC_BUILD_TIME || process.env.BUILD_TIME || fileInfo.buildTime || null,
  };
};
