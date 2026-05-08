import type { IInitMeta, ITimelineEntry } from '@/types/timeline';

export const MAX_TIMELINE_INIT_ENTRIES = 64;

export const findLastUserMessage = (entries: ITimelineEntry[], maxLength = 200): string | null => {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === 'user-message' && entry.text.trim()) {
      const text = entry.text.trim();
      return text.length > maxLength
        ? `${text.slice(0, maxLength)}…`
        : text;
    }
  }
  return null;
};

export const computeInitMeta = (
  entries: ITimelineEntry[],
  fileSize: number,
  createdAtOverride?: string | null,
  customTitle?: string,
): IInitMeta => {
  let createdAt: string | null = null;
  let updatedAt: string | null = null;
  let lastTimestamp = 0;
  let userCount = 0;
  let assistantCount = 0;

  for (const entry of entries) {
    if (!createdAt && entry.timestamp) {
      createdAt = new Date(entry.timestamp).toISOString();
    }
    if (entry.timestamp) {
      lastTimestamp = Math.max(lastTimestamp, entry.timestamp);
      updatedAt = new Date(entry.timestamp).toISOString();
    }

    if (entry.type === 'user-message') userCount++;
    else if (entry.type === 'assistant-message') assistantCount++;
  }

  return {
    createdAt: createdAtOverride ?? createdAt,
    updatedAt,
    lastTimestamp,
    fileSize,
    userCount,
    assistantCount,
    customTitle,
  };
};
