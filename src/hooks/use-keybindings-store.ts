import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import {
  ACTIONS,
  applyKeybindingOverrides,
  getResolvedKey,
  subscribeKeybindings,
  type TActionId,
  type TKeybindingOverride,
} from '@/lib/keyboard-shortcuts';

interface IKeybindingsState {
  overrides: Record<string, TKeybindingOverride>;
  loaded: boolean;
  load: () => Promise<void>;
  setBinding: (id: TActionId, key: TKeybindingOverride) => Promise<void>;
  resetBinding: (id: TActionId) => Promise<void>;
  resetAll: () => Promise<void>;
}

const refreshFetchInit: RequestInit = { cache: 'no-store' };

const useKeybindingsStore = create<IKeybindingsState>((set, get) => ({
  overrides: {},
  loaded: false,

  load: async () => {
    try {
      const res = await fetch('/api/keybindings', refreshFetchInit);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const overrides: Record<string, TKeybindingOverride> = data.overrides ?? {};
      applyKeybindingOverrides(overrides);
      set({ overrides, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  setBinding: async (id, key) => {
    const next = { ...get().overrides, [id]: key };
    applyKeybindingOverrides(next);
    set({ overrides: next });
    try {
      await fetch('/api/keybindings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, key }),
      });
    } catch {}
  },

  resetBinding: async (id) => {
    const next = { ...get().overrides };
    delete next[id];
    applyKeybindingOverrides(next);
    set({ overrides: next });
    try {
      await fetch(`/api/keybindings?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    } catch {}
  },

  resetAll: async () => {
    applyKeybindingOverrides({});
    set({ overrides: {} });
    try {
      await fetch('/api/keybindings', { method: 'DELETE' });
    } catch {}
  },
}));

export default useKeybindingsStore;

export const useResolvedKey = (id: TActionId): string | null => {
  return useSyncExternalStore(
    subscribeKeybindings,
    () => getResolvedKey(id),
    () => ACTIONS[id].defaultKey,
  );
};
