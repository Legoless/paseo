import { create } from "zustand";

export interface ConfirmDialogRequest {
  id: number;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  resolve: (confirmed: boolean) => void;
}

export type ConfirmDialogSpec = Omit<ConfirmDialogRequest, "id" | "resolve">;

interface ConfirmDialogStoreState {
  request: ConfirmDialogRequest | null;
  settle: (id: number, confirmed: boolean) => void;
}

let nextRequestId = 1;

export const useConfirmDialogStore = create<ConfirmDialogStoreState>((set, get) => ({
  request: null,
  settle: (id, confirmed) => {
    const current = get().request;
    // A stale settle can arrive from the closing animation of a dialog the next request already
    // replaced. Resolving by id keeps that from answering the wrong question.
    if (!current || current.id !== id) {
      return;
    }
    set({ request: null });
    current.resolve(confirmed);
  },
}));

/**
 * Queues one confirmation for the host to render and resolves when the user answers. A second
 * request while one is open cancels the first: two stacked confirmations have no reading order, and
 * every caller treats an unanswered dialog as a decline.
 */
export function requestConfirmDialog(spec: ConfirmDialogSpec): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const previous = useConfirmDialogStore.getState().request;
    useConfirmDialogStore.setState({
      request: { ...spec, id: nextRequestId++, resolve },
    });
    previous?.resolve(false);
  });
}
