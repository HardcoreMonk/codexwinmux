import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

import { codexAppServerProtocolAdapter } from '@/lib/providers/codex-app-server';
import { listProviders } from '@/lib/providers';

const readAppServerThreadFixture = async (): Promise<Parameters<typeof codexAppServerProtocolAdapter.parseThread>[0]> =>
  JSON.parse(await readFile(
    new URL('../../fixtures/codex-app-server/thread-read-v2.json', import.meta.url),
    'utf-8',
  ));

describe('Codex app-server protocol adapter', () => {
  it('is available as a guarded adapter without becoming a runtime provider', () => {
    expect(codexAppServerProtocolAdapter.providerId).toBe('codex-app-server');
    expect(codexAppServerProtocolAdapter.runtimeProviderReady).toBe(false);
    expect(listProviders().map((provider) => provider.id)).toEqual(['codex']);
  });

  it('maps app-server thread items to timeline entries using item ids as record identity', async () => {
    const thread = await readAppServerThreadFixture();

    const entries = codexAppServerProtocolAdapter.parseThread(thread);

    expect(entries.map((entry) => entry.type)).toEqual([
      'user-message',
      'assistant-message',
      'thinking',
      'tool-call',
      'tool-result',
      'agent-group',
    ]);
    expect(entries[0]).toMatchObject({ text: '앱 서버 어댑터 확인' });
    expect(entries[1]).toMatchObject({ markdown: '프로토콜 item을 timeline으로 변환합니다.' });
    expect(entries[2]).toMatchObject({ thinking: 'ThreadItem id를 stable key로 사용' });
    expect(entries[3]).toMatchObject({
      toolUseId: 'item-command-1',
      toolName: 'Command',
      summary: '$ corepack pnpm test',
      status: 'success',
    });
    expect(entries[4]).toMatchObject({
      toolUseId: 'item-command-1',
      isError: false,
      summary: 'Test Files 1 passed',
    });
    expect(entries[5]).toMatchObject({
      type: 'agent-group',
      agentType: 'spawnAgent',
      description: 'Map status manager side effects',
      entryCount: 1,
    });
    expect(codexAppServerProtocolAdapter.parseThread(thread).map((entry) => entry.id))
      .toEqual(entries.map((entry) => entry.id));
    expect(entries[0].id).toContain('provider-codex-app-server-user-message');
  });
});
