import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const apiRoot = path.join(repoRoot, 'src', 'pages', 'api');
const backendEntrypointFiles = [
  path.join(repoRoot, 'server.ts'),
  path.join(repoRoot, 'src', 'lib', 'layout-store.ts'),
  path.join(repoRoot, 'src', 'lib', 'workspace-store.ts'),
  path.join(repoRoot, 'src', 'lib', 'status-manager.ts'),
  path.join(repoRoot, 'src', 'lib', 'status-server.ts'),
  path.join(repoRoot, 'src', 'lib', 'status-session-history-adapter.ts'),
  path.join(repoRoot, 'src', 'lib', 'status-web-push-adapter.ts'),
  path.join(repoRoot, 'src', 'lib', 'tab-session-cleanup.ts'),
  path.join(repoRoot, 'src', 'lib', 'timeline-server.ts'),
  path.join(repoRoot, 'src', 'lib', 'core-engine', 'runtime-api.ts'),
];
const runtimeTimelineEntrypointFiles = [
  path.join(repoRoot, 'src', 'lib', 'runtime', 'timeline-ws.ts'),
  path.join(repoRoot, 'src', 'lib', 'runtime', 'timeline-live-shadow.ts'),
];
const apiFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return apiFiles(fullPath);
    return entry.isFile() && /\.(ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });

describe('runtime direct import policy', () => {
  it('keeps backend entrypoints, runtime timeline surfaces, and Core client adapter from importing the runtime supervisor directly', () => {
    const offenders = [...backendEntrypointFiles, ...runtimeTimelineEntrypointFiles, ...apiFiles(apiRoot)].flatMap((filePath) => {
      const source = fs.readFileSync(filePath, 'utf8');
      return /(?:@\/lib\/runtime\/supervisor|\.\.\/.*runtime\/supervisor|getRuntimeSupervisor)/.test(source)
        ? [path.relative(repoRoot, filePath)]
        : [];
    });

    expect(offenders).toEqual([]);
  });
});
