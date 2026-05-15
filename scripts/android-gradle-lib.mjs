import path from 'node:path';
import { existsSync } from 'node:fs';

const windowsJavaHomeCandidates = [
  'C:\\Program Files\\Android\\openjdk\\jdk-21.0.8',
  'C:\\Program Files\\Android\\Android Studio\\jbr',
  'C:\\Program Files\\Android\\Android Studio\\jre',
];

const windowsAndroidHomeCandidates = [
  'C:\\Program Files (x86)\\Android\\android-sdk',
  path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'),
];

const firstExistingDir = (candidates) =>
  candidates.find((candidate) => candidate && existsSync(candidate)) || null;

export const buildAndroidGradleInvocation = ({
  rootDir = process.cwd(),
  platform = process.platform,
  env = process.env,
  args = [],
} = {}) => {
  const androidDir = path.join(rootDir, 'android');
  const command = platform === 'win32' ? 'gradlew.bat' : './gradlew';
  const nextEnv = { ...env };

  if (platform === 'win32') {
    nextEnv.JAVA_HOME = nextEnv.JAVA_HOME || firstExistingDir(windowsJavaHomeCandidates) || nextEnv.JAVA_HOME;
    nextEnv.ANDROID_HOME = nextEnv.ANDROID_HOME || nextEnv.ANDROID_SDK_ROOT || firstExistingDir(windowsAndroidHomeCandidates) || nextEnv.ANDROID_HOME;
    nextEnv.ANDROID_SDK_ROOT = nextEnv.ANDROID_SDK_ROOT || nextEnv.ANDROID_HOME;
  }

  const pathParts = [];
  if (nextEnv.JAVA_HOME) pathParts.push(path.join(nextEnv.JAVA_HOME, 'bin'));
  if (nextEnv.ANDROID_HOME) pathParts.push(path.join(nextEnv.ANDROID_HOME, 'platform-tools'));
  pathParts.push(nextEnv.PATH || nextEnv.Path || '');
  nextEnv.PATH = pathParts.filter(Boolean).join(path.delimiter);

  return {
    command,
    args,
    cwd: androidDir,
    env: nextEnv,
  };
};
