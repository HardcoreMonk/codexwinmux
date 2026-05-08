import { describe, expect, it, vi } from 'vitest';

import { createStatusSessionHistoryAdapter } from '@/lib/status-session-history-adapter';
import { buildStatusWebPushPayload } from '@/lib/status-web-push-adapter';
import type { ITabStatusEntry } from '@/types/status';

const baseEntry: ITabStatusEntry = {
  cliState: 'needs-input',
  workspaceId: 'ws-1',
  tabName: 'codex',
  tmuxSession: 'pt-ws-1-pane-1-tab-1',
  panelType: 'codex',
  terminalStatus: 'idle',
  listeningPorts: [],
  currentProcess: 'codex',
  agentSessionId: 'session-1',
  approvalPromptMetadata: {
    promptType: 'command',
    approvalKind: 'allow',
    riskLevel: 'medium',
    commandPreview: 'corepack pnpm test',
    fileHints: [],
    fallbackReason: null,
  },
};

describe('status side-effect adapters', () => {
  it('builds Web Push payloads outside StatusManager', () => {
    expect(buildStatusWebPushPayload({
      tabId: 'tab-1',
      entry: baseEntry,
      pushType: 'needs-input',
      workspaceName: 'Workspace',
      workspaceDir: 'D:/repo',
      soundOnCompleteEnabled: true,
    })).toMatchObject({
      title: 'Input Required',
      body: 'Command approval · medium · corepack pnpm test',
      tabId: 'tab-1',
      workspaceId: 'ws-1',
      agentSessionId: 'session-1',
      approvalKind: 'allow',
      promptType: 'command',
      riskLevel: 'medium',
      approvalDetail: 'corepack pnpm test',
    });
  });

  it('falls back to local session history when runtime adapter fails', async () => {
    const localAdd = vi.fn().mockResolvedValue(undefined);
    const adapter = createStatusSessionHistoryAdapter({
      shouldUseRuntimeStatusDefault: () => true,
      runtime: {
        addEntry: vi.fn().mockRejectedValue(new Error('worker down')),
        updateDismissedAt: vi.fn(),
      },
      local: {
        addEntry: localAdd,
        updateDismissedAt: vi.fn(),
      },
      recordCounter: vi.fn(),
      logWarning: vi.fn(),
    });
    const entry = {
      id: 'history-1',
      workspaceId: 'ws-1',
      workspaceName: 'Workspace',
      workspaceDir: null,
      tabId: 'tab-1',
      agentSessionId: 'session-1',
      prompt: 'Run tests',
      result: 'Passed',
      startedAt: 1,
      completedAt: 2,
      duration: 1,
      dismissedAt: 2,
      toolUsage: {},
      touchedFiles: [],
    };

    await adapter.addEntry(entry);

    expect(localAdd).toHaveBeenCalledWith(entry);
  });
});
