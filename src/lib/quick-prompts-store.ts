import fs from 'fs/promises';
import path from 'path';
import os from 'os';

interface IQuickPrompt {
  id: string;
  name: string;
  prompt: string;
  enabled: boolean;
}

interface IQuickPromptsFile {
  custom: IQuickPrompt[];
  disabledBuiltinIds: string[];
  order: string[];
}

interface IQuickPromptsData {
  builtins: IQuickPrompt[];
  custom: IQuickPrompt[];
  order: string[];
}

const BASE_DIR = path.join(os.homedir(), '.codexwinmux');
const FILE_PATH = path.join(BASE_DIR, 'quick-prompts.json');

const BUILTIN_PROMPTS: IQuickPrompt[] = [
  { id: 'builtin-commit', name: 'Commit', prompt: '/commit-commands:commit', enabled: true },
];

const normalizePrompt = (value: unknown): IQuickPrompt | null => {
  if (!value || typeof value !== 'object') return null;

  const prompt = value as Partial<IQuickPrompt>;
  if (typeof prompt.id !== 'string' || typeof prompt.name !== 'string' || typeof prompt.prompt !== 'string') {
    return null;
  }

  return {
    id: prompt.id,
    name: prompt.name,
    prompt: prompt.prompt,
    enabled: prompt.enabled !== false,
  };
};

const filterKnownIds = (value: unknown, knownIds: Set<string>): string[] => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value.filter((id): id is string => {
    if (typeof id !== 'string' || !knownIds.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const sanitizeQuickPromptsFile = (file: Partial<IQuickPromptsFile> | null | undefined): IQuickPromptsFile => {
  const builtinIds = new Set(BUILTIN_PROMPTS.map((b) => b.id));

  const custom = (Array.isArray(file?.custom) ? file.custom : [])
    .map(normalizePrompt)
    .filter((p): p is IQuickPrompt => !!p)
    .filter((p) => !builtinIds.has(p.id) && !p.id.startsWith('builtin-'));

  const customIds = new Set(custom.map((p) => p.id));
  const knownIds = new Set([...builtinIds, ...customIds]);

  return {
    custom,
    disabledBuiltinIds: filterKnownIds(file?.disabledBuiltinIds, builtinIds),
    order: filterKnownIds(file?.order, knownIds),
  };
};

const hasQuickPromptsFileChanged = (source: unknown, next: IQuickPromptsFile): boolean =>
  JSON.stringify(source) !== JSON.stringify(next);

const migrateFromFlatArray = (arr: unknown[]): IQuickPromptsFile => {
  const builtinIds = new Set(BUILTIN_PROMPTS.map((b) => b.id));
  const prompts = arr.map(normalizePrompt).filter((p): p is IQuickPrompt => !!p);
  const disabledBuiltinIds = prompts
    .filter((p) => builtinIds.has(p.id) && !p.enabled)
    .map((p) => p.id);
  const custom = prompts.filter((p) => !builtinIds.has(p.id) && !p.id.startsWith('builtin-'));

  return sanitizeQuickPromptsFile({ custom, disabledBuiltinIds, order: [] });
};

const readQuickPrompts = async (): Promise<IQuickPromptsData> => {
  try {
    const raw = await fs.readFile(FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);

    // Migrate from legacy flat array format
    if (Array.isArray(parsed)) {
      const migrated = migrateFromFlatArray(parsed);
      await writeQuickPrompts(migrated).catch(() => undefined);
      return buildData(migrated);
    }

    const sanitized = sanitizeQuickPromptsFile(parsed as Partial<IQuickPromptsFile>);
    if (hasQuickPromptsFileChanged(parsed, sanitized)) {
      await writeQuickPrompts(sanitized).catch(() => undefined);
    }
    return buildData(sanitized);
  } catch {
    return buildData(sanitizeQuickPromptsFile(null));
  }
};

const buildData = (file: IQuickPromptsFile): IQuickPromptsData => {
  const disabledSet = new Set(file.disabledBuiltinIds ?? []);
  const builtins = BUILTIN_PROMPTS.map((b) => ({
    ...b,
    enabled: !disabledSet.has(b.id),
  }));
  const custom = (file.custom ?? []).map((c) => ({ ...c }));
  const order = file.order ?? [];
  return { builtins, custom, order };
};

const writeQuickPrompts = async (data: IQuickPromptsFile): Promise<void> => {
  const sanitized = sanitizeQuickPromptsFile(data);
  await fs.mkdir(BASE_DIR, { recursive: true });
  await fs.writeFile(FILE_PATH, JSON.stringify(sanitized, null, 2), { mode: 0o600 });
};

export { readQuickPrompts, writeQuickPrompts, BUILTIN_PROMPTS };
export type { IQuickPrompt, IQuickPromptsFile, IQuickPromptsData };
