import { useCallback, useMemo } from "react";
import { i18n } from "@/i18n/i18next";
import type { SidebarPaneStatusCounts } from "@/projects/workspace-groups";
import { useHostFeature } from "@/runtime/host-features";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { markWorkspaceUnread } from "@/workspace/mark-unread";

export interface WorkspaceReadStateController {
  hasClearableAttention: boolean;
  canMarkUnread: boolean;
  clearAttention: () => Promise<void>;
  markUnread: () => Promise<void>;
}

export function useWorkspaceReadState({
  serverId,
  workspaceId,
  paneStatusCounts,
}: {
  serverId: string;
  workspaceId: string;
  paneStatusCounts?: SidebarPaneStatusCounts;
}): WorkspaceReadStateController {
  const workspaceState = useWorkspaceFields(serverId, workspaceId, (workspace) => ({
    status: workspace.status,
    hasClearableTerminalAttention: Object.values(workspace.terminalStatusBuckets ?? {}).some(
      (bucket) => bucket === "attention" || bucket === "failed",
    ),
  }));
  const status = workspaceState?.status;
  const supportsMarkUnread = useHostFeature(serverId, "workspaceMarkUnread");
  const hasClearableAttention =
    status === "attention" ||
    status === "failed" ||
    workspaceState?.hasClearableTerminalAttention === true ||
    (paneStatusCounts !== undefined &&
      (paneStatusCounts.attention > 0 || paneStatusCounts.failed > 0));
  const canMarkUnread = supportsMarkUnread && status === "done";

  const clearAttention = useCallback(async () => {
    if (!hasClearableAttention) {
      return;
    }
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client) {
      throw new Error(i18n.t("workspace.terminal.hostDisconnected"));
    }
    await client.clearWorkspaceAttention(workspaceId);
  }, [hasClearableAttention, serverId, workspaceId]);

  const markUnread = useCallback(async () => {
    if (!canMarkUnread) {
      return;
    }
    await markWorkspaceUnread(serverId, workspaceId);
  }, [canMarkUnread, serverId, workspaceId]);

  return useMemo(
    () => ({ hasClearableAttention, canMarkUnread, clearAttention, markUnread }),
    [canMarkUnread, clearAttention, hasClearableAttention, markUnread],
  );
}
