import {
  createRuntimeEvent,
  createRuntimeReply,
  parseRuntimeCommandPayload,
  type IRuntimeEvent,
  type IRuntimeCommand,
  type IRuntimeReply,
} from '@/lib/runtime/ipc';
import { validateWorkerCommandEnvelope, type IInvalidWorkerCommand } from '@/lib/runtime/worker-command-validation';
import { reduceCodexState, reduceHookState } from '@/lib/status-state-machine';
import {
  shouldProcessHookEvent,
  shouldSendNeedsInputNotification,
  shouldSendReviewNotification,
} from '@/lib/status-notification-policy';
import { evaluateStatusClientEvent } from '@/lib/status-client-event-policy';
import { evaluateStatusSideEffects } from '@/lib/status-side-effect-policy';
import {
  createStatusSessionHistoryActions,
  type IStatusSessionHistoryActions,
} from '@/lib/runtime/status/session-history-actions';
import {
  createStatusWebPushActions,
  type IStatusWebPushActions,
} from '@/lib/runtime/status/web-push-actions';
import { StatusManager } from '@/lib/status-manager';
import { patchRuntimeTabStatusMetadata } from '@/lib/runtime/storage-read-owner';
import type { IClientTabStatusEntry, IStatusUpdateMessage, IStatusHookEventMessage, IRateLimitsUpdateMessage } from '@/types/status';
import type { ISessionHistoryUpdateMessage } from '@/types/status';
import { markDeviceHidden, markDeviceVisible } from '@/lib/push-subscriptions';

interface IStatusLiveManagerLike {
  init(): Promise<void>;
  shutdown(): void;
  getAllForClient(): Record<string, IClientTabStatusEntry>;
  updateTabFromHook(tmuxSession: string, event: string, notificationType?: string): void;
  dismissTab(tabId: string): boolean;
  ackNotificationInput(tabId: string, seq: number): boolean;
  notifyLastUserMessage(sessionName: string, message: string): boolean;
  registerTab(tabId: string, entry: Parameters<StatusManager['registerTab']>[1]): void;
  removeTab(tabId: string): boolean;
  poll(): Promise<void>;
}

export interface ICreateStatusWorkerServiceOptions {
  sessionHistoryActions?: IStatusSessionHistoryActions;
  webPushActions?: IStatusWebPushActions;
  emitEvent?: (event: IRuntimeEvent) => void;
  createLiveManager?: (broadcast: (event: object) => void) => IStatusLiveManagerLike;
}

