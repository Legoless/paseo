import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { StateStorage } from "zustand/middleware";
import { createValidatedPersistStorage } from "./validated-persist-storage";

class MemoryStorage implements StateStorage {
  readonly values = new Map<string, string>();
  readError: Error | null = null;
  failedWriteKey: string | null = null;

  getItem(name: string): string | null {
    if (this.readError) throw this.readError;
    return this.values.get(name) ?? null;
  }

  setItem(name: string, value: string): void {
    if (name === this.failedWriteKey) throw new Error("Storage write failed");
    this.values.set(name, value);
  }

  removeItem(name: string): void {
    this.values.delete(name);
  }
}

const StateSchema = z.strictObject({ enabled: z.boolean() });

describe("createValidatedPersistStorage", () => {
  it.each([
    ["malformed JSON", "{"],
    ["invalid state", JSON.stringify({ state: { enabled: "yes" }, version: 1 })],
    ["unknown state fields", JSON.stringify({ state: { enabled: true, extra: true }, version: 1 })],
    [
      "unknown envelope fields",
      JSON.stringify({ state: { enabled: true }, version: 1, extra: true }),
    ],
  ])("backs up %s before returning defaults", async (_label, stored) => {
    const backing = new MemoryStorage();
    backing.values.set("settings", stored);
    const storage = createValidatedPersistStorage(backing, StateSchema);

    await expect(storage.getItem("settings")).resolves.toBeNull();
    expect(backing.values.get("settings")).toBe(stored);
    expect(backing.values.get("settings:recovery")).toBe(stored);
  });

  it("returns schema-validated state", async () => {
    const backing = new MemoryStorage();
    backing.values.set("settings", JSON.stringify({ state: { enabled: true }, version: 1 }));
    const storage = createValidatedPersistStorage(backing, StateSchema);

    await expect(storage.getItem("settings")).resolves.toEqual({
      state: { enabled: true },
      version: 1,
    });
  });

  it("preserves the previous value and recovery snapshot when a write is rejected", async () => {
    const backing = new MemoryStorage();
    const saved = JSON.stringify({ state: { count: 1 } });
    backing.values.set("settings", saved);
    backing.values.set("settings:recovery", "previous rejected snapshot");
    const storage = createValidatedPersistStorage(
      backing,
      z.strictObject({ count: z.number().finite() }),
    );

    await storage.setItem("settings", { state: { count: Number.NaN } });

    expect(backing.values.get("settings")).toBe(saved);
    expect(backing.values.get("settings:recovery")).toBe("previous rejected snapshot");
  });

  it("backs up an unread rejected primary before defaults overwrite it", async () => {
    const backing = new MemoryStorage();
    const rejected = JSON.stringify({ state: { enabled: true, savedLayout: "keep me" } });
    backing.values.set("settings", rejected);
    const storage = createValidatedPersistStorage(backing, StateSchema);

    await storage.setItem("settings", { state: { enabled: false } });

    expect(backing.values.get("settings")).toBe(JSON.stringify({ state: { enabled: false } }));
    expect(backing.values.get("settings:recovery")).toBe(rejected);

    await storage.setItem("settings", { state: { enabled: true } });

    expect(backing.values.get("settings")).toBe(JSON.stringify({ state: { enabled: true } }));
    expect(backing.values.get("settings:recovery")).toBe(rejected);
    expect(backing.values.size).toBe(2);
  });

  it("keeps the latest rejected primary for recovery across later schema failures", async () => {
    const backing = new MemoryStorage();
    backing.values.set("settings:recovery", "older rejected snapshot");
    backing.values.set("settings", "newer malformed JSON");
    const storage = createValidatedPersistStorage(backing, StateSchema);

    await expect(storage.getItem("settings")).resolves.toBeNull();
    await storage.setItem("settings", { state: { enabled: false } });

    expect(backing.values.get("settings")).toBe(JSON.stringify({ state: { enabled: false } }));
    expect(backing.values.get("settings:recovery")).toBe("newer malformed JSON");
    expect(backing.values.size).toBe(2);
  });

  it("preserves the original when recovery storage fails, including subsequent default writes", async () => {
    const backing = new MemoryStorage();
    backing.values.set("settings", "malformed JSON");
    backing.values.set("settings:recovery", "older rejected snapshot");
    backing.failedWriteKey = "settings:recovery";
    const storage = createValidatedPersistStorage(backing, StateSchema);

    await expect(storage.getItem("settings")).rejects.toThrow("Storage write failed");
    await expect(storage.setItem("settings", { state: { enabled: false } })).rejects.toThrow(
      "Storage write failed",
    );

    expect(backing.values.get("settings")).toBe("malformed JSON");
    expect(backing.values.get("settings:recovery")).toBe("older rejected snapshot");
  });

  it("propagates read failures without replacing a stored value with defaults", async () => {
    const backing = new MemoryStorage();
    const saved = JSON.stringify({ state: { enabled: true } });
    backing.values.set("settings", saved);
    backing.readError = new Error("Storage read failed");
    const storage = createValidatedPersistStorage(backing, StateSchema);

    await expect(storage.getItem("settings")).rejects.toThrow("Storage read failed");
    await expect(storage.setItem("settings", { state: { enabled: false } })).rejects.toThrow(
      "Storage read failed",
    );

    expect(backing.values.get("settings")).toBe(saved);
    expect(backing.values.size).toBe(1);
  });
});
