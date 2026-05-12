#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));

const readGit = (args) => {
  try {
    return execFileSync('git', args, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
};

const info = {
  app: 'codexwinmux',
  version: pkg.version,
  commit: process.env.NEXT_PUBLIC_COMMIT_HASH || process.env.COMMIT_HASH || readGit(['rev-parse', '--short', 'HEAD']),
  buildTime: process.env.NEXT_PUBLIC_BUILD_TIME || process.env.BUILD_TIME || new Date().toISOString(),
};

const outputPath = path.join(rootDir, 'dist', 'build-info.json');
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(info, null, 2)}\n`);
console.log(`[build-info] wrote ${path.relative(rootDir, outputPath)} (${info.version}, ${info.commit ?? 'no-commit'})`);
