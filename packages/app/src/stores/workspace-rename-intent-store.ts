import { create } from "zustand";

interface WorkspaceRenameIntentState {
  /**
   * The `serverId:workspaceId` key whose sidebar row should open its inline name
   * editor, or null. One at a time: a second request supersedes the first.
   */
  workspaceKey: string | null;
  request: (workspaceKey: string) => void;
  clear: (workspaceKey: string) => void;
}

/**
 * Carries a "name this one now" intent from whatever created a workspace to the
 * sidebar row that will render it. The row does not exist yet when the intent is
 * raised — the descriptor still has to arrive and the list has to re-project —
 * so this cannot be a prop or a ref.
 */
export const useWorkspaceRenameIntentStore = create<WorkspaceRenameIntentState>((set) => ({
  workspaceKey: null,
  request: (workspaceKey) => set({ workspaceKey }),
  // Keyed so a row that has finished editing cannot clear an intent raised for a
  // different workspace in the meantime.
  clear: (workspaceKey) =>
    set((state) => (state.workspaceKey === workspaceKey ? { workspaceKey: null } : state)),
}));

export function requestWorkspaceRename(input: { serverId: string; workspaceId: string }): void {
  useWorkspaceRenameIntentStore.getState().request(`${input.serverId}:${input.workspaceId}`);
}
