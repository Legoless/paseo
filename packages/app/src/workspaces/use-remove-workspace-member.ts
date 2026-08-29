import { useCallback } from "react";
import { Alert } from "react-native";
import { confirmDialog } from "@/utils/confirm-dialog";
import { removeWorkspaceMember, type WorkspaceMembersClient } from "@/workspaces/workspace-members";

export interface RemoveWorkspaceMemberInput {
  client: WorkspaceMembersClient | null;
  workspaceId: string;
  cwd: string;
  projectName: string;
}

/**
 * Confirms, then removes one project membership from a workspace. Guard refusals from the
 * daemon (last member, active agents, live terminals) surface as an alert.
 */
export function useRemoveWorkspaceMember(): (input: RemoveWorkspaceMemberInput) => Promise<void> {
  return useCallback(async (input: RemoveWorkspaceMemberInput) => {
    if (!input.client) {
      return;
    }
    const confirmed = await confirmDialog({
      title: "Remove project from workspace?",
      message: `"${input.projectName}" will no longer be part of this workspace. Its directory stays on disk.`,
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    const result = await removeWorkspaceMember({
      client: input.client,
      workspaceId: input.workspaceId,
      cwd: input.cwd,
    });
    if (!result.ok) {
      Alert.alert("Could not remove project", result.error ?? "Unknown error");
    }
  }, []);
}
