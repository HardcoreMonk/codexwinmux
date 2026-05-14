import path from 'path';

export const buildTsxServerInvocation = ({
  rootDir = process.cwd(),
  nodePath = process.execPath,
  entrypoint = 'server.ts',
} = {}) => ({
  command: nodePath,
  args: [
    path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    entrypoint,
  ],
});
