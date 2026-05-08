import fs from 'fs/promises';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { parseCodexJsonlContent } from '@/lib/codex-session-parser';
import type { ITimelineEntry } from '@/types/timeline';

interface ICodexCliFixtureCase {
  version: string;
  fileName: string;
  expectedEntries: Array<Partial<ITimelineEntry>>;
}

const fixtureDir = path.join(process.cwd(), 'tests', 'fixtures', 'codex-jsonl');

const fixtureCases: ICodexCliFixtureCase[] = [
  {
    version: '0.127.0',
    fileName: 'codex-cli-0.127.0-response-items.jsonl',
    expectedEntries: [
      { type: 'user-message', text: 'Inspect parser fixtures' },
      { type: 'assistant-message', markdown: 'I will inspect the parser.' },
      { type: 'thinking', thinking: 'Need read parser' },
      { type: 'tool-call', toolUseId: 'call_fixture_127', toolName: 'exec_command', summary: '$ corepack pnpm test', status: 'success' },
      { type: 'tool-result', toolUseId: 'call_fixture_127', isError: false, summary: 'Process exited with code 0' },
    ],
  },
  {
    version: '0.128.0',
    fileName: 'codex-cli-0.128.0-event-response-pair.jsonl',
    expectedEntries: [
      { type: 'user-message', text: 'Check paired messages' },
      { type: 'assistant-message', markdown: 'Reading the timeline parser.' },
      { type: 'thinking', thinking: 'Need verify dedupe' },
      { type: 'tool-call', toolUseId: 'call_fixture_128', toolName: 'exec_command', summary: '$ Get-ChildItem tests', status: 'success' },
      { type: 'tool-result', toolUseId: 'call_fixture_128', isError: false, summary: '2 lines' },
    ],
  },
];

describe('parseCodexJsonlContent version fixtures', () => {
  it.each(fixtureCases)('parses Codex CLI $version JSONL fixture', async ({ fileName, expectedEntries }) => {
    const content = await fs.readFile(path.join(fixtureDir, fileName), 'utf-8');
    const entries = parseCodexJsonlContent(content);

    expect(entries).toHaveLength(expectedEntries.length);
    expect(entries.map((entry) => entry.id)).toEqual(parseCodexJsonlContent(content).map((entry) => entry.id));
    expectedEntries.forEach((expected, index) => {
      expect(entries[index]).toMatchObject(expected);
    });
  });
});
