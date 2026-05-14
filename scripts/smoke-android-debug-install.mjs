#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ANDROID_ACTIVITY,
  DEFAULT_ANDROID_APP_ID,
  findAdb,
} from './android-webview-smoke-lib.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appId = DEFAULT_ANDROID_APP_ID;
const activity = DEFAULT_ANDROID_ACTIVITY;

const fail = (code, message, details = {}) => {
  console.error(JSON.stringify({ ok: false, code, message, ...details }, null, 2));
  process.exit(1);
};

const run = (command, args) => {
  try {
    return execFileSync(command, args, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    fail('android-smoke-command-failed', `${command} ${args.join(' ')} failed`, {
      status: err.status,
      stdout: err.stdout?.toString?.() ?? '',
      stderr: err.stderr?.toString?.() ?? '',
    });
  }
};

const parseVersion = (version) => {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) fail('android-smoke-version-unsupported', `unsupported package version: ${version}`);
  return match.slice(1).map((part) => Number(part));
};

const androidVersionName = (version) => version.replace(/\.0$/, '');

const androidVersionCode = (version) => {
  const [major, minor, patch] = parseVersion(version);
  return String((major * 10000) + (minor * 100) + patch);
};

const adb = findAdb();
const pkg = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const expectedVersionName = androidVersionName(pkg.version);
const expectedVersionCode = androidVersionCode(pkg.version);

const devicesOutput = run(adb, ['devices']);
const devices = devicesOutput
  .split('\n')
  .slice(1)
  .map((line) => line.trim().split(/\s+/))
  .filter(([serial, state]) => serial && state === 'device')
  .map(([serial]) => serial);

const serial = process.env.ANDROID_SERIAL;
if (serial && !devices.includes(serial)) {
  fail('android-smoke-device-not-found', `ANDROID_SERIAL is not connected: ${serial}`, { devices });
}
if (!serial && devices.length !== 1) {
  fail('android-smoke-device-selection-required', 'expected exactly one connected Android device or ANDROID_SERIAL', { devices });
}

const adbArgs = serial ? ['-s', serial] : [];
const adbShell = (args) => run(adb, [...adbArgs, 'shell', ...args]);

const packagePath = adbShell(['pm', 'path', appId]);
if (!packagePath.startsWith('package:')) {
  fail('android-smoke-package-missing', `${appId} is not installed`, { packagePath });
}

const packageInfo = adbShell(['dumpsys', 'package', appId]);
const versionName = packageInfo.match(/versionName=([^\s]+)/)?.[1] ?? null;
const versionCode = packageInfo.match(/versionCode=(\d+)/)?.[1] ?? null;
const lastUpdateTime = packageInfo.match(/lastUpdateTime=([^\n]+)/)?.[1]?.trim() ?? null;

if (versionName !== expectedVersionName) {
  fail('android-smoke-version-name-mismatch', 'installed Android versionName does not match package.json', {
    expectedVersionName,
    versionName,
  });
}

if (versionCode !== expectedVersionCode) {
  fail('android-smoke-version-code-mismatch', 'installed Android versionCode does not match package.json', {
    expectedVersionCode,
    versionCode,
  });
}

const resolvedActivity = adbShell(['cmd', 'package', 'resolve-activity', '--brief', appId]);
if (!resolvedActivity.includes(activity)) {
  fail('android-smoke-launcher-activity-mismatch', 'launcher activity did not resolve to MainActivity', {
    expectedActivity: activity,
    resolvedActivity,
  });
}

console.log(JSON.stringify({
  ok: true,
  adb,
  serial: serial ?? devices[0],
  appId,
  packagePath,
  versionName,
  versionCode,
  lastUpdateTime,
  resolvedActivity,
}, null, 2));
