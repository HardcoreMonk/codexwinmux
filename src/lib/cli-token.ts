import { randomBytes, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { NextApiRequest } from 'next';

const TOKEN_FILE = path.join(os.homedir(), '.codexwinmux', 'cli-token');

const g = globalThis as unknown as { __ptCliToken?: string };

const readTokenFile = (): string | null => {
  try {
    const value = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
    return value || null;
  } catch {
    return null;
  }
};

const writeTokenFile = (value: string): void => {
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, value, { mode: 0o600 });
  } catch {
    // best-effort; CLI will still work via env var
  }
};

export const getCliToken = (): string => {
  if (g.__ptCliToken) return g.__ptCliToken;
  const existing = readTokenFile();
  if (existing) {
    g.__ptCliToken = existing;
    return existing;
  }
  const fresh = randomBytes(32).toString('hex');
  g.__ptCliToken = fresh;
  writeTokenFile(fresh);
  return fresh;
};

export const verifyTokenValue = (value: string | null | undefined): boolean => {
  if (!value) return false;
  const expected = getCliToken();
  if (value.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
};

export const verifyCliToken = (req: NextApiRequest): boolean => {
  const value = req.headers['x-cmux-token'];
  return verifyTokenValue(typeof value === 'string' ? value : undefined);
};
