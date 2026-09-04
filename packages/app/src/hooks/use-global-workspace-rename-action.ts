import { useCallback } from "react";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionId } from "@/keyboard/keyboard-action-dispatcher";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { requestWorkspaceRename } from "@/stores/workspace-rename-intent-store";

const WORKSPACE_RENAME_ACTIONS: readonly KeyboardActionId[] = ["workspace.rename"];

/**
 * Points the rename action at the active workspace's sidebar row, which renames
 * in place. Registered once on the route selection rather than per row, the same
 * shape `use-global-workspace-pin-action.ts` uses.
 */
export function useGlobalWorkspaceRenameAction(): void {
  const selection = useActiveWorkspaceSelection();
  const serverId = selection?.serverId ?? null;
  const routeWorkspaceId = selection?.workspaceId ?? null;
  // The route carries an opaque workspace id that is not guaranteed to equal the
  // descriptor id, and the sidebar row is keyed by the descriptor's.
  const workspaceId = useWorkspaceFields(serverId, routeWorkspaceId, (workspace) => workspace.id);

  const handle = useCallback(() => {
    if (!serverId || !workspaceId) return false;
    requestWorkspaceRename({ serverId, workspaceId });
    return true;
  }, [serverId, workspaceId]);

  useKeyboardActionHandler({
    handlerId: "workspace-rename-global",
    actions: WORKSPACE_RENAME_ACTIONS,
    enabled: serverId !== null && workspaceId !== null,
    priority: 0,
    handle,
  });
}
