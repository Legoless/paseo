import { useCallback } from "react";
import { useToast } from "@/contexts/toast-context";
import { confirmDialog } from "@/utils/confirm-dialog";
import { removeWorkspaceMemberErrorMessage } from "@/workspaces/remove-workspace-member-message";
import { removeWorkspaceMember, type WorkspaceMembersClient } from "@/workspaces/workspace-members";

export interface RemoveWorkspaceMemberInput {
  client: WorkspaceMembersClient | null;
  workspaceId: string;
  cwd: string;
  projectName: string;
}

/**
 * Confirms, then removes one project membership from a workspace. Guard refusals from the daemon
 * (last member, agents still in the directory, live terminals) surface as a toast: this runs on
 * desktop and web, where `Alert.alert` renders nothing, so an alert made a refusal look like the
 * button doing nothing at all.
 */
export function useRemoveWorkspaceMember(): (input: RemoveWorkspaceMemberInput) => Promise<void> {
  const toast = useToast();
  return useCallback(
    async (input: RemoveWorkspaceMemberInput) => {
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
      try {
        const result = await removeWorkspaceMember({
          client: input.client,
          workspaceId: input.workspaceId,
          cwd: input.cwd,
        });
        if (!result.ok) {
          toast.error(
            removeWorkspaceMemberErrorMessage({ ...result, projectName: input.projectName }),
          );
        }
      } catch (error) {
        toast.error(
          removeWorkspaceMemberErrorMessage({
            errorCode: null,
            error: error instanceof Error ? error.message : null,
            projectName: input.projectName,
          }),
        );
      }
    },
    [toast],
  );
}
