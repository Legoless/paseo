import { useCallback } from "react";
import { useToast } from "@/contexts/toast-context";
import { moveWorkspaceMemberErrorMessage } from "@/workspaces/move-workspace-member-message";
import { moveWorkspaceMember, type WorkspaceMembersClient } from "@/workspaces/workspace-members";

export interface MoveWorkspaceMemberInput {
  client: WorkspaceMembersClient | null;
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  cwd: string;
  projectName: string;
  targetTitle: string;
}

/**
 * Moves one project membership to another workspace, taking its agents and terminals along.
 * Unlike removal nothing is archived, so there is nothing to confirm; a refusal (the target
 * already holds the project) surfaces as a toast, which also keeps this honest on web where
 * `Alert.alert` renders nothing.
 */
export function useMoveWorkspaceMember(): (input: MoveWorkspaceMemberInput) => Promise<boolean> {
  const toast = useToast();
  return useCallback(
    async (input: MoveWorkspaceMemberInput): Promise<boolean> => {
      if (!input.client) {
        return false;
      }
      try {
        const result = await moveWorkspaceMember({
          client: input.client,
          sourceWorkspaceId: input.sourceWorkspaceId,
          targetWorkspaceId: input.targetWorkspaceId,
          cwd: input.cwd,
        });
        if (!result.ok) {
          toast.error(
            moveWorkspaceMemberErrorMessage({
              errorCode: result.errorCode,
              error: result.error,
              projectName: input.projectName,
              targetTitle: input.targetTitle,
            }),
          );
          return false;
        }
        return true;
      } catch (error) {
        toast.error(
          moveWorkspaceMemberErrorMessage({
            errorCode: null,
            error: error instanceof Error ? error.message : null,
            projectName: input.projectName,
            targetTitle: input.targetTitle,
          }),
        );
        return false;
      }
    },
    [toast],
  );
}
