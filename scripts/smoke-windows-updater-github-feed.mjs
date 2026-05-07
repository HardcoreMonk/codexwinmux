#!/usr/bin/env node
import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { getFreePort, sleep } from './android-webview-smoke-lib.mjs';
import { buildElectronSmokeLaunchCommand } from './electron-smoke-lib.mjs';
import { writeSmokeArtifact } from './smoke-artifact-lib.mjs';
import {
  buildNsisSilentInstallArgs,
  resolveInstalledAppPaths,
} from './windows-installer-smoke-lib.mjs';
import {
  buildWindowsUpdaterSmokeEnv,
  parseWindowsUpdaterStatusEvents,
  summarizeWindowsUpdaterStatusEvents,
} from './windows-updater-local-feed-smoke-lib.mjs';
import {
  buildWindowsUpdaterGitHubFeedArtifactPayload,
  buildWindowsUpdaterGitHubFeedUrl,
} from './windows-updater-github-feed-smoke-lib.mjs';

const rootDir = process.cwd();
const DEFAULT_TIMEOUT_MS = 300_000;
const STATUS_TIMEOUT_MS = 180_000;
const APP_EXIT_TIMEOUT_MS = 120_000;
const SMOKE_NAME = 'windows-updater-github-feed';
const startedAt = new Date().toISOString();

const writeArtifact = async (status, payload) =>
  writeSmokeArtifact({
    smokeName: SMOKE_NAME,
    status,
    startedAt,
    payload: buildWindowsUpdaterGitHubFeedArtifactPayload(payload),
  }).catch((err) => {
    console.error(JSON.stringify({
      ok: false,
      code: 'smoke-artifact-write-failed',
      message: err instanceof Error ? err.message : String(err),
    }, null, 2));
  });

const fail = async (code, message, details = {}) => {
  const payload = { ok: false, code, message, ...details };
  await writeArtifact('failed', payload);
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
};

const runCommand = (command, args, { cwd = rootDir, env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, signal: null, stdout, stderr: `${stderr}${err.message}`, timedOut });
    });
    child.once('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, stdout, stderr, timedOut });
    });
  });

const startCommand = (command, args, { cwd = rootDir, env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let settled = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, timeoutMs);

  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const settle = (resolve, result) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(result);
  };

  const result = new Promise((resolve) => {
    child.once('error', (err) => {
      settle(resolve, { exitCode: 1, signal: null, stdout, stderr: `${stderr}${err.message}`, timedOut });
    });
    child.once('exit', (exitCode, signal) => {
      settle(resolve, { exitCode, signal, stdout, stderr, timedOut });
    });
  });

  return { child, result };
};

const stopProcessTree = async (child) => {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.once('exit', resolve);
      killer.once('error', resolve);
    });
    return;
  }
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(5_000).then(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }),
  ]);
};

const readYamlIfExists = async (filePath) => {
  try {
    return yaml.load(await fs.readFile(filePath, 'utf8'));
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
};

const normalizePublishConfig = (publishConfig) => {
  if (Array.isArray(publishConfig)) return publishConfig[0] ?? null;
  return publishConfig && typeof publishConfig === 'object' ? publishConfig : null;
};

const readStatusEvents = async (statusPath) => {
  try {
    return parseWindowsUpdaterStatusEvents(await fs.readFile(statusPath, 'utf8'));
  } catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
};

const waitForUpdaterStatus = async (statusPath, timeoutMs = STATUS_TIMEOUT_MS) => {
  const deadline = Date.now() + timeoutMs;
  let lastSummary = summarizeWindowsUpdaterStatusEvents([]);
  while (Date.now() < deadline) {
    const events = await readStatusEvents(statusPath);
    lastSummary = summarizeWindowsUpdaterStatusEvents(events);
    const errorBlocker = lastSummary.blockers.find((blocker) => blocker.ruleId === 'updater-error-event');
    if (errorBlocker) throw new Error(errorBlocker.message);
    if (lastSummary.ok) return { events, summary: lastSummary };
    await sleep(500);
  }

  throw new Error(`updater status timed out; blockers=${lastSummary.blockers.map((blocker) => blocker.ruleId).join(',')}`);
};

const assertExists = async (filePath, checkName, checks) => {
  await fs.access(filePath);
  checks.push(checkName);
};

const runPostInstallLaunchSmoke = async ({ appExe, smokeRoot }) => {
  let lastResult = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    lastResult = await runCommand(process.execPath, ['scripts/smoke-windows-packaged-launch.mjs', '--runtime-v2-terminal'], {
      env: {
        ...process.env,
        CODEXMUX_ELECTRON_UPDATER_DISABLED: '1',
        CODEXMUX_WINDOWS_PACKAGED_APP_PATH: appExe,
        CODEXMUX_WINDOWS_PACKAGED_LAUNCH_HOME: path.join(smokeRoot, `post-update-home-${attempt}`),
        CODEXMUX_WINDOWS_PACKAGED_LAUNCH_HOLD_MS: process.env.CODEXMUX_WINDOWS_UPDATER_GITHUB_FEED_POST_INSTALL_HOLD_MS || '0',
      },
      timeoutMs: Number(process.env.CODEXMUX_WINDOWS_UPDATER_GITHUB_FEED_POST_INSTALL_TIMEOUT_MS || 180_000),
    });
    if (lastResult.exitCode === 0 && !lastResult.timedOut) return lastResult;
    await sleep(5_000);
  }
  return lastResult;
};

