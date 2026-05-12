import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { randomBytes } from 'crypto';

const BASE_DIR = path.join(os.homedir(), '.codexwinmux');
const UPLOADS_DIR = path.join(BASE_DIR, 'uploads');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BYTES = 10 * 1024 * 1024;
const GENERIC_MAX_BYTES = 50 * 1024 * 1024;

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

interface ISaveImageOptions {
  data: Buffer;
  mime: string;
  originalName?: string;
  wsId?: string;
  tabId?: string;
}

interface ISaveImageResult {
  path: string;
  filename: string;
}

interface ISaveFileOptions {
  data: Buffer;
  originalName?: string;
  wsId?: string;
  tabId?: string;
}

const sanitizeId = (value?: string): string => {
  if (!value) return 'unknown';
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 64) : 'unknown';
};

const isValidMime = (mime: string): mime is keyof typeof MIME_EXTENSIONS =>
  mime in MIME_EXTENSIONS;

const buildFilename = (originalName: string | undefined, mime: string): string => {
  const ext = MIME_EXTENSIONS[mime];
  const stamp = Date.now();
  const rand = randomBytes(4).toString('hex');
  const baseRaw = originalName ? path.parse(originalName).name : 'image';
  const base = baseRaw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'image';
  return `${stamp}-${rand}-${base}.${ext}`;
};

const saveImage = async ({ data, mime, originalName, wsId, tabId }: ISaveImageOptions): Promise<ISaveImageResult> => {
  if (!isValidMime(mime)) {
    throw new Error(`Unsupported image type: ${mime}`);
  }
  if (data.length > MAX_BYTES) {
    throw new Error(`Image exceeds ${MAX_BYTES} bytes`);
  }

  const dir = path.join(UPLOADS_DIR, sanitizeId(wsId), sanitizeId(tabId));
  await fs.mkdir(dir, { recursive: true });

  const filename = buildFilename(originalName, mime);
  const fullPath = path.join(dir, filename);
  await fs.writeFile(fullPath, data, { mode: 0o600 });

  return { path: fullPath, filename };
};

const buildGenericFilename = (originalName: string | undefined): string => {
  const stamp = Date.now();
  const rand = randomBytes(4).toString('hex');
  const parsed = originalName ? path.parse(originalName) : { name: '', ext: '' };
  const baseRaw = parsed.name || 'file';
  const base = baseRaw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'file';
  const extRaw = parsed.ext ? parsed.ext.replace(/[^a-zA-Z0-9.]/g, '') : '';
  const ext = extRaw.startsWith('.') ? extRaw.slice(0, 16) : '';
  return `${stamp}-${rand}-${base}${ext}`;
};

const saveFile = async ({ data, originalName, wsId, tabId }: ISaveFileOptions): Promise<ISaveImageResult> => {
  if (data.length > GENERIC_MAX_BYTES) {
    throw new Error(`File exceeds ${GENERIC_MAX_BYTES} bytes`);
  }

  const dir = path.join(UPLOADS_DIR, sanitizeId(wsId), sanitizeId(tabId));
  await fs.mkdir(dir, { recursive: true });

  const filename = buildGenericFilename(originalName);
  const fullPath = path.join(dir, filename);
  await fs.writeFile(fullPath, data, { mode: 0o600 });

  return { path: fullPath, filename };
};

interface ICleanupResult {
  deleted: number;
  freedBytes: number;
}

const removeFileSafe = async (filePath: string): Promise<number> => {
  try {
    const stat = await fs.stat(filePath);
    await fs.unlink(filePath);
    return stat.size;
  } catch {
    return 0;
  }
};

const removeEmptyDirs = async (dir: string): Promise<void> => {
  try {
    const entries = await fs.readdir(dir);
    if (entries.length === 0 && dir !== UPLOADS_DIR) {
      await fs.rmdir(dir);
    }
  } catch {
    /* ignore */
  }
};

const walkUploads = async (
  visit: (filePath: string, mtimeMs: number, size: number) => Promise<boolean>,
): Promise<ICleanupResult> => {
  const result: ICleanupResult = { deleted: 0, freedBytes: 0 };

  let wsDirs: string[];
  try {
    wsDirs = await fs.readdir(UPLOADS_DIR);
  } catch {
    return result;
  }

  for (const ws of wsDirs) {
    const wsPath = path.join(UPLOADS_DIR, ws);
    let tabDirs: string[];
    try {
      tabDirs = await fs.readdir(wsPath);
    } catch {
      continue;
    }
    for (const tab of tabDirs) {
      const tabPath = path.join(wsPath, tab);
      let files: string[];
      try {
        files = await fs.readdir(tabPath);
      } catch {
        continue;
      }
      for (const file of files) {
        const filePath = path.join(tabPath, file);
        try {
          const stat = await fs.stat(filePath);
          if (!stat.isFile()) continue;
          const removed = await visit(filePath, stat.mtimeMs, stat.size);
          if (removed) {
            result.deleted += 1;
            result.freedBytes += stat.size;
          }
        } catch {
          /* ignore */
        }
      }
      await removeEmptyDirs(tabPath);
    }
    await removeEmptyDirs(wsPath);
  }
  return result;
};

const cleanupExpiredUploads = async (maxAgeMs: number = DEFAULT_TTL_MS): Promise<ICleanupResult> => {
  const cutoff = Date.now() - maxAgeMs;
  return walkUploads(async (filePath, mtimeMs) => {
    if (mtimeMs < cutoff) {
      const size = await removeFileSafe(filePath);
      return size > 0;
    }
    return false;
  });
};

const cleanupAllUploads = async (): Promise<ICleanupResult> =>
  walkUploads(async (filePath) => {
    const size = await removeFileSafe(filePath);
    return size > 0;
  });

export {
  saveImage,
  saveFile,
  cleanupExpiredUploads,
  cleanupAllUploads,
  isValidMime,
  MAX_BYTES,
  GENERIC_MAX_BYTES,
  UPLOADS_DIR,
};
export type { ISaveImageResult, ICleanupResult };
