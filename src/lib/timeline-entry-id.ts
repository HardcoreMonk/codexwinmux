import type { ITimelineEntry } from '@/types/timeline';

export interface ITimelineEntryIdSource {
  lineOffset: number;
  entryIndex: number;
  type: ITimelineEntry['type'];
  source: unknown;
}

export interface IProviderTimelineEntryIdSource {
  providerId: string;
  recordId: string;
  type: ITimelineEntry['type'];
  source?: unknown;
}

const hashString = (value: string): string => {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
};

const sourceToString = (source: unknown): string => {
  if (typeof source === 'string') return source;
  const serialized = JSON.stringify(source);
  return serialized ?? '';
};

export const createTimelineEntryId = ({
  lineOffset,
  entryIndex,
  type,
  source,
}: ITimelineEntryIdSource): string => [
  'jsonl',
  Math.max(0, lineOffset).toString(36),
  entryIndex.toString(36),
  type,
  hashString(sourceToString(source)),
].join('-');

export const createProviderTimelineEntryId = ({
  providerId,
  recordId,
  type,
  source,
}: IProviderTimelineEntryIdSource): string => [
  'provider',
  providerId,
  type,
  hashString(sourceToString({ recordId, source: source ?? recordId })),
].join('-');

export const assignStableTimelineEntryIds = (
  entries: ITimelineEntry[],
  source: Omit<ITimelineEntryIdSource, 'entryIndex' | 'type'>,
): ITimelineEntry[] => entries.map((entry, entryIndex) => ({
  ...entry,
  id: createTimelineEntryId({
    ...source,
    entryIndex,
    type: entry.type,
  }),
}));
