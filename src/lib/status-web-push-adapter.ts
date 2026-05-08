import { buildApprovalPushBody, getApprovalMetadataDetail } from '@/lib/approval-queue';
import { createStatusWebPushActions } from '@/lib/runtime/status/web-push-actions';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';
import type {
  IStatusSendWebPushResult,
  IStatusWebPushPayload,
} from '@/lib/runtime/status/web-push-actions';
import type { ITabStatusEntry } from '@/types/status';

export interface IBuildStatusWebPushPayloadInput {
  tabId: string;
  entry: ITabStatusEntry;
  pushType: 'review' | 'needs-input';
  workspaceName: string;
  workspaceDir: string | null;
  soundOnCompleteEnabled: boolean;
}

export interface ISendStatusWebPushInput extends IBuildStatusWebPushPayloadInput {
  anyDeviceVisible: boolean;
}

export interface ICreateStatusWebPushAdapterOptions {
  shouldUseRuntimeStatusDefault: () => boolean;
  sendRuntime?: (input: { anyDeviceVisible: boolean; payload: IStatusWebPushPayload }) => Promise<IStatusSendWebPushResult>;
  sendLocal?: (input: { anyDeviceVisible: boolean; payload: IStatusWebPushPayload }) => Promise<IStatusSendWebPushResult>;
  recordCounter?: (name: string, value?: number) => void;
  logWarning?: (message: string) => void;
}

export const buildStatusWebPushPayload = ({
  tabId,
  entry,
  pushType,
  workspaceName,
  workspaceDir,
  soundOnCompleteEnabled,
}: IBuildStatusWebPushPayloadInput): IStatusWebPushPayload => {
  const title = pushType === 'needs-input' ? 'Input Required' : 'Task Complete';
  const fallbackBody = entry.lastUserMessage?.slice(0, 100) || entry.tabName || tabId;
  const approvalPromptMetadata = pushType === 'needs-input' ? entry.approvalPromptMetadata ?? null : null;
  const body = pushType === 'needs-input'
    ? buildApprovalPushBody({ metadata: approvalPromptMetadata, fallbackText: fallbackBody })
    : fallbackBody;
  const approvalMetadata = pushType === 'needs-input'
    ? {
      approvalKind: approvalPromptMetadata?.approvalKind ?? 'unknown',
      promptType: approvalPromptMetadata?.promptType ?? 'unknown',
      riskLevel: approvalPromptMetadata?.riskLevel ?? 'unknown',
      approvalDetail: getApprovalMetadataDetail(approvalPromptMetadata),
    }
    : {};

  return {
    title,
    body,
    silent: pushType === 'review' && soundOnCompleteEnabled === false,
    tabId,
    workspaceId: entry.workspaceId,
    agentSessionId: entry.agentSessionId ?? null,
    workspaceName,
    workspaceDir,
    ...approvalMetadata,
  };
};

export const createStatusWebPushAdapter = ({
  shouldUseRuntimeStatusDefault,
  sendRuntime = (input) => getRuntimeSupervisor().sendStatusWebPush(input),
  sendLocal = createStatusWebPushActions().send,
  recordCounter = () => {},
  logWarning = () => {},
}: ICreateStatusWebPushAdapterOptions) => ({
  async send(input: ISendStatusWebPushInput): Promise<IStatusSendWebPushResult> {
    const payload = buildStatusWebPushPayload(input);
    const request = {
      anyDeviceVisible: input.anyDeviceVisible,
      payload,
    };

    if (shouldUseRuntimeStatusDefault()) {
      try {
        const result = await sendRuntime(request);
        recordCounter('runtime_v2.status_web_push.sent', result.sent);
        recordCounter('runtime_v2.status_web_push.failed', result.failed);
        recordCounter('runtime_v2.status_web_push.removed', result.removed);
        if (result.skippedVisible) recordCounter('runtime_v2.status_web_push.skipped_visible');
        return result;
      } catch (err) {
        recordCounter('runtime_v2.status_web_push.fallback');
        logWarning(`runtime v2 Web Push send failed, falling back: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return sendLocal(request);
  },
});
