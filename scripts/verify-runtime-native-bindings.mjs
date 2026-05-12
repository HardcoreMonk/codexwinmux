#!/usr/bin/env node
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { readEnvAlias } from './env-alias-lib.mjs';

const root = process.cwd();
const electronMode = process.argv.includes('--electron');
const runtimeV2Enabled = readEnvAlias(process.env, 'CODEXMUX_RUNTIME_V2') === '1';
const standalone = path.join(root, '.next', 'standalone');
const standaloneModules = path.join(standalone, 'node_modules');
const standaloneTmuxConfig = path.join(standalone, 'src', 'config', 'tmux.conf');
const workerFiles = [
  path.join(root, 'dist', 'workers', 'storage-worker.js'),
  path.join(root, 'dist', 'workers', 'terminal-worker.js'),
];

const fail = (code, message, details = {}) => {
  console.error(JSON.stringify({ ok: false, code, message, ...details }, null, 2));
  process.exit(1);
};

const assertExists = (filePath, code, message) => {
  if (!fs.existsSync(filePath)) fail(code, message, { path: filePath });
};

const runtimeRequire = createRequire(path.join(standaloneModules, '__runtime-native-check__.js'));

const findNativeBindings = (dir) => {
  const bindings = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.node')) bindings.push(fullPath);
    }
  };
  visit(dir);
  return bindings;
};

const resolvePackage = (packageName) => {
  try {
    const packageJsonPath = runtimeRequire.resolve(`${packageName}/package.json`);
    const packageRoot = path.dirname(packageJsonPath);
    return {
      packageJsonPath,
      packageRoot,
      bindings: findNativeBindings(packageRoot),
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

const verifyNativePackage = (packageName, options = {}) => {
  const resolved = resolvePackage(packageName);
  if (resolved.error) {
    if (options.optional && !runtimeV2Enabled) {
      return { packageName, skipped: true, reason: resolved.error };
    }
    fail(options.missingCode ?? 'runtime-native-package-missing', `${packageName} is not available from standalone node_modules`, {
      packageName,
      standaloneModules,
      error: resolved.error,
    });
  }

  if (resolved.bindings.length === 0) {
    fail(options.missingBindingCode ?? 'runtime-native-binding-missing', `${packageName} has no native .node binding in standalone output`, {
      packageName,
      packageRoot: resolved.packageRoot,
    });
  }

  if (electronMode && resolved.packageRoot.includes(`${path.sep}app.asar${path.sep}`)) {
    fail('runtime-native-package-inside-app-asar', `${packageName} must resolve outside app.asar for Electron`, {
      packageName,
      packageRoot: resolved.packageRoot,
    });
  }

  return {
    packageName,
    packageRoot: resolved.packageRoot,
    bindings: resolved.bindings,
  };
};

assertExists(standalone, 'runtime-standalone-missing', 'Next standalone output is missing');
assertExists(standaloneModules, 'runtime-standalone-node-modules-missing', 'standalone node_modules is missing');
assertExists(standaloneTmuxConfig, 'runtime-v2-tmux-config-missing', 'standalone tmux config is missing');

for (const workerFile of workerFiles) {
  assertExists(workerFile, 'runtime-v2-worker-script-missing', 'runtime worker output is missing');
}

const packages = [
  verifyNativePackage('node-pty'),
  verifyNativePackage('better-sqlite3', {
    optional: true,
    missingCode: 'runtime-v2-sqlite-unavailable',
    missingBindingCode: 'runtime-v2-sqlite-unavailable',
  }),
];

console.log(JSON.stringify({
  ok: true,
  electronMode,
  standaloneModules,
  workers: workerFiles,
  tmuxConfig: standaloneTmuxConfig,
  electronAssumptions: electronMode
    ? {
        appDirUnpackedEnv: '__CMUX_APP_DIR_UNPACKED',
        packagedTmuxConfig: path.join('app.asar.unpacked', 'src', 'config', 'tmux.conf'),
      }
    : null,
  packages,
}, null, 2));
