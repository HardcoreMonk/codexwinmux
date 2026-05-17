import { WebSocket } from 'ws';
import { getStatusManager } from '@/lib/status-manager';
import { getSessionHistory } from '@/lib/session-history';
import { createLogger } from '@/lib/logger';
import { isRuntimeV2Enabled } from '@/lib/runtime/env';
import { getRuntimeStatusV2Mode } from '@/lib/runtime/status-mode';
import { getCoreRuntimeApi } from '@/lib/core-engine/runtime-api';
import type { IRuntimeStatusLiveEvent } from '@/lib/runtime/contracts';
import type {
  TStatusClientMessage,
  TStatusServerMessage,
  IStatusSyncMessage,
  ISessionHistorySyncMessage,
} from '@/types/status';

const log = createLogger('status');

const shouldUseRuntimeStatusLive = (): boolean =>
  isRuntimeV2Enabled() && getRuntimeStatusV2Mode() === 'default';

const sendJson = (ws: WebSocket, event: object): void => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
};

const toStatusServerMessage = (event: IRuntimeStatusLiveEvent): TStatusServerMessage | null => {
  if (event.type === 'status.sync') {
    return { type: 'status:sync', tabs: event.payload.tabs };
  }
  if (event.type === 'status.update') {
    return { type: 'status:update', ...event.payload };
  }
  if (event.type === 'status.session-history-update') {
    return { type: 'session-history:update', entry: event.payload.entry };
  }
  if (event.type === 'status.hook-event') {
    return { type: 'status:hook-event', tabId: event.payload.tabId, event: event.payload.event };
  }
  if (event.type === 'status.error') {
    log.warn('runtime status live error: %s', event.payload.message);
  }
  if (event.type === 'status.rate-limits-update') {
    return { type: 'rate-limits:update', data: event.payload.data };
  }
  return null;
};

const sendSessionHistorySync = (ws: WebSocket): void => {
  getSessionHistory().then((entries) => {
    const historySync: ISessionHistorySyncMessage = { type: 'session-history:sync', entries };
    sendJson(ws, historySync);
  }).catch(() => {});
};

const handleRuntimeStatusConnection = (ws: WebSocket): void => {
  const runtime = getCoreRuntimeApi();
  let subscriberId: string | null = null;
  let closed = false;

  runtime.subscribeStatusLive({
    onEvent: (event) => {
      const msg = toStatusServerMessage(event);
      if (msg) sendJson(ws, msg);
    },
  }).then((subscription) => {
    if (closed) {
      runtime.unsubscribeStatusLive(subscription.subscriberId).catch((err) => {
        log.warn('runtime status unsubscribe failed: %s', err instanceof Error ? err.message : String(err));
      });
      return;
    }
    subscriberId = subscription.subscriberId;
    sendJson(ws, { type: 'status:sync', tabs: subscription.sync.tabs } satisfies IStatusSyncMessage);
  }).catch((err) => {
    log.error('runtime status subscribe failed: %s', err instanceof Error ? err.message : String(err));
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1011, 'Runtime status unavailable');
    }
  });

  sendSessionHistorySync(ws);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as TStatusClientMessage;
      switch (msg.type) {
        case 'status:tab-dismissed':
          runtime.sendStatusLiveClientEvent({ eventType: 'dismiss-tab', tabId: msg.tabId }).catch((err) => {
            log.warn('runtime status dismiss failed: %s', err instanceof Error ? err.message : String(err));
          });
          break;

        case 'status:ack-notification':
          runtime.sendStatusLiveClientEvent({ eventType: 'ack-notification', tabId: msg.tabId, seq: msg.seq }).catch((err) => {
            log.warn('runtime status ack failed: %s', err instanceof Error ? err.message : String(err));
          });
          break;

        case 'status:request-sync':
          runtime.requestStatusLiveSync().then((sync) => {
            sendJson(ws, { type: 'status:sync', tabs: sync.tabs } satisfies IStatusSyncMessage);
          }).catch((err) => {
            log.warn('runtime status sync failed: %s', err instanceof Error ? err.message : String(err));
          });
          break;

        default:
          log.warn(`Unknown event: ${(msg as { type: string }).type}`);
      }
    } catch {
      // invalid message
    }
  });

  const cleanup = () => {
    closed = true;
    if (subscriberId) {
      runtime.unsubscribeStatusLive(subscriberId).catch((err) => {
        log.warn('runtime status unsubscribe failed: %s', err instanceof Error ? err.message : String(err));
      });
      subscriberId = null;
    }
  };

  ws.on('close', cleanup);
  ws.on('error', (err) => {
    log.error(`websocket error: ${err.message}`);
    cleanup();
  });
};

const handleLegacyStatusConnection = (ws: WebSocket): void => {
  const manager = getStatusManager();
  manager.addClient(ws);

  const syncMsg: IStatusSyncMessage = {
    type: 'status:sync',
    tabs: manager.getAllForClient(),
  };
  sendJson(ws, syncMsg);

  sendSessionHistorySync(ws);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as TStatusClientMessage;

      switch (msg.type) {
        case 'status:tab-dismissed':
          manager.dismissTab(msg.tabId, ws);
          break;

        case 'status:ack-notification':
          manager.ackNotificationInput(msg.tabId, msg.seq);
          break;

        case 'status:request-sync': {
          const sync: IStatusSyncMessage = {
            type: 'status:sync',
            tabs: manager.getAllForClient(),
          };
          sendJson(ws, sync);
          break;
        }

        default:
          log.warn(`Unknown event: ${(msg as { type: string }).type}`);
      }
    } catch {
      // invalid message
    }
  });

  ws.on('close', () => {
    manager.removeClient(ws);
  });

  ws.on('error', (err) => {
    log.error(`websocket error: ${err.message}`);
    manager.removeClient(ws);
  });
};

export const handleStatusConnection = (ws: WebSocket) => {
  if (shouldUseRuntimeStatusLive()) {
    handleRuntimeStatusConnection(ws);
    return;
  }
  handleLegacyStatusConnection(ws);
};

export const gracefulStatusShutdown = () => {
  getStatusManager().shutdown();
};
