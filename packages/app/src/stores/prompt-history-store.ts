import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

export const MAX_PROMPT_HISTORY_ITEMS = 100;

export interface PromptHistoryStoreState {
  prompts: string[];
  addPrompt: (prompt: string) => void;
  clear: () => void;
}

interface PromptHistoryPersistedState {
  prompts: string[];
}

const PromptHistoryPersistedStateSchema: z.ZodType<PromptHistoryPersistedState> = z.strictObject({
  prompts: z.array(z.string()).catch([]),
});

export const usePromptHistoryStore = create<PromptHistoryStoreState>()(
  persist(
    (set, get) => ({
      prompts: [],
      addPrompt: (prompt: string) => {
        const trimmed = prompt.trim();
        if (trimmed.length === 0) return;
        const current = get().prompts;
        const lastPrompt = current[current.length - 1];
        if (lastPrompt === trimmed) return;
        const next = [...current, trimmed];
        if (next.length > MAX_PROMPT_HISTORY_ITEMS) {
          next.splice(0, next.length - MAX_PROMPT_HISTORY_ITEMS);
        }
        set({ prompts: next });
      },
      clear: () => set({ prompts: [] }),
    }),
    {
      name: "paseo-prompt-history",
      storage: createValidatedPersistStorage(AsyncStorage, PromptHistoryPersistedStateSchema),
      partialize: (state) => ({ prompts: state.prompts }),
    },
  ),
);
