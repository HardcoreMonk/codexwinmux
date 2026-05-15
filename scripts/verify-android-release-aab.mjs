#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(__dirname);
const androidDir = path.join(rootDir, 'android');
const packageJsonPath = path.join(rootDir, 'package.json');
const propertiesPath = path.join(androidDir, 'keystore.properties');
const defaultAabPath = path.join(androidDir, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
const aabPath = process.env.CODEXMUX_ANDROID_RELEASE_AAB || defaultAabPath;
const supportsPosixSecretMode = process.platform !== 'win32';

const fail = (code, message, details = {}) => {
  console.error(JSON.stringify({ ok: false, code, message, ...details }, null, 2));
  process.exit(1);
};

const run = (cmd, args, options = {}) => {
  const result = spawnSync(cmd, args, {
    cwd: rootDir,
    encoding: 'utf8',
    ...options,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  };
};

const readProperties = (filePath) => {
  const raw = fs.readFileSync(filePath, 'utf8');
  return Object.fromEntries(raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=');
      return index === -1 ? [line, ''] : [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }));
};

const isIgnoredByGit = (filePath) => {
  const result = run('git', ['check-ignore', '-q', filePath]);
  return result.status === 0;
};

const collectFileStats = (inputPath) => {
  if (!fs.existsSync(inputPath)) return [];
  const stat = fs.statSync(inputPath);
  if (stat.isFile()) return [stat];
  if (!stat.isDirectory()) return [];
  return fs.readdirSync(inputPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(inputPath, entry.name);
    if (entry.name === '.gradle' || entry.name === 'build') return [];
    if (entry.isDirectory()) return collectFileStats(entryPath);
    return entry.isFile() ? [fs.statSync(entryPath)] : [];
  });
};

const assertSecretFile = (filePath, label) => {
  if (!fs.existsSync(filePath)) {
    fail(`${label}-missing`, `${label} is missing`, { path: path.relative(rootDir, filePath) });
  }
  const stat = fs.statSync(filePath);
  if (supportsPosixSecretMode && (stat.mode & 0o077) !== 0) {
    fail(`${label}-permissions-too-open`, `${label} must not be readable by group or others`, {
      path: path.relative(rootDir, filePath),
      mode: (stat.mode & 0o777).toString(8).padStart(3, '0'),
      expected: '600',
    });
  }
  if (!isIgnoredByGit(filePath)) {
    fail(`${label}-not-gitignored`, `${label} must be ignored by git`, {
      path: path.relative(rootDir, filePath),
    });
  }
};

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const versionParts = String(packageJson.version).split('.').map((part) => Number.parseInt(part, 10) || 0);
while (versionParts.length < 3) versionParts.push(0);
const expectedVersionCode = (versionParts[0] * 10000) + (versionParts[1] * 100) + versionParts[2];
const expectedVersionName = String(packageJson.version).replace(/\.0$/, '');

assertSecretFile(propertiesPath, 'keystore.properties');
const properties = readProperties(propertiesPath);
for (const key of ['storeFile', 'storePassword', 'keyAlias', 'keyPassword']) {
  if (!properties[key]) fail('keystore-property-missing', `keystore.properties is missing ${key}`);
}

const keystorePath = path.isAbsolute(properties.storeFile)
  ? properties.storeFile
  : path.join(androidDir, properties.storeFile);
assertSecretFile(keystorePath, 'release.keystore');

if (!fs.existsSync(aabPath)) {
  fail('android-release-aab-missing', 'release AAB is missing', {
    path: path.relative(rootDir, aabPath),
    buildCommand: 'corepack pnpm android:bundle:release',
  });
}

const aabStat = fs.statSync(aabPath);
if (aabStat.size < 1024 * 1024) {
  fail('android-release-aab-too-small', 'release AAB is unexpectedly small', {
    path: path.relative(rootDir, aabPath),
    bytes: aabStat.size,
  });
}

const sourceStats = [
  path.join(rootDir, 'capacitor.config.ts'),
  path.join(rootDir, 'android-web'),
  path.join(androidDir, 'build.gradle'),
  path.join(androidDir, 'variables.gradle'),
  path.join(androidDir, 'app', 'build.gradle'),
  path.join(androidDir, 'app', 'src', 'main'),
  packageJsonPath,
].flatMap(collectFileStats);
const newestSourceMtime = Math.max(...sourceStats.map((stat) => stat.mtimeMs));
if (aabStat.mtimeMs < newestSourceMtime) {
  fail('android-release-aab-stale', 'release AAB is older than Android release inputs', {
    path: path.relative(rootDir, aabPath),
    buildCommand: 'corepack pnpm android:bundle:release',
  });
}

const jarList = run('jar', ['tf', aabPath]);
if (jarList.error || jarList.status !== 0) {
  fail('android-release-aab-list-failed', 'failed to inspect release AAB entries', {
    status: jarList.status,
    stderr: jarList.stderr.trim(),
  });
}
const entries = new Set(jarList.stdout.split(/\r?\n/).filter(Boolean));
const requiredEntries = [
  'BundleConfig.pb',
  'base/manifest/AndroidManifest.xml',
  'base/dex/classes.dex',
  'base/assets/native-bridge.js',
  'base/assets/public/index.html',
  'META-INF/MANIFEST.MF',
];
const missingEntries = requiredEntries.filter((entry) => !entries.has(entry));
if (missingEntries.length > 0) {
  fail('android-release-aab-entry-missing', 'release AAB is missing required entries', { missingEntries });
}

const verify = run('jarsigner', ['-verify', aabPath]);
if (verify.error || verify.status !== 0 || !verify.stdout.includes('jar verified.')) {
  fail('android-release-aab-signature-invalid', 'release AAB signature verification failed', {
    status: verify.status,
    stderr: verify.stderr.trim(),
  });
}

console.log(JSON.stringify({
  ok: true,
  aabPath: path.relative(rootDir, aabPath),
  bytes: aabStat.size,
  expectedVersionName,
  expectedVersionCode,
  checks: [
    'keystore-properties-present',
    supportsPosixSecretMode ? 'secret-file-permissions-600' : 'secret-file-permissions-posix-skipped-on-windows',
    'secret-files-gitignored',
    'aab-present-and-fresh',
    'aab-required-entries',
    'jarsigner-verify',
  ],
}, null, 2));
