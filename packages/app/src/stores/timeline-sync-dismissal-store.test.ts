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
  MAX_DISMISSED_TIMELINE_SYNC_AGENTS,
  timelineSyncDismissalKey,
  useTimelineSyncDismissalStore,
} from "./timeline-sync-dismissal-store";

describe("useTimelineSyncDismissalStore", () => {
  beforeEach(() => {
    useTimelineSyncDismissalStore.getState().clear();
  });

  it("remembers a dismissal per server and agent", () => {
    useTimelineSyncDismissalStore.getState().dismiss(timelineSyncDismissalKey("srv_a", "agent_1"));
    useTimelineSyncDismissalStore.getState().dismiss(timelineSyncDismissalKey("srv_a", "agent_1"));

    expect(useTimelineSyncDismissalStore.getState().dismissedAgentKeys).toEqual(["srv_a:agent_1"]);
  });

  it("keeps only the most recent dismissals", () => {
    for (let index = 0; index <= MAX_DISMISSED_TIMELINE_SYNC_AGENTS; index += 1) {
      useTimelineSyncDismissalStore.getState().dismiss(`srv:agent_${index}`);
    }

    const keys = useTimelineSyncDismissalStore.getState().dismissedAgentKeys;
    expect(keys).toHaveLength(MAX_DISMISSED_TIMELINE_SYNC_AGENTS);
    expect(keys).not.toContain("srv:agent_0");
    expect(keys.at(-1)).toBe(`srv:agent_${MAX_DISMISSED_TIMELINE_SYNC_AGENTS}`);
  });

  it("lifts only the agent whose history refreshed", () => {
    const store = useTimelineSyncDismissalStore.getState();
    store.dismiss(timelineSyncDismissalKey("srv_a", "agent_1"));
    store.dismiss(timelineSyncDismissalKey("srv_a", "agent_2"));

    useTimelineSyncDismissalStore
      .getState()
      .undismiss(timelineSyncDismissalKey("srv_a", "agent_1"));

    expect(useTimelineSyncDismissalStore.getState().dismissedAgentKeys).toEqual(["srv_a:agent_2"]);
  });
});
