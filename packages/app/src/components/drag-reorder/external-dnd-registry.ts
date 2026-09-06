import { createContext } from "react";
import { reorderItemsOnDragEnd } from "./reorder-items";

/**
 * Shared plumbing for `DraggableList externalDndContext` mode: the owning DndContext
 * routes a same-list drop back to the list that owns the data, through here.
 */
export interface ExternalDndListRegistration<T = unknown> {
  getData: () => T[];
  keyExtractor: (item: T, index: number) => string;
  commit: (items: T[]) => void;
}

export interface ExternalDndListRegistry {
  registerList: (id: string, registration: ExternalDndListRegistration) => void;
  unregisterList: (id: string) => void;
  /** Reorders the list that owns the dragged item and commits through its onDragEnd. */
  reorderSameList: (input: { listId: string; activeId: string; overId: string | null }) => void;
}

export const ExternalDndListRegistryContext = createContext<ExternalDndListRegistry | null>(null);
export const ExternalDndActiveIdContext = createContext<string | null>(null);

export function createExternalDndListRegistry(
  lists: Map<string, ExternalDndListRegistration>,
): ExternalDndListRegistry {
  return {
    registerList: (id, registration) => {
      lists.set(id, registration);
    },
    unregisterList: (id) => {
      lists.delete(id);
    },
    reorderSameList: ({ listId, activeId, overId }) => {
      const registration = lists.get(listId);
      if (!registration) {
        return;
      }
      const reordered = reorderItemsOnDragEnd({
        items: registration.getData(),
        activeId,
        overId,
        keyExtractor: registration.keyExtractor,
      });
      if (reordered) {
        registration.commit(reordered);
      }
    },
  };
}
