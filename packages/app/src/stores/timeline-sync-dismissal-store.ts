import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

// A history that can never refresh (the provider deleted the session) fails on every retry, so
// a dismissal has to outlive the callout, the pane, and the app session.
export const MAX_DISMISSED_TIMELINE_SYNC_AGENTS = 200;

export interface TimelineSyncDismissalStoreState {
  dismissedAgentKeys: string[];
  dismiss: (agentKey: string) => void;
  clear: () => void;
}

interface TimelineSyncDismissalPersistedState {
  dismissedAgentKeys: string[];
}

const PersistedStateSchema: z.ZodType<TimelineSyncDismissalPersistedState> = z.strictObject({
  dismissedAgentKeys: z.array(z.string()).catch([]),
});

export function timelineSyncDismissalKey(serverId: string, agentId: string): string {
  return `${serverId}:${agentId}`;
}

export const useTimelineSyncDismissalStore = create<TimelineSyncDismissalStoreState>()(
  persist(
    (set, get) => ({
      dismissedAgentKeys: [],
      dismiss: (agentKey: string) => {
        const current = get().dismissedAgentKeys;
        if (current.includes(agentKey)) return;
        set({
          dismissedAgentKeys: [...current, agentKey].slice(-MAX_DISMISSED_TIMELINE_SYNC_AGENTS),
        });
      },
      clear: () => set({ dismissedAgentKeys: [] }),
    }),
    {
      name: "paseo-timeline-sync-dismissals",
      storage: createValidatedPersistStorage(AsyncStorage, PersistedStateSchema),
      partialize: (state) => ({ dismissedAgentKeys: state.dismissedAgentKeys }),
    },
  ),
);
