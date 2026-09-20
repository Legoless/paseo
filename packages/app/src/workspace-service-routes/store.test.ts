import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { createWorkspaceServiceRoutePreferencesStore } from "./store";

function createMemoryStorage(initial?: Record<string, string>): StateStorage & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    values,
    getItem: async (name) => values.get(name) ?? null,
    setItem: async (name, value) => {
      values.set(name, value);
    },
    removeItem: async (name) => {
      values.delete(name);
    },
  };
}

describe("workspace service route preferences", () => {
  it("persists each host's preferred route", async () => {
    const storage = createMemoryStorage();
    const first = createWorkspaceServiceRoutePreferencesStore(storage);
    await first.persist.rehydrate();

    await first.getState().setPreferredRoute("desktop", "direct");
    await first.getState().setPreferredRoute("devbox", "public");

    const restored = createWorkspaceServiceRoutePreferencesStore(storage);
    await restored.persist.rehydrate();
    expect(restored.getState().byServerId).toEqual({ desktop: "direct", devbox: "public" });
  });

  it("backs up the complete persisted value when one route kind is invalid", async () => {
    const rejected = JSON.stringify({
      state: { byServerId: { desktop: "direct", broken: "unknown" } },
      version: 1,
    });
    const storage = createMemoryStorage({
      "workspace-service-route-preferences": rejected,
    });
    const store = createWorkspaceServiceRoutePreferencesStore(storage);
    await store.persist.rehydrate();

    expect(store.getState().byServerId).toEqual({});
    expect(storage.values.get("workspace-service-route-preferences")).toBe(rejected);
    expect(storage.values.get("workspace-service-route-preferences:recovery")).toBe(rejected);
  });
});
