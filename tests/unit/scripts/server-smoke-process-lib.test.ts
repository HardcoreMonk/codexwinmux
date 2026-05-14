import { describe, expect, it } from 'vitest';
import path from 'path';
import { pathToFileURL } from 'url';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/server-smoke-process-lib.mjs')).href);

describe('server smoke process helpers', () => {
  it('builds a direct node tsx server invocation without Windows shell wrappers', async () => {
    const { buildTsxServerInvocation } = await loadLib();

    const invocation = buildTsxServerInvocation({
      rootDir: 'D:\\repo\\codexwinmux',
      nodePath: 'node.exe',
    });

    expect(invocation.command).toBe('node.exe');
    expect(invocation.args).toEqual([
      path.join('D:\\repo\\codexwinmux', 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      'server.ts',
    ]);
    expect(invocation.args.join(' ')).not.toContain('cmd.exe');
    expect(invocation.args.join(' ')).not.toContain('corepack');
  });
});