export const createStatusWorkerService = (options: ICreateStatusWorkerServiceOptions = {}) => {
  const sessionHistoryActions = options.sessionHistoryActions ?? createStatusSessionHistoryActions();
  const webPushActions = options.webPushActions ?? createStatusWebPushActions();
  let liveStarted = false;
  let liveManager: IStatusLiveManagerLike | null = null;

  const emitStatusBroadcast = (event: object): void => {
    if (!options.emitEvent) return;
    const rawType = (event as { type?: unknown }).type;
    if (rawType === 'status:sync') {
      options.emitEvent(createRuntimeEvent({
        source: 'status',
        target: 'supervisor',
        type: 'status.sync',
        delivery: 'realtime',
        payload: { tabs: (event as { tabs: Record<string, IClientTabStatusEntry> }).tabs },
      }));
      return;
    }
    if (rawType === 'status:update') {
      const { type: _type, ...payload } = event as IStatusUpdateMessage;
      options.emitEvent(createRuntimeEvent({
        source: 'status',
        target: 'supervisor',
        type: 'status.update',
        delivery: 'realtime',
        payload,
      }));
      return;
    }
    if (rawType === 'session-history:update') {
      options.emitEvent(createRuntimeEvent({
        source: 'status',
        target: 'supervisor',
        type: 'status.session-history-update',
        delivery: 'realtime',
        payload: { entry: (event as ISessionHistoryUpdateMessage).entry },
      }));
      return;
    }
    if (rawType === 'status:hook-event') {
      const payload = event as IStatusHookEventMessage;
      options.emitEvent(createRuntimeEvent({
        source: 'status',
        target: 'supervisor',
        type: 'status.hook-event',
        delivery: 'realtime',
        payload: { tabId: payload.tabId, event: payload.event },
      }));
      return;
    }
    if (rawType === 'rate-limits:update') {
      options.emitEvent(createRuntimeEvent({
        source: 'status',
        target: 'supervisor',
        type: 'status.rate-limits-update',
        delivery: 'realtime',
        payload: { data: (event as IRateLimitsUpdateMessage).data },
      }));
    }
  };

  const getLiveManager = (): IStatusLiveManagerLike => {
    liveManager ??= options.createLiveManager?.(emitStatusBroadcast) ?? new StatusManager({
      broadcast: emitStatusBroadcast,
      useRuntimeAdapters: false,
      persistTabCliStatus: (entry) => {
        patchRuntimeTabStatusMetadata({
          sessionName: entry.tmuxSession,
          cliState: entry.cliState,
          dismissedAt: entry.dismissedAt ?? null,
        });
      },
    });
    return liveManager;
  };

  const ok = <TPayload>(command: IRuntimeCommand, payload: TPayload): IRuntimeReply<TPayload> =>
    createRuntimeReply({
      commandId: command.id,
      source: 'status',
      target: command.source,
      type: `${command.type}.reply`,
      ok: true,
      payload,
    });

  const fail = (command: IRuntimeCommand, code: string, message: string, retryable = false): IRuntimeReply<null> =>
    createRuntimeReply({
      commandId: command.id,
      source: 'status',
      target: command.source,
      type: `${command.type}.reply`,
      ok: false,
      payload: null,
      error: { code, message, retryable },
    });

  const invalidCommand = (command: IRuntimeCommand, error: IInvalidWorkerCommand): IRuntimeReply<null> =>
    createRuntimeReply({
      commandId: command.id,
      source: 'status',
      target: 'supervisor',
      type: `${command.type}.reply`,
      ok: false,
      payload: null,
      error,
    });

  return {
    async handleCommand(command: IRuntimeCommand): Promise<IRuntimeReply> {
      const invalid = validateWorkerCommandEnvelope(command, { workerName: 'status', namespace: 'status' });
      if (invalid) return invalidCommand(command, invalid);
      try {
        if (command.type === 'status.health') {
          return ok(command, { ok: true });
        }
        if (command.type === 'status.live-start') {
          await getLiveManager().init();
          liveStarted = true;
          return ok(command, { started: true });
        }
        if (command.type === 'status.live-stop') {
          const stopped = liveStarted;
          liveStarted = false;
          liveManager?.shutdown();
          liveManager = null;
          return ok(command, { stopped });
        }
        if (command.type === 'status.live-request-sync') {
          return ok(command, { tabs: liveManager?.getAllForClient() ?? {} });
        }
        if (command.type === 'status.live-hook-event') {
          const input = parseRuntimeCommandPayload('status.live-hook-event', command.payload);
          getLiveManager().updateTabFromHook(input.tmuxSession, input.event, input.notificationType);
          return ok(command, { accepted: true });
        }
        if (command.type === 'status.live-client-event') {
          const input = parseRuntimeCommandPayload('status.live-client-event', command.payload);
          const manager = getLiveManager();
          const accepted = input.eventType === 'dismiss-tab'
            ? manager.dismissTab(input.tabId)
            : manager.ackNotificationInput(input.tabId, input.seq ?? -1);
          return ok(command, { accepted });
        }
        if (command.type === 'status.live-notify-last-user-message') {
          const input = parseRuntimeCommandPayload('status.live-notify-last-user-message', command.payload);
          return ok(command, { accepted: getLiveManager().notifyLastUserMessage(input.sessionName, input.message) });
        }
        if (command.type === 'status.live-register-tab') {
          const input = parseRuntimeCommandPayload('status.live-register-tab', command.payload);
          getLiveManager().registerTab(input.tabId, input.entry);
          return ok(command, { accepted: true });
        }
        if (command.type === 'status.live-device-visibility') {
          const input = parseRuntimeCommandPayload('status.live-device-visibility', command.payload);
          if (input.visible) {
            markDeviceVisible(input.deviceId);
          } else {
            markDeviceHidden(input.deviceId);
          }
          return ok(command, { accepted: true });
        }
        if (command.type === 'status.live-remove-tab') {
          const input = parseRuntimeCommandPayload('status.live-remove-tab', command.payload);
          return ok(command, { accepted: getLiveManager().removeTab(input.tabId) });
        }
        if (command.type === 'status.live-poll') {
          await getLiveManager().poll();
          return ok(command, { polled: true });
        }
        if (command.type === 'status.reduce-hook-state') {
          const input = parseRuntimeCommandPayload('status.reduce-hook-state', command.payload);
          return ok(command, reduceHookState(input));
        }
        if (command.type === 'status.reduce-codex-state') {
          const input = parseRuntimeCommandPayload('status.reduce-codex-state', command.payload);
          return ok(command, reduceCodexState(input));
        }
        if (command.type === 'status.evaluate-notification-policy') {
          const input = parseRuntimeCommandPayload('status.evaluate-notification-policy', command.payload);
          return ok(command, {
            processHookEvent: shouldProcessHookEvent(input.eventName, input.notificationType),
            sendReviewNotification: shouldSendReviewNotification(input.newState, input.silent),
            sendNeedsInputNotification: shouldSendNeedsInputNotification(input.newState, input.silent),
          });
        }
        if (command.type === 'status.evaluate-side-effects') {
          const input = parseRuntimeCommandPayload('status.evaluate-side-effects', command.payload);
          return ok(command, evaluateStatusSideEffects(input));
        }
        if (command.type === 'status.evaluate-client-event') {
          const input = parseRuntimeCommandPayload('status.evaluate-client-event', command.payload);
          return ok(command, evaluateStatusClientEvent(input));
        }
        if (command.type === 'status.add-session-history-entry') {
          const input = parseRuntimeCommandPayload('status.add-session-history-entry', command.payload);
          return ok(command, await sessionHistoryActions.addEntry(input.entry));
        }
        if (command.type === 'status.update-session-history-dismissed-at') {
          const input = parseRuntimeCommandPayload('status.update-session-history-dismissed-at', command.payload);
          return ok(command, await sessionHistoryActions.updateDismissedAt(input.tabId, input.dismissedAt));
        }
        if (command.type === 'status.send-web-push') {
          const input = parseRuntimeCommandPayload('status.send-web-push', command.payload);
          return ok(command, await webPushActions.send(input));
        }
        return invalidCommand(command, {
          code: 'invalid-worker-command',
          message: `Unsupported status command: ${command.type}`,
          retryable: false,
        });
      } catch (err) {
        const maybeStructured = err as { code?: string; retryable?: boolean } | null;
        return fail(
          command,
          maybeStructured?.code ?? 'command-failed',
          err instanceof Error ? err.message : String(err),
          maybeStructured?.retryable ?? false,
        );
      }
    },

    close(): void {
      liveStarted = false;
      liveManager?.shutdown();
      liveManager = null;
    },
  };
};
