import { spawn } from 'node:child_process';

const port = process.env.PORT || '8121';
const host = process.env.HOST || 'localhost';
const devUrl = process.env.ELECTRON_DEV_URL || `http://localhost:${port}`;
const healthUrl = `http://127.0.0.1:${port}/api/health`;
const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';

const children = new Set();

const spawnChild = (cmd, args, env = {}) => {
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
};

const stopChildren = () => {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
};

process.on('SIGINT', () => {
  stopChildren();
  process.exit(130);
});

process.on('SIGTERM', () => {
  stopChildren();
  process.exit(143);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isServerReady = async () => {
  try {
    const res = await fetch(healthUrl);
    return res.ok;
  } catch {
    return false;
  }
};

const waitForServer = async () => {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await isServerReady()) return;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${healthUrl}`);
};

const main = async () => {
  let devServer = null;
  if (!(await isServerReady())) {
    devServer = spawnChild(corepack, ['pnpm', 'dev'], { PORT: port, HOST: host });
    devServer.on('exit', (code) => {
      if (code !== 0) process.exit(code ?? 1);
    });
    await waitForServer();
  }

  const electron = spawnChild(corepack, ['pnpm', 'exec', 'electron', '.'], {
    ELECTRON_DEV_URL: devUrl,
  });

  electron.on('exit', (code) => {
    if (devServer && !devServer.killed) devServer.kill('SIGTERM');
    process.exit(code ?? 0);
  });
};

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  stopChildren();
  process.exit(1);
});