const runUpdaterInstallAttempt = async ({
  appExe,
  feedUrl,
  installDir,
  smokeRoot,
  attempt,
}) => {
  const updaterHomeDir = path.join(smokeRoot, `updater-home-${attempt}`);
  const statusPath = path.join(smokeRoot, `updater-status-${attempt}.jsonl`);
  await fs.mkdir(path.join(updaterHomeDir, 'AppData', 'Roaming'), { recursive: true });
  await fs.mkdir(path.join(updaterHomeDir, 'AppData', 'Local'), { recursive: true });

  const remoteDebuggingPort = await getFreePort();
  const launch = buildElectronSmokeLaunchCommand({
    remoteDebuggingPort,
    appPath: appExe,
    platform: process.platform,
  });
  const updateLaunch = startCommand(launch.command, launch.args, {
    cwd: path.dirname(appExe),
    env: buildWindowsUpdaterSmokeEnv({
      env: process.env,
      feedUrl,
      statusPath,
      installDir,
      homeDir: updaterHomeDir,
    }),
    timeoutMs: Number(process.env.CODEXMUX_WINDOWS_UPDATER_GITHUB_FEED_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  });

  try {
    const updaterStatus = await waitForUpdaterStatus(
      statusPath,
      Number(process.env.CODEXMUX_WINDOWS_UPDATER_GITHUB_FEED_STATUS_TIMEOUT_MS || STATUS_TIMEOUT_MS),
    );
    const updateLaunchResult = await Promise.race([
      updateLaunch.result,
      sleep(Number(process.env.CODEXMUX_WINDOWS_UPDATER_GITHUB_FEED_APP_EXIT_TIMEOUT_MS || APP_EXIT_TIMEOUT_MS)).then(() => ({
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: 'packaged app did not exit after quitAndInstall',
        timedOut: true,
      })),
    ]);

    if (updateLaunchResult.exitCode !== 0 || updateLaunchResult.timedOut) {
      throw new Error(`updater launch failed to exit cleanly: ${JSON.stringify({
        exitCode: updateLaunchResult.exitCode,
        signal: updateLaunchResult.signal,
        timedOut: updateLaunchResult.timedOut,
        stderr: updateLaunchResult.stderr.slice(-1600),
      })}`);
    }

    return {
      ok: true,
      statusSummary: updaterStatus.summary,
      updateLaunchResult,
    };
  } catch (err) {
    await stopProcessTree(updateLaunch.child);
    const events = await readStatusEvents(statusPath).catch(() => []);
    const updateLaunchResult = await Promise.race([
      updateLaunch.result,
      sleep(5_000).then(() => null),
    ]);
    return {
      ok: false,
      error: err,
      statusSummary: summarizeWindowsUpdaterStatusEvents(events),
      updateLaunchResult,
    };
  }
};

const resolveFeedUrl = async () => {
  if (process.env.CODEXMUX_WINDOWS_UPDATER_GITHUB_FEED_URL) {
    return process.env.CODEXMUX_WINDOWS_UPDATER_GITHUB_FEED_URL;
  }

  const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
  const builderConfig = await readYamlIfExists(path.join(rootDir, 'electron-builder.yml'));
  const publishConfig = normalizePublishConfig(builderConfig?.publish);

  return buildWindowsUpdaterGitHubFeedUrl({
    owner: process.env.CODEXMUX_WINDOWS_UPDATER_GITHUB_OWNER || publishConfig?.owner,
    repo: process.env.CODEXMUX_WINDOWS_UPDATER_GITHUB_REPO || publishConfig?.repo,
    tag: process.env.CODEXMUX_WINDOWS_UPDATER_GITHUB_TAG || `v${packageJson.version}`,
  });
};

const main = async () => {
  if (process.platform !== 'win32') {
    await fail('windows-updater-github-feed-platform-mismatch', 'Windows updater GitHub feed smoke requires win32.', {
      platform: process.platform,
    });
  }

  const baseInstallerPath = path.resolve(
    process.env.CODEXMUX_WINDOWS_UPDATER_BASE_INSTALLER_PATH
    || process.env.CODEXMUX_WINDOWS_INSTALLER_PATH
    || path.join(rootDir, 'release', 'codexmux-Setup-0.4.2.exe'),
  );
  const smokeRoot = process.env.CODEXMUX_WINDOWS_UPDATER_GITHUB_FEED_SMOKE_ROOT
    || await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-updater-github-feed-smoke-'));
  const installDir = process.env.CODEXMUX_WINDOWS_UPDATER_GITHUB_FEED_INSTALL_DIR
    || path.join(smokeRoot, 'app');
  const checks = [];
  let installResult = null;
  let updateLaunchResult = null;
  let postInstallLaunchResult = null;
  let uninstallResult = null;
  let statusSummary = null;
  let failurePayload = null;
  const paths = resolveInstalledAppPaths(installDir);

  try {
    const feedUrl = await resolveFeedUrl();
    checks.push('github-feed-url');
    await assertExists(baseInstallerPath, 'base-installer-present', checks);

    installResult = await runCommand(baseInstallerPath, buildNsisSilentInstallArgs(installDir), {
      timeoutMs: Number(process.env.CODEXMUX_WINDOWS_INSTALLER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    });
    if (installResult.exitCode !== 0 || installResult.timedOut) {
      throw new Error(`base installer failed: ${JSON.stringify({
        exitCode: installResult.exitCode,
        signal: installResult.signal,
        timedOut: installResult.timedOut,
        stderr: installResult.stderr.slice(-1200),
      })}`);
    }
    checks.push('silent-install-base-version');

    await assertExists(paths.appExe, 'installed-exe-present', checks);
    await assertExists(paths.appAsar, 'installed-app-asar-present', checks);
    await assertExists(paths.uninstaller, 'uninstaller-present', checks);

    const maxUpdaterAttempts = Number(process.env.CODEXMUX_WINDOWS_UPDATER_GITHUB_FEED_ATTEMPTS || 2);
    let updaterAttempt = null;
    for (let attempt = 1; attempt <= maxUpdaterAttempts; attempt += 1) {
      checks.push(attempt === 1 ? 'installed-app-github-updater-launch' : `installed-app-github-updater-retry-${attempt}`);
      updaterAttempt = await runUpdaterInstallAttempt({
        appExe: paths.appExe,
        feedUrl,
        installDir,
        smokeRoot,
        attempt,
      });
      if (updaterAttempt.ok) break;
    }
    if (!updaterAttempt?.ok) {
      statusSummary = updaterAttempt?.statusSummary ?? null;
      updateLaunchResult = updaterAttempt?.updateLaunchResult ?? null;
      throw updaterAttempt?.error ?? new Error('updater GitHub feed install attempt failed');
    }

    statusSummary = updaterAttempt.statusSummary;
    updateLaunchResult = updaterAttempt.updateLaunchResult;
    checks.push(...statusSummary.checks);
    checks.push('updater-app-exit-after-quit-and-install');

    postInstallLaunchResult = await runPostInstallLaunchSmoke({ appExe: paths.appExe, smokeRoot });
    if (postInstallLaunchResult.exitCode !== 0 || postInstallLaunchResult.timedOut) {
      throw new Error(`post-update installed app launch smoke failed: ${JSON.stringify({
        exitCode: postInstallLaunchResult.exitCode,
        signal: postInstallLaunchResult.signal,
        timedOut: postInstallLaunchResult.timedOut,
        stderr: postInstallLaunchResult.stderr.slice(-1600),
        stdout: postInstallLaunchResult.stdout.slice(-1600),
      })}`);
    }
    checks.push('post-update-installed-app-runtime-v2-smoke');

    uninstallResult = await runCommand(paths.uninstaller, ['/S'], { timeoutMs: 90_000 });
    if (uninstallResult.exitCode !== 0 || uninstallResult.timedOut) {
      throw new Error(`uninstaller failed: ${JSON.stringify({
        exitCode: uninstallResult.exitCode,
        signal: uninstallResult.signal,
        timedOut: uninstallResult.timedOut,
        stderr: uninstallResult.stderr.slice(-1200),
      })}`);
    }
    checks.push('silent-uninstall');

    const successPayload = {
      ok: true,
      mutatesSystem: true,
      feedUrl,
      installerPath: baseInstallerPath,
      installDir,
      checks,
      statusSummary,
      installResult,
      updateLaunchResult,
      postInstallLaunchResult,
      uninstallResult,
    };
    await writeArtifact('passed', successPayload);
    console.log(JSON.stringify(successPayload, null, 2));
  } catch (err) {
    failurePayload = {
      ok: false,
      code: 'windows-updater-github-feed-smoke-failed',
      message: err instanceof Error ? err.message : String(err),
      installerPath: baseInstallerPath,
      installDir,
      checks,
      blockers: statusSummary?.blockers ?? [],
      statusSummary,
      installResult,
      updateLaunchResult,
      postInstallLaunchResult,
      uninstallResult,
    };
  } finally {
    try {
      await fs.access(paths.uninstaller);
      uninstallResult = await runCommand(paths.uninstaller, ['/S'], { timeoutMs: 90_000 });
    } catch {
      // Nothing to uninstall.
    }
    await fs.rm(smokeRoot, { recursive: true, force: true }).catch(() => null);
  }

  if (failurePayload) {
    failurePayload.uninstallResult = uninstallResult;
    await writeArtifact('failed', failurePayload);
    console.error(JSON.stringify(failurePayload, null, 2));
    process.exit(1);
  }
};

main();
