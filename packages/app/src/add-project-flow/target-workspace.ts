import type { SidebarWorkspacePlacement } from "@/hooks/sidebar-workspaces-view-model";
import type { AddProjectFlowTargetWorkspace } from "@/stores/add-project-flow-store";

/**
 * Which workspace the sidebar's "Add project" adds into. Projects live inside
 * workspaces, so the button follows what the user is looking at: the open
 * workspace, otherwise the topmost sidebar row — pinned rows render above the
 * rest, so they win.
 *
 * Null only when the sidebar has no workspace to add to at all. The flow then
 * registers a standalone project, which is also what the command center, the
 * New Workspace screen and the keyboard shortcut still do.
 */
export function resolveAddProjectTargetWorkspace(input: {
  activeSelection: { serverId: string; workspaceId: string } | null;
  pinnedWorkspaces: readonly SidebarWorkspacePlacement[];
  topLevelWorkspaces: readonly SidebarWorkspacePlacement[];
}): AddProjectFlowTargetWorkspace | null {
  if (input.activeSelection) {
    return {
      serverId: input.activeSelection.serverId,
      workspaceId: input.activeSelection.workspaceId,
    };
  }
  const first = input.pinnedWorkspaces[0] ?? input.topLevelWorkspaces[0];
  return first ? { serverId: first.serverId, workspaceId: first.workspaceId } : null;
}
