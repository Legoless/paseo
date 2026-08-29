import { create } from "zustand";

export interface AddProjectFlowTargetWorkspace {
  serverId: string;
  workspaceId: string;
}

export interface AddProjectFlowRequest {
  id: number;
  preferredHostId?: string;
  /** When set, the flow adds the picked project to this workspace instead of registering a standalone project. */
  targetWorkspace?: AddProjectFlowTargetWorkspace;
}

interface AddProjectFlowStoreState {
  request: AddProjectFlowRequest | null;
  open: (
    preferredHostId?: string,
    options?: { targetWorkspace?: AddProjectFlowTargetWorkspace },
  ) => void;
  close: () => void;
}

let nextRequestId = 1;

export const useAddProjectFlowStore = create<AddProjectFlowStoreState>((set) => ({
  request: null,
  open: (preferredHostId, options) => {
    set({
      request: {
        id: nextRequestId++,
        ...(preferredHostId ? { preferredHostId } : {}),
        ...(options?.targetWorkspace ? { targetWorkspace: options.targetWorkspace } : {}),
      },
    });
  },
  close: () => set({ request: null }),
}));
