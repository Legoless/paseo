import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import type { WorkspaceMemberDescriptor } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

/**
 * Per-workspace pick of which project member feeds project-scoped surfaces
 * (explorer trees, terminal spawns). Several members require an explicit selection, and the pick
 * is persisted so a relaunch does not drop a multi-project workspace back to "choose a project".
 */
interface WorkspaceProjectSelectionState {
  selectedCwdByWorkspaceKey: Record<string, string>;
  setSelectedCwd: (input: { workspaceKey: string; cwd: string }) => void;
}

const WorkspaceProjectSelectionPersistedStateSchema = z.strictObject({
  selectedCwdByWorkspaceKey: z.record(z.string(), z.string()),
});

export const useWorkspaceProjectSelectionStore = create<WorkspaceProjectSelectionState>()(
  persist(
    (set) => ({
      selectedCwdByWorkspaceKey: {},
      setSelectedCwd: ({ workspaceKey, cwd }) => {
        const normalizedKey = workspaceKey.trim();
        const normalizedCwd = cwd.trim();
        if (!normalizedKey || !normalizedCwd) return;
        set((state) => ({
          selectedCwdByWorkspaceKey: {
            ...state.selectedCwdByWorkspaceKey,
            [normalizedKey]: normalizedCwd,
          },
        }));
      },
    }),
    {
      name: "workspace-project-selection",
      storage: createValidatedPersistStorage(
        AsyncStorage,
        WorkspaceProjectSelectionPersistedStateSchema,
      ),
      partialize: (state) => ({ selectedCwdByWorkspaceKey: state.selectedCwdByWorkspaceKey }),
      version: 1,
    },
  ),
);

const EMPTY_MEMBERS: WorkspaceMemberDescriptor[] = [];

/**
 * A single member is unambiguous. Never redirect a removed selection to an
 * unrelated member in a workspace that still holds several projects.
 */
export function resolveSelectedWorkspaceMember(input: {
  members: WorkspaceMemberDescriptor[];
  selectedCwd: string | null;
}): WorkspaceMemberDescriptor | null {
  const selected = input.members.find((member) => member.workspaceDirectory === input.selectedCwd);
  return selected ?? (input.members.length === 1 ? input.members[0]! : null);
}

export interface SelectedWorkspaceProject {
  cwd: string | null;
  member: WorkspaceMemberDescriptor | null;
  members: WorkspaceMemberDescriptor[];
  setSelected: (cwd: string) => void;
}

export function useSelectedWorkspaceProject(
  serverId: string | null,
  workspaceId: string | null,
): SelectedWorkspaceProject {
  const members = useWorkspaceFields(serverId, workspaceId, (w) => w.members) ?? EMPTY_MEMBERS;
  const workspaceKey =
    serverId && workspaceId ? buildWorkspaceTabPersistenceKey({ serverId, workspaceId }) : null;
  const selectedCwd = useWorkspaceProjectSelectionStore((state) =>
    workspaceKey ? (state.selectedCwdByWorkspaceKey[workspaceKey] ?? null) : null,
  );
  const member = resolveSelectedWorkspaceMember({ members, selectedCwd });
  const setSelectedCwd = useWorkspaceProjectSelectionStore((state) => state.setSelectedCwd);
  const setSelected = useCallback(
    (cwd: string) => {
      if (!workspaceKey) return;
      setSelectedCwd({ workspaceKey, cwd });
    },
    [setSelectedCwd, workspaceKey],
  );
  return { cwd: member?.workspaceDirectory ?? null, member, members, setSelected };
}
