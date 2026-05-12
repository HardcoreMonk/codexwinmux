import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import http from 'http';
import { createLogger } from '@/lib/logger';

const log = createLogger('lock');

const BASE_DIR = path.join(os.homedir(), '.codexwinmux');
const LOCK_FILE = path.join(BASE_DIR, 'cmux.lock');

interface ILockData {
  pid: number;
  port: number;
  startedAt: number;
}

const readLockData = async (): Promise<ILockData | null> => {
  try {
    const raw = await fsp.readFile(LOCK_FILE, 'utf-8');
    return JSON.parse(raw) as ILockData;
  } catch {
    return null;
  }
};

const writeLockData = async (data: ILockData): Promise<void> => {
  const content = JSON.stringify(data, null, 2) + '\n';
  const fd = await fsp.open(LOCK_FILE, 'wx', 0o600);
  try {
    await fd.writeFile(content);
  } finally {
    await fd.close();
  }
};

const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const checkHealth = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/health`, { timeout: 2000 }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data.app === 'codexwinmux');
        } catch {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });

const removeStaleLock = async (): Promise<void> => {
  try {
    await fsp.unlink(LOCK_FILE);
  } catch {
    // already removed
  }
};

export const acquireLock = async (port: number): Promise<void> => {
  await fsp.mkdir(BASE_DIR, { recursive: true });

  const data: ILockData = { pid: process.pid, port, startedAt: Date.now() };

  try {
    await writeLockData(data);
    log.debug(`Lock acquired (pid=${process.pid})`);
    return;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;

    if (code === 'EACCES') {
      console.error(`\x1b[31mCannot acquire lock: ${LOCK_FILE} has wrong permissions.\x1b[0m`);
      console.error('If you previously ran codexmux with sudo, remove the lock file manually:');
      console.error(`  sudo rm ${LOCK_FILE}`);
      process.exit(1);
    }

    if (code !== 'EEXIST') throw err;
  }

  const existing = await readLockData();

  if (!existing) {
    await removeStaleLock();
    await writeLockData(data);
    log.debug(`Lock acquired after removing empty lock (pid=${process.pid})`);
    return;
  }

  if (existing.pid === process.pid) {
    log.debug('Lock already held by this process');
    return;
  }

  if (!isPidAlive(existing.pid)) {
    log.warn(`Stale lock found (pid=${existing.pid} is dead), reclaiming`);
    await removeStaleLock();
    await writeLockData(data);
    log.debug(`Lock acquired (pid=${process.pid})`);
    return;
  }

  const healthy = await checkHealth(existing.port);
  if (healthy) {
    console.error(`\x1b[31mcodexwinmux is already running (pid=${existing.pid}, port=${existing.port})\x1b[0m`);
    process.exit(1);
  }

  log.warn(`PID ${existing.pid} is alive but not codexmux, reclaiming lock`);
  await removeStaleLock();
  await writeLockData(data);
  log.debug(`Lock acquired (pid=${process.pid})`);
};

export const releaseLock = (): void => {
  try {
    const raw = fs.readFileSync(LOCK_FILE, 'utf-8');
    const data = JSON.parse(raw) as ILockData;
    if (data.pid === process.pid) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch {
    // already removed or unreadable
  }
};

export const registerLockCleanup = (): void => {
  process.on('exit', releaseLock);
};
