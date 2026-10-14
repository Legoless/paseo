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

import {
  MAX_DISMISSED_NOTIFICATIONS,
  useNotificationDismissalStore,
} from "./notification-dismissal-store";

describe("useNotificationDismissalStore", () => {
  beforeEach(() => {
    useNotificationDismissalStore.getState().clear();
  });

  it("remembers a dismissed notification message without duplicates", () => {
    const message = "Antigravity is running with full access";
    useNotificationDismissalStore.getState().dismiss(message);
    useNotificationDismissalStore.getState().dismiss(message);

    expect(useNotificationDismissalStore.getState().dismissedMessages).toEqual([message]);
  });

  it("keeps only the most recent dismissals", () => {
    for (let index = 0; index <= MAX_DISMISSED_NOTIFICATIONS; index += 1) {
      useNotificationDismissalStore.getState().dismiss(`notice_${index}`);
    }

    const messages = useNotificationDismissalStore.getState().dismissedMessages;
    expect(messages).toHaveLength(MAX_DISMISSED_NOTIFICATIONS);
    expect(messages).not.toContain("notice_0");
    expect(messages.at(-1)).toBe(`notice_${MAX_DISMISSED_NOTIFICATIONS}`);
  });
});
