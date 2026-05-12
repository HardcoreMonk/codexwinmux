import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import * as _webpush from 'web-push';
const webpush = (_webpush as unknown as { default?: typeof _webpush }).default ?? _webpush;
import { createLogger } from '@/lib/logger';

const log = createLogger('vapid');

const BASE_DIR = path.join(os.homedir(), '.codexwinmux');
const VAPID_FILE = path.join(BASE_DIR, 'vapid-keys.json');

interface IVAPIDKeys {
  publicKey: string;
  privateKey: string;
}

let cachedKeys: IVAPIDKeys | null = null;

export const getVAPIDKeys = async (): Promise<IVAPIDKeys> => {
  if (cachedKeys) return cachedKeys;

  try {
    const raw = await fs.readFile(VAPID_FILE, 'utf-8');
    cachedKeys = JSON.parse(raw) as IVAPIDKeys;
    return cachedKeys;
  } catch {
    // 키가 없으면 새로 생성
  }

  const keys = webpush.generateVAPIDKeys();
  cachedKeys = { publicKey: keys.publicKey, privateKey: keys.privateKey };

  await fs.mkdir(BASE_DIR, { recursive: true });
  const tmp = VAPID_FILE + '.tmp';
  try {
    await fs.writeFile(tmp, JSON.stringify(cachedKeys, null, 2), { mode: 0o600 });
    await fs.rename(tmp, VAPID_FILE);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }

  log.info('VAPID keys generated');
  return cachedKeys;
};
