import { useCallback } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useToast } from "@/contexts/toast-context";
import { moveAgentWorkspaceErrorMessage } from "@/workspaces/move-agent-workspace-message";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";

export interface MoveAgentWorkspaceInput {
  client: Pick<DaemonClient, "moveAgentWorkspace"> | null;
  agentId: string;
  targetWorkspaceId: string;
  agentTitle: string;
  targetTitle: string;
  /** The agent's remembered slot moves with it, so the target bucket keeps the drop order. */
  sourceMemberKey: string;
  targetMemberKey: string;
}

/**
 * Moves one agent to another workspace that already holds its project. The membership is
 * untouched on both sides, so unlike a member move nothing is archived and there is nothing
 * to confirm; a refusal surfaces as a toast, which also keeps this honest on web where
 * `Alert.alert` renders nothing.
 */
export function useMoveAgentWorkspace(): (input: MoveAgentWorkspaceInput) => Promise<boolean> {
  const toast = useToast();
  return useCallback(
    async (input: MoveAgentWorkspaceInput): Promise<boolean> => {
      if (!input.client) {
        return false;
      }
      const fail = (errorCode: string | null, error: string | null) => {
        toast.error(
          moveAgentWorkspaceErrorMessage({
            errorCode,
            error,
            agentTitle: input.agentTitle,
            targetTitle: input.targetTitle,
          }),
        );
        return false;
      };
      try {
        const payload = await input.client.moveAgentWorkspace(
          input.agentId,
          input.targetWorkspaceId,
        );
        if (payload.error || payload.targetWorkspaceId === null) {
          return fail(payload.errorCode ?? null, payload.error);
        }
        moveStoredAgentSlot(input);
        return true;
      } catch (error) {
        return fail(null, error instanceof Error ? error.message : null);
      }
    },
    [toast],
  );
}

/**
 * Re-files the agent's key from the source bucket's remembered order into the target's. The
 * daemon knows nothing about sidebar order, so without this the agent lands wherever the
 * target's baseline sort puts it and its old slot leaks in the source bucket forever.
 */
function moveStoredAgentSlot(input: MoveAgentWorkspaceInput): void {
  const store = useSidebarOrderStore.getState();
  const agentKey = `agent:${input.agentId}`;
  const sourceOrder = store.getAgentOrder(input.sourceMemberKey);
  if (sourceOrder.includes(agentKey)) {
    store.setAgentOrder(
      input.sourceMemberKey,
      sourceOrder.filter((key) => key !== agentKey),
    );
  }
  const targetOrder = store.getAgentOrder(input.targetMemberKey);
  if (!targetOrder.includes(agentKey)) {
    store.setAgentOrder(input.targetMemberKey, [...targetOrder, agentKey]);
  }
}
