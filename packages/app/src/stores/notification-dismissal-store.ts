import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

export const MAX_DISMISSED_NOTIFICATIONS = 200;

export interface NotificationDismissalStoreState {
  dismissedMessages: string[];
  dismiss: (message: string) => void;
  clear: () => void;
}

interface NotificationDismissalPersistedState {
  dismissedMessages: string[];
}

const PersistedStateSchema: z.ZodType<NotificationDismissalPersistedState> = z.strictObject({
  dismissedMessages: z.array(z.string()).catch([]),
});

export const useNotificationDismissalStore = create<NotificationDismissalStoreState>()(
  persist(
    (set, get) => ({
      dismissedMessages: [],
      dismiss: (message: string) => {
        const current = get().dismissedMessages;
        if (current.includes(message)) return;
        set({
          dismissedMessages: [...current, message].slice(-MAX_DISMISSED_NOTIFICATIONS),
        });
      },
      clear: () => set({ dismissedMessages: [] }),
    }),
    {
      name: "paseo-notification-dismissals",
      storage: createValidatedPersistStorage(AsyncStorage, PersistedStateSchema),
      partialize: (state) => ({ dismissedMessages: state.dismissedMessages }),
    },
  ),
);
