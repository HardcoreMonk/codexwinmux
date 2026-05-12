import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ACTIONS } from '@/lib/keyboard-shortcuts';

export type TKeybindingOverride = string | null;

export interface IKeybindingsFile {
  overrides: Record<string, TKeybindingOverride>;
}

const BASE_DIR = path.join(os.homedir(), '.codexwinmux');
const FILE_PATH = path.join(BASE_DIR, 'keybindings.json');

const EMPTY: IKeybindingsFile = { overrides: {} };

export const normalizeKeybindingOverrides = (src: Record<string, unknown>): Record<string, TKeybindingOverride> => {
  const overrides: Record<string, TKeybindingOverride> = {};
  for (const [k, v] of Object.entries(src)) {
    if (typeof k !== 'string') continue;
    if (v !== null && typeof v !== 'string') continue;
    if (!(k in ACTIONS)) continue;
    if (overrides[k] === undefined) overrides[k] = v;
  }
  return overrides;
};

const sanitize = (raw: unknown): IKeybindingsFile => {
  if (!raw || typeof raw !== 'object') return EMPTY;
  const src = (raw as { overrides?: unknown }).overrides;
  if (!src || typeof src !== 'object') return EMPTY;
  return { overrides: normalizeKeybindingOverrides(src as Record<string, unknown>) };
};

export const readKeybindings = async (): Promise<IKeybindingsFile> => {
  try {
    const raw = await fs.readFile(FILE_PATH, 'utf-8');
    return sanitize(JSON.parse(raw));
  } catch {
    return EMPTY;
  }
};

export const writeKeybindings = async (data: IKeybindingsFile): Promise<void> => {
  await fs.mkdir(BASE_DIR, { recursive: true });
  await fs.writeFile(FILE_PATH, JSON.stringify(sanitize(data), null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
};

export const setKeybinding = async (
  id: string,
  key: TKeybindingOverride,
): Promise<IKeybindingsFile> => {
  const data = await readKeybindings();
  data.overrides[id] = key;
  await writeKeybindings(data);
  return data;
};

export const resetKeybinding = async (
  id: string,
): Promise<IKeybindingsFile> => {
  const data = await readKeybindings();
  delete data.overrides[id];
  await writeKeybindings(data);
  return data;
};

export const resetAllKeybindings = async (): Promise<IKeybindingsFile> => {
  await writeKeybindings(EMPTY);
  return EMPTY;
};
