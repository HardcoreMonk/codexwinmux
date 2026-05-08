#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { validateWindowsElectronPackaging } from './windows-electron-packaging-smoke-lib.mjs';

const root = process.cwd();

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const readYaml = (filePath) => yaml.load(fs.readFileSync(filePath, 'utf8'));

const collectResourceFiles = (dir) => {
  const resources = new Set();
  const visit = (current) => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (entry.isFile()) {
        resources.add(path.relative(root, fullPath).replace(/\\/g, '/'));
      }
    }
  };
  visit(dir);
  return resources;
};

const packageJson = readJson(path.join(root, 'package.json'));
const builderConfig = readYaml(path.join(root, 'electron-builder.yml'));
const nsisIncludePath = typeof builderConfig.nsis?.include === 'string'
  ? path.join(root, builderConfig.nsis.include)
  : null;
const result = validateWindowsElectronPackaging({
  packageJson,
  builderConfig,
  resources: collectResourceFiles(path.join(root, 'build-resources')),
  nsisIncludeText: nsisIncludePath && fs.existsSync(nsisIncludePath) ? fs.readFileSync(nsisIncludePath, 'utf8') : '',
});

const output = {
  ok: result.ok,
  mutatesSystem: false,
  checks: result.checks,
  blockers: result.blockers,
  packageScripts: {
    packElectron: packageJson.scripts?.['pack:electron'],
    packElectronDev: packageJson.scripts?.['pack:electron:dev'],
    packElectronMac: packageJson.scripts?.['pack:electron:mac'] ?? null,
  },
  windowsTargets: result.ok
    ? builderConfig.win.target
    : builderConfig.win?.target ?? null,
  windowsIcon: builderConfig.win?.icon ?? null,
};

console.log(JSON.stringify(output, null, 2));

if (!result.ok) process.exit(1);
