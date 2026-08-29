import { useCallback } from "react";
import { create } from "zustand";
import type { WorkspaceMemberDescriptor } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

/**
 * Per-workspace pick of which project member feeds project-scoped surfaces
 * (explorer trees, terminal spawns). In-memory only — phase 1 does not persist
 * the pick across launches. The default is always the primary member.
 */
interface WorkspaceProjectSelectionState {
  selectedCwdByWorkspaceKey: Record<string, string>;
  setSelectedCwd: (input: { workspaceKey: string; cwd: string }) => void;
}

export const useWorkspaceProjectSelectionStore = create<WorkspaceProjectSelectionState>((set) => ({
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
}));

const EMPTY_MEMBERS: WorkspaceMemberDescriptor[] = [];

/**
 * Resolves the member a workspace surface should use. Falls back to the primary
 * member when nothing is stored or the stored cwd no longer matches a member
 * (e.g. the member was removed from the workspace).
 */
export function resolveSelectedWorkspaceMember(input: {
  members: WorkspaceMemberDescriptor[];
  selectedCwd: string | null;
}): WorkspaceMemberDescriptor | null {
  const primary = input.members[0] ?? null;
  if (!primary) {
    return null;
  }
  if (!input.selectedCwd) {
    return primary;
  }
  return input.members.find((member) => member.workspaceDirectory === input.selectedCwd) ?? primary;
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
