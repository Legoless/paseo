import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  };
});

import { MAX_PROMPT_HISTORY_ITEMS, usePromptHistoryStore } from "./prompt-history-store";

describe("usePromptHistoryStore", () => {
  beforeEach(() => {
    usePromptHistoryStore.getState().clear();
  });

  it("appends sent prompts in order", () => {
    usePromptHistoryStore.getState().addPrompt("First prompt");
    usePromptHistoryStore.getState().addPrompt("Second prompt");

    expect(usePromptHistoryStore.getState().prompts).toEqual(["First prompt", "Second prompt"]);
  });

  it("trims prompts and ignores empty or whitespace-only inputs", () => {
    usePromptHistoryStore.getState().addPrompt("   ");
    usePromptHistoryStore.getState().addPrompt("");
    usePromptHistoryStore.getState().addPrompt("  Valid prompt  ");

    expect(usePromptHistoryStore.getState().prompts).toEqual(["Valid prompt"]);
  });

  it("deduplicates consecutive identical prompts", () => {
    usePromptHistoryStore.getState().addPrompt("repeat");
    usePromptHistoryStore.getState().addPrompt("repeat");
    usePromptHistoryStore.getState().addPrompt("different");
    usePromptHistoryStore.getState().addPrompt("repeat");

    expect(usePromptHistoryStore.getState().prompts).toEqual(["repeat", "different", "repeat"]);
  });

  it("caps history at MAX_PROMPT_HISTORY_ITEMS", () => {
    for (let i = 0; i < MAX_PROMPT_HISTORY_ITEMS + 10; i++) {
      usePromptHistoryStore.getState().addPrompt(`Prompt ${i}`);
    }

    const { prompts } = usePromptHistoryStore.getState();
    expect(prompts).toHaveLength(MAX_PROMPT_HISTORY_ITEMS);
    expect(prompts[0]).toBe("Prompt 10");
    expect(prompts[prompts.length - 1]).toBe(`Prompt ${MAX_PROMPT_HISTORY_ITEMS + 9}`);
  });

  it("clears prompt history", () => {
    usePromptHistoryStore.getState().addPrompt("To be cleared");
    expect(usePromptHistoryStore.getState().prompts).toHaveLength(1);

    usePromptHistoryStore.getState().clear();
    expect(usePromptHistoryStore.getState().prompts).toEqual([]);
  });
});
