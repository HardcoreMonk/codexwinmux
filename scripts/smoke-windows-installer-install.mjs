#!/usr/bin/env node
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import {
  buildNsisSilentInstallArgs,
  cleanupStaleCodexwinmuxSmokeUninstallEntries,
  findWindowsInstaller,
  resolveInstalledAppPaths,
} from './windows-installer-smoke-lib.mjs';
import { writeSmokeArtifact } from './smoke-artifact-lib.mjs';
import { buildWindowsInstallerArtifactPayload } from './windows-package-smoke-artifact-lib.mjs';

const rootDir = process.cwd();
const DEFAULT_TIMEOUT_MS = 300_000;
const SMOKE_NAME = 'windows-installer-install';
const startedAt = new Date().toISOString();

const resolveSmokeName = (payload) =>
  payload?.runtimeV2Terminal || payload?.runtimeV2TerminalRequested
    ? 'windows-installer-runtime-v2'
    : SMOKE_NAME;

const writeArtifact = async (status, payload) =>
  writeSmokeArtifact({
    smokeName: resolveSmokeName(payload),
    status,
    startedAt,
    payload: buildWindowsInstallerArtifactPayload(payload),
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

const assertExists = async (filePath, checkName, checks) => {
  await fs.access(filePath);
  checks.push(checkName);
};

const main = async () => {
  if (process.platform !== 'win32') {
    await fail('windows-installer-platform-mismatch', 'Windows installer smoke requires win32.', {
      platform: process.platform,
    });
  }

  const installerPath = path.resolve(
    process.env.CODEXMUX_WINDOWS_INSTALLER_PATH
    || findWindowsInstaller(path.join(rootDir, 'release'))
    || '',
  );
  const smokeRoot = process.env.CODEXMUX_WINDOWS_INSTALLER_SMOKE_ROOT
    || await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-installer-smoke-'));
  const installDir = process.env.CODEXMUX_WINDOWS_INSTALL_DIR
    || path.join(smokeRoot, 'app');
  const checks = [];
  let installResult = null;
  let launchResult = null;
  let uninstallResult = null;
  let failurePayload = null;
  const runRuntimeV2Terminal = process.argv.includes('--runtime-v2-terminal')
    || process.env.CODEXMUX_WINDOWS_INSTALLER_RUNTIME_V2 === '1'
    || process.env.CODEXMUX_WINDOWS_PACKAGED_RUNTIME_V2 === '1';
  const paths = resolveInstalledAppPaths(installDir);

  try {
    if (!installerPath) throw new Error('Windows installer not found under release/.');
    await fs.access(installerPath);
    checks.push('installer-present');

    const preInstallRegistryCleanup = cleanupStaleCodexwinmuxSmokeUninstallEntries();
    if (preInstallRegistryCleanup.removed.length > 0) {
      checks.push('stale-uninstall-registry-cleanup');
    }

    installResult = await runCommand(installerPath, buildNsisSilentInstallArgs(installDir), {
      timeoutMs: Number(process.env.CODEXMUX_WINDOWS_INSTALLER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    });
    if (installResult.exitCode !== 0 || installResult.timedOut) {
      throw new Error(`installer failed: ${JSON.stringify({
        exitCode: installResult.exitCode,
        signal: installResult.signal,
        timedOut: installResult.timedOut,
        stderr: installResult.stderr.slice(-1200),
      })}`);
    }
    checks.push('silent-install');

    await assertExists(paths.appExe, 'installed-exe-present', checks);
    await assertExists(paths.appAsar, 'installed-app-asar-present', checks);
    await assertExists(paths.uninstaller, 'uninstaller-present', checks);

    if (process.env.CODEXMUX_WINDOWS_INSTALLER_SKIP_LAUNCH !== '1') {
      launchResult = await runCommand(process.execPath, ['scripts/smoke-windows-packaged-launch.mjs'], {
        env: {
          ...process.env,
          CODEXMUX_WINDOWS_PACKAGED_APP_PATH: paths.appExe,
          CODEXMUX_WINDOWS_PACKAGED_LAUNCH_HOME: path.join(smokeRoot, 'home'),
          ...(runRuntimeV2Terminal ? { CODEXMUX_WINDOWS_PACKAGED_RUNTIME_V2: '1' } : {}),
        },
        timeoutMs: 90_000,
      });
      if (launchResult.exitCode !== 0 || launchResult.timedOut) {
        throw new Error(`installed app launch smoke failed: ${JSON.stringify({
          exitCode: launchResult.exitCode,
          signal: launchResult.signal,
          timedOut: launchResult.timedOut,
          stderr: launchResult.stderr.slice(-1600),
          stdout: launchResult.stdout.slice(-1600),
        })}`);
      }
      checks.push('installed-app-launch-smoke');
    }

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
    cleanupStaleCodexwinmuxSmokeUninstallEntries();

    const successPayload = {
      ok: true,
      mutatesSystem: true,
      installerPath,
      installDir,
      checks,
      runtimeV2Terminal: runRuntimeV2Terminal,
      runtimeV2TerminalRequested: runRuntimeV2Terminal,
      launch: launchResult?.stdout ? JSON.parse(launchResult.stdout) : null,
    };
    await writeArtifact('passed', successPayload);
    console.log(JSON.stringify(successPayload, null, 2));
  } catch (err) {
    failurePayload = {
      ok: false,
      code: 'windows-installer-install-smoke-failed',
      message: err instanceof Error ? err.message : String(err),
      installerPath,
      installDir,
      checks,
      runtimeV2TerminalRequested: runRuntimeV2Terminal,
      installResult,
      launchResult,
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
