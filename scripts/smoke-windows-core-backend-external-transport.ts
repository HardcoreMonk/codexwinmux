import fs from 'fs';
import net from 'net';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import {
  getCoreRuntimeApi,
  resetCoreEngineBackendForTest,
  shutdownCoreEngineClient,
} from '@/lib/core-engine/runtime-api';

const timeoutMs = 15_000;

const findFreePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });

const waitForPort = (port: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = (): void => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`Core TCP transport did not listen on port ${port}`));
          return;
        }
        setTimeout(check, 100);
      });
    };
    check();
  });

const closeChild = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill();
      resolve();
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
};

const withBackendCoreEnv = async <T>(
  env: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> => {
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  try {
    Object.assign(process.env, env);
    resetCoreEngineBackendForTest();
    return await fn();
  } finally {
    shutdownCoreEngineClient();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

const main = async (): Promise<void> => {
  const cwd = process.cwd();
  const scriptPath = path.join(cwd, 'dist', 'workers', 'core-engine-host.js');
  if (!fs.existsSync(scriptPath)) {
    throw Object.assign(new Error(`Core engine host script is missing: ${scriptPath}`), {
      code: 'core-engine-host-build-missing',
    });
  }

  const port = await findFreePort();
  const coreEnv = {
    CODEXWINMUX_RUNTIME_V2: '1',
    CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER: process.env.CODEXWINMUX_RUNTIME_TERMINAL_ADAPTER || 'windows',
    CODEXWINMUX_PROCESS_INSPECTOR_ADAPTER: process.env.CODEXWINMUX_PROCESS_INSPECTOR_ADAPTER || 'windows',
    CODEXWINMUX_CORE_ENGINE_TRANSPORT: 'tcp',
    CODEXWINMUX_CORE_ENGINE_HOST: '127.0.0.1',
    CODEXWINMUX_CORE_ENGINE_PORT: String(port),
    CODEXWINMUX_CORE_ENGINE_REQUEST_TIMEOUT_MS: '5000',
  };
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      ...coreEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const startedAt = Date.now();
  try {
    await waitForPort(port);
    const health = await withBackendCoreEnv(coreEnv, async () => getCoreRuntimeApi().health());
    const payload = {
      ok: health.ok === true,
      mutatesSystem: false,
      checks: [
        'core-tcp-listener-ready',
        'backend-runtime-api-external-core-health',
      ],
      transport: {
        mode: 'tcp',
        host: '127.0.0.1',
        port,
      },
      health,
      durationMs: Date.now() - startedAt,
    };
    console.log(JSON.stringify(payload, null, 2));
    if (!payload.ok) process.exitCode = 1;
  } finally {
    await closeChild(child);
    if (process.exitCode && stderr.trim()) {
      console.error(stderr.trim());
    }
  }
};

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
