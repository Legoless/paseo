import { useCallback } from "react";
import { useToast } from "@/contexts/toast-context";
import { moveWorkspaceMemberErrorMessage } from "@/workspaces/move-workspace-member-message";
import { moveWorkspaceMember, type WorkspaceMembersClient } from "@/workspaces/workspace-members";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { selectWorkspaceMemberTabs } from "@/workspaces/workspace-tab-move";

export interface MoveWorkspaceMemberInput {
  client: WorkspaceMembersClient | null;
  serverId: string;
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  cwd: string;
  projectName: string;
  targetTitle: string;
}

/**
 * Moves one project membership to another workspace, taking its agents and terminals along.
 * Existing target membership is merged. Tabs and remembered sidebar order follow the project.
 */
export function useMoveWorkspaceMember(): (input: MoveWorkspaceMemberInput) => Promise<boolean> {
  const toast = useToast();
  return useCallback(
    async (input: MoveWorkspaceMemberInput): Promise<boolean> => {
      if (!input.client) {
        return false;
      }
      const sourceKey = `${input.serverId}:${input.sourceWorkspaceId}`;
      const targetKey = `${input.serverId}:${input.targetWorkspaceId}`;
      // Directory updates may reconcile the moved tabs out before the RPC response arrives.
      const sourceLayout = useWorkspaceLayoutStore.getState().layoutByWorkspace[sourceKey];
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
        useWorkspaceLayoutStore.getState().transferTabs({
          sourceWorkspaceKey: sourceKey,
          targetWorkspaceKey: targetKey,
          tabs: selectWorkspaceMemberTabs({
            layout: useWorkspaceLayoutStore.getState().layoutByWorkspace[sourceKey],
            capturedLayout: sourceLayout,
            cwd: input.cwd,
            agentIds: result.movedAgentIds,
            terminalIds: result.movedTerminalIds,
          }),
          sourceParentTabIdByTabId: sourceLayout?.parentTabIdByTabId,
          agentIds: result.movedAgentIds,
        });
        const order = useSidebarOrderStore.getState();
        const sourceMemberKey = `${sourceKey}#${input.cwd}`;
        const targetMemberKey = `${targetKey}#${input.cwd}`;
        order.rekeyAgentOrder(sourceMemberKey, targetMemberKey);
        order.setMemberOrder(
          sourceKey,
          order.getMemberOrder(sourceKey).filter((key) => key !== sourceMemberKey),
        );
        const targetOrder = order.getMemberOrder(targetKey);
        if (!targetOrder.includes(targetMemberKey)) {
          order.setMemberOrder(targetKey, [...targetOrder, targetMemberKey]);
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
