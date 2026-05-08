import { describe, expect, it } from 'vitest';

import { createProviderTimelineEntryId, createTimelineEntryId } from '@/lib/timeline-entry-id';

describe('timeline entry ids', () => {
  it('keeps provider record identity independent from JSONL byte offsets', () => {
    const first = createProviderTimelineEntryId({
      providerId: 'codex-app-server',
      recordId: 'thread-item-1',
      type: 'assistant-message',
    });
    const second = createProviderTimelineEntryId({
      providerId: 'codex-app-server',
      recordId: 'thread-item-1',
      type: 'assistant-message',
    });

    expect(first).toBe(second);
    expect(first).toContain('provider-codex-app-server-assistant-message');
    expect(first).not.toBe(createTimelineEntryId({
      lineOffset: 25,
      entryIndex: 0,
      type: 'assistant-message',
      source: 'thread-item-1',
    }));
  });
});
