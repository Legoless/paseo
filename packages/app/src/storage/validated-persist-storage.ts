import { z } from "zod";
import type { PersistStorage, StateStorage } from "zustand/middleware";

export function createValidatedPersistStorage<State>(
  backingStorage: StateStorage,
  stateSchema: z.ZodType<State>,
): PersistStorage<State> {
  const envelopeSchema = z.strictObject({
    state: stateSchema,
    version: z.number().int().nonnegative().optional(),
  });

  const getItem: PersistStorage<State>["getItem"] = async (name) => {
    const raw = await backingStorage.getItem(name);
    if (raw === null) return null;

    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      decoded = null;
    }

    const result = envelopeSchema.safeParse(decoded);
    if (result.success) return result.data;

    // ponytail: one rejected snapshot per key; use a journal if recovery needs history.
    await backingStorage.setItem(`${name}:recovery`, raw);
    return null;
  };

  return {
    getItem,
    setItem: async (name, value) => {
      const result = envelopeSchema.safeParse(value);
      if (!result.success) return;
      // Hydration can fail while the store keeps running with defaults. Back up first.
      await getItem(name);
      await backingStorage.setItem(name, JSON.stringify(result.data));
    },
    removeItem: (name) => backingStorage.removeItem(name),
  };
}
