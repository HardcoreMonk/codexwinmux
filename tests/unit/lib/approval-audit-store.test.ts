import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempHome: string;

describe('approval audit store', () => {
  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-approval-audit-'));
    vi.resetModules();
    vi.stubEnv('HOME', tempHome);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  it('persists sanitized approval selection events as durable JSONL', async () => {
    const { appendApprovalAuditEvent, readApprovalAuditEvents } = await import('@/lib/approval-audit-store');

    await appendApprovalAuditEvent({
      eventType: 'selection-sent',
      workspaceId: 'ws-1',
      tabId: 'tab-1',
      promptType: 'command',
      approvalKind: 'allow',
      riskLevel: 'high',
      selectedOptionIndex: 1,
      optionCount: 2,
      commandPreview: 'rm -rf /home/user/private-project',
      sessionName: 'pt-ws-pane-tab',
    } as Parameters<typeof appendApprovalAuditEvent>[0] & {
      commandPreview: string;
      sessionName: string;
    });

    const file = path.join(tempHome, '.codexwinmux', 'approval-audit.jsonl');
    const raw = await fs.readFile(file, 'utf-8');
    expect(raw).toContain('"eventType":"selection-sent"');
    expect(raw).toContain('"selectedOptionIndex":1');
    expect(raw).not.toContain('private-project');
    expect(raw).not.toContain('pt-ws-pane-tab');

    const events = await readApprovalAuditEvents({ limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: 'selection-sent',
      workspaceId: 'ws-1',
      tabId: 'tab-1',
      promptType: 'command',
      approvalKind: 'allow',
      riskLevel: 'high',
      selectedOptionIndex: 1,
      optionCount: 2,
    });
  });

  it('returns latest audit events first with a limit', async () => {
    const { appendApprovalAuditEvent, readApprovalAuditEvents } = await import('@/lib/approval-audit-store');

    await appendApprovalAuditEvent({ eventType: 'fallback', workspaceId: 'ws-1', tabId: 'tab-1', fallbackReason: 'parse-empty' });
    await appendApprovalAuditEvent({ eventType: 'selection-sent', workspaceId: 'ws-2', tabId: 'tab-2', selectedOptionIndex: 0 });

    expect(await readApprovalAuditEvents({ limit: 1 })).toMatchObject([
      { eventType: 'selection-sent', workspaceId: 'ws-2', tabId: 'tab-2' },
    ]);
  });
});
