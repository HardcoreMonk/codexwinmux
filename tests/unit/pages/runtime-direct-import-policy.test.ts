import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const apiRoot = path.join(repoRoot, 'src', 'pages', 'api');
const backendEntrypointFiles = [
  path.join(repoRoot, 'server.ts'),
  path.join(repoRoot, 'src', 'lib', 'core-engine', 'runtime-api.ts'),
];
const apiFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return apiFiles(fullPath);
    return entry.isFile() && /\.(ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });

describe('runtime direct import policy', () => {
  it('keeps backend entrypoints and Core client adapter from importing the runtime supervisor directly', () => {
    const offenders = [...backendEntrypointFiles, ...apiFiles(apiRoot)].flatMap((filePath) => {
      const source = fs.readFileSync(filePath, 'utf8');
      return /(?:@\/lib\/runtime\/supervisor|\.\.\/.*runtime\/supervisor|getRuntimeSupervisor)/.test(source)
        ? [path.relative(repoRoot, filePath)]
        : [];
    });

    expect(offenders).toEqual([]);
  });
});
