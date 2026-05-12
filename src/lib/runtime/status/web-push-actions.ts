import webpush from 'web-push';
import type { PushSubscription } from 'web-push';
import { getSubscriptions, removeSubscription } from '@/lib/push-subscriptions';
import { getVAPIDKeys } from '@/lib/vapid-keys';

export interface IStatusWebPushPayload {
  title: string;
  body: string;
  silent: boolean;
  tabId: string;
  workspaceId: string;
  agentSessionId: string | null;
  workspaceName: string;
  workspaceDir: string | null;
  approvalKind?: string;
  promptType?: string;
  riskLevel?: string;
  approvalDetail?: string | null;
}

export interface IStatusSendWebPushInput {
  anyDeviceVisible: boolean;
  payload: IStatusWebPushPayload;
}

export interface IStatusSendWebPushResult {
  skippedVisible: boolean;
  attempted: number;
  sent: number;
  removed: number;
  failed: number;
}

export interface IStatusWebPushActions {
  send: (input: IStatusSendWebPushInput) => Promise<IStatusSendWebPushResult>;
}

export interface ICreateStatusWebPushActionsDependencies {
  getSubscriptions?: () => Promise<PushSubscription[]>;
  removeSubscription?: (endpoint: string) => Promise<void>;
  getVAPIDKeys?: () => Promise<{ publicKey: string; privateKey: string }>;
  setVapidDetails?: (subject: string, publicKey: string, privateKey: string) => void;
  sendNotification?: (subscription: PushSubscription, payload: string) => Promise<unknown>;
}

export const createStatusWebPushActions = (
  dependencies: ICreateStatusWebPushActionsDependencies = {},
): IStatusWebPushActions => {
  const readSubscriptions = dependencies.getSubscriptions ?? getSubscriptions;
  const deleteSubscription = dependencies.removeSubscription ?? removeSubscription;
  const readVapidKeys = dependencies.getVAPIDKeys ?? getVAPIDKeys;
  const setVapidDetails = dependencies.setVapidDetails
    ?? ((subject, publicKey, privateKey) => webpush.setVapidDetails(subject, publicKey, privateKey));
  const sendNotification = dependencies.sendNotification
    ?? ((subscription, payload) => webpush.sendNotification(subscription, payload));

  return {
    async send({ anyDeviceVisible, payload }) {
      if (anyDeviceVisible) {
        return { skippedVisible: true, attempted: 0, sent: 0, removed: 0, failed: 0 };
      }

      const subs = await readSubscriptions();
      if (subs.length === 0) {
        return { skippedVisible: false, attempted: 0, sent: 0, removed: 0, failed: 0 };
      }

      const keys = await readVapidKeys();
      setVapidDetails('mailto:noreply@codexwinmux.app', keys.publicKey, keys.privateKey);

      let sent = 0;
      let removed = 0;
      let failed = 0;
      const body = JSON.stringify(payload);
      for (const sub of subs) {
        try {
          await sendNotification(sub, body);
          sent++;
        } catch (err: unknown) {
          failed++;
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 410 || status === 404) {
            await deleteSubscription(sub.endpoint);
            removed++;
          }
        }
      }

      return { skippedVisible: false, attempted: subs.length, sent, removed, failed };
    },
  };
};
