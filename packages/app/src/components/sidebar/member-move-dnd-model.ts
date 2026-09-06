export interface SidebarMemberMoveInput {
  sourceWorkspaceKey: string;
  targetWorkspaceKey: string;
  cwd: string;
  projectName: string;
}

export interface SidebarMemberMoveDragState {
  activeId: string | null;
  activeKind: "workspace" | "member" | null;
  /** The dragged member's own workspace — never a drop target. */
  activeWorkspaceKey: string | null;
  /** The other workspace's row a member drag is hovering, when it is a move target. */
  overWorkspaceKey: string | null;
}

/** dnd-kit item data carried by every sortable row the shared sidebar context routes. */
export type SidebarDndItemData =
  | { kind: "workspace"; workspaceKey: string; label: string }
  | {
      kind: "member";
      workspaceKey: string;
      memberKey: string;
      cwd: string;
      projectName: string;
      label: string;
    };

export function asSidebarDndItemData(data: unknown): SidebarDndItemData | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const kind = (data as { kind?: unknown }).kind;
  return kind === "workspace" || kind === "member" ? (data as SidebarDndItemData) : null;
}

export type SidebarDragEndRoute =
  | { kind: "reorder"; listId: string }
  | { kind: "move"; input: SidebarMemberMoveInput }
  | { kind: "none" };

/**
 * Where a completed sidebar drag lands: a member dropped on its own list reorders it;
 * dropped anywhere under another workspace — its row or one of its members — it moves.
 */
export function routeSidebarDragEnd(input: {
  active: SidebarDndItemData | null;
  over: SidebarDndItemData | null;
  overId: string | null;
}): SidebarDragEndRoute {
  const { active, over, overId } = input;
  if (!active || overId === null || !over) {
    return { kind: "none" };
  }
  if (active.kind === "workspace") {
    return over.kind === "workspace" ? { kind: "reorder", listId: "workspaces" } : { kind: "none" };
  }
  if (over.kind === "member" && over.workspaceKey === active.workspaceKey) {
    return { kind: "reorder", listId: `members:${active.workspaceKey}` };
  }
  if (over.workspaceKey !== active.workspaceKey) {
    return {
      kind: "move",
      input: {
        sourceWorkspaceKey: active.workspaceKey,
        targetWorkspaceKey: over.workspaceKey,
        cwd: active.cwd,
        projectName: active.projectName,
      },
    };
  }
  return { kind: "none" };
}
