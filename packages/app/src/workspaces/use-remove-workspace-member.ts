import { useCallback } from "react";
import { useToast } from "@/contexts/toast-context";
import { confirmDialog } from "@/utils/confirm-dialog";
import {
  buildRemoveWorkspaceMemberDialog,
  removeWorkspaceMemberErrorMessage,
} from "@/workspaces/remove-workspace-member-message";
import { removeWorkspaceMember, type WorkspaceMembersClient } from "@/workspaces/workspace-members";

export interface RemoveWorkspaceMemberInput {
  client: WorkspaceMembersClient | null;
  workspaceId: string;
  cwd: string;
  projectName: string;
  /** Agents still in this directory. The daemon archives them as part of the removal. */
  agentCount: number;
}

/**
 * Confirms, then removes one project membership from a workspace. The daemon archives the agents
 * left in that directory, so the confirmation names them first. Refusals it can still return (last
 * member, a live terminal) surface as a toast: this runs on desktop and web, where `Alert.alert`
 * renders nothing, so an alert made a refusal look like the button doing nothing at all.
 */
export function useRemoveWorkspaceMember(): (input: RemoveWorkspaceMemberInput) => Promise<void> {
  const toast = useToast();
  return useCallback(
    async (input: RemoveWorkspaceMemberInput) => {
      if (!input.client) {
        return;
      }
      const confirmed = await confirmDialog(
        buildRemoveWorkspaceMemberDialog({
          projectName: input.projectName,
          agentCount: input.agentCount,
        }),
      );
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
