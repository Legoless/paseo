export interface SidebarMemberMoveInput {
  sourceWorkspaceKey: string;
  targetWorkspaceKey: string;
  cwd: string;
  projectName: string;
  /**
   * The target's member row the drop landed on, or null for a drop on the bare workspace row.
   * The daemon appends the membership and knows nothing about sidebar order, so this is the
   * only record of where the user aimed.
   */
  targetMemberKey: string | null;
}

export interface SidebarAgentMoveInput {
  agentId: string;
  sourceWorkspaceKey: string;
  targetWorkspaceKey: string;
  /** The bucket the agent leaves, so its stored order can drop the row. */
  sourceMemberKey: string;
  /** The bucket it lands in — the same project's row under the target workspace. */
  targetMemberKey: string;
  label: string;
}

export interface SidebarMemberMoveDragState {
  activeId: string | null;
  activeKind: "workspace" | "member" | "agent" | null;
  /** The dragged row's own workspace — never a drop target. */
  activeWorkspaceKey: string | null;
  /**
   * The dragged member's or agent's project directory. A workspace that already holds this
   * directory is not a move target, so the row must not light up as one.
   */
  activeCwd: string | null;
  /** The other workspace's row a member drag is hovering, when it is a move target. */
  overWorkspaceKey: string | null;
  /** The member row an agent drag is hovering, when it is a valid cross-workspace target. */
  overMemberKey: string | null;
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
    }
  | {
      kind: "agent";
      workspaceKey: string;
      /** The bucket this row renders under — a member row's key, or the uncategorized one. */
      memberKey: string;
      /**
       * The bucket's project directory. Empty for the uncategorized bucket, which therefore
       * never matches another workspace's bucket and can only ever reorder.
       */
      cwd: string;
      /** null for a draft row: there is no daemon-side agent to re-parent yet. */
      agentId: string | null;
      label: string;
    };

export function asSidebarDndItemData(data: unknown): SidebarDndItemData | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const kind = (data as { kind?: unknown }).kind;
  return kind === "workspace" || kind === "member" || kind === "agent"
    ? (data as SidebarDndItemData)
    : null;
}

export function sidebarAgentListId(memberKey: string): string {
  return `agents:${memberKey}`;
}

export function sidebarMemberListId(workspaceKey: string): string {
  return `members:${workspaceKey}`;
}

export type SidebarDragEndRoute =
  | { kind: "reorder"; listId: string }
  | { kind: "move"; input: SidebarMemberMoveInput }
  | { kind: "moveAgent"; input: SidebarAgentMoveInput }
  | { kind: "none" };

/**
 * Whether an agent dragged out of `active`'s bucket may land on `over`'s: an agent stays in
 * its project, so the two buckets must name the same directory in different workspaces.
 * The uncategorized bucket has no directory and is excluded by the empty-string check.
 */
function isAgentMoveTarget(
  active: Extract<SidebarDndItemData, { kind: "agent" }>,
  over: { workspaceKey: string; cwd: string },
): boolean {
  return (
    active.agentId !== null &&
    active.cwd.length > 0 &&
    over.cwd === active.cwd &&
    over.workspaceKey !== active.workspaceKey
  );
}

/**
 * Where a completed sidebar drag lands. A member dropped on its own list reorders it; dropped
 * anywhere under another workspace — its row or one of its members — it moves. An agent
 * reorders inside its own bucket, and moves only onto the same project's bucket in another
 * workspace: its own project row there, or one of the agents already under it.
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

  if (active.kind === "agent") {
    // A workspace row is not an agent target: its data names no directory, so accepting the
    // drop would mean guessing which of its projects the agent belongs to.
    if (over.kind === "workspace") {
      return { kind: "none" };
    }
    if (over.kind === "agent" && over.memberKey === active.memberKey) {
      return { kind: "reorder", listId: sidebarAgentListId(active.memberKey) };
    }
    if (!isAgentMoveTarget(active, over) || active.agentId === null) {
      return { kind: "none" };
    }
    return {
      kind: "moveAgent",
      input: {
        agentId: active.agentId,
        sourceWorkspaceKey: active.workspaceKey,
        targetWorkspaceKey: over.workspaceKey,
        sourceMemberKey: active.memberKey,
        targetMemberKey: over.memberKey,
        label: active.label,
      },
    };
  }

  // An agent row belongs to a bucket, not to the member list, so a member dropped on one
  // resolves to that bucket's workspace and nothing finer.
  if (over.kind === "member" && over.workspaceKey === active.workspaceKey) {
    return { kind: "reorder", listId: sidebarMemberListId(active.workspaceKey) };
  }
  if (over.workspaceKey !== active.workspaceKey) {
    return {
      kind: "move",
      input: {
        sourceWorkspaceKey: active.workspaceKey,
        targetWorkspaceKey: over.workspaceKey,
        cwd: active.cwd,
        projectName: active.projectName,
        targetMemberKey: over.kind === "member" ? over.memberKey : null,
      },
    };
  }
  return { kind: "none" };
}
