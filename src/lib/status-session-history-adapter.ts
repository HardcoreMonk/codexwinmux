import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';
import { addSessionHistoryEntry, updateSessionHistoryDismissedAt } from '@/lib/session-history';
import type { ISessionHistoryEntry } from '@/types/session-history';

export interface IStatusSessionHistoryRuntimeAdapter {
  addEntry(entry: ISessionHistoryEntry): Promise<void>;
  updateDismissedAt(input: { tabId: string; dismissedAt: number }): Promise<{ entry: ISessionHistoryEntry | null }>;
}

export interface IStatusSessionHistoryLocalAdapter {
  addEntry(entry: ISessionHistoryEntry): Promise<void>;
  updateDismissedAt(tabId: string, dismissedAt: number): Promise<ISessionHistoryEntry | null>;
}

export interface ICreateStatusSessionHistoryAdapterOptions {
  shouldUseRuntimeStatusDefault: () => boolean;
  runtime?: IStatusSessionHistoryRuntimeAdapter;
  local?: IStatusSessionHistoryLocalAdapter;
  recordCounter?: (name: string) => void;
  logWarning?: (message: string) => void;
}

export interface IStatusSessionHistoryAdapter {
  addEntry(entry: ISessionHistoryEntry): Promise<void>;
  updateDismissedAt(tabId: string, dismissedAt: number): Promise<ISessionHistoryEntry | null>;
}

const createRuntimeAdapter = (): IStatusSessionHistoryRuntimeAdapter => {
  const supervisor = getRuntimeSupervisor();
  return {
    addEntry: async (entry) => {
      await supervisor.addStatusSessionHistoryEntry(entry);
    },
    updateDismissedAt: (input) => supervisor.updateStatusSessionHistoryDismissedAt(input),
  };
};

export const createStatusSessionHistoryAdapter = ({
  shouldUseRuntimeStatusDefault,
  runtime = createRuntimeAdapter(),
  local = {
    addEntry: addSessionHistoryEntry,
    updateDismissedAt: updateSessionHistoryDismissedAt,
  },
  recordCounter = () => {},
  logWarning = () => {},
}: ICreateStatusSessionHistoryAdapterOptions): IStatusSessionHistoryAdapter => ({
  async addEntry(entry) {
    if (shouldUseRuntimeStatusDefault()) {
      try {
        await runtime.addEntry(entry);
        recordCounter('runtime_v2.status_session_history.add');
        return;
      } catch (err) {
        recordCounter('runtime_v2.status_session_history.add_fallback');
        logWarning(`runtime v2 session history add failed, falling back: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await local.addEntry(entry);
  },

  async updateDismissedAt(tabId, dismissedAt) {
    if (shouldUseRuntimeStatusDefault()) {
      try {
        const result = await runtime.updateDismissedAt({ tabId, dismissedAt });
        recordCounter('runtime_v2.status_session_history.dismiss_update');
        return result.entry;
      } catch (err) {
        recordCounter('runtime_v2.status_session_history.dismiss_update_fallback');
        logWarning(`runtime v2 session history dismiss update failed, falling back: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return local.updateDismissedAt(tabId, dismissedAt);
  },
});
