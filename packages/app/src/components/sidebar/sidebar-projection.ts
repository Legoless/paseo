import { buildStatusGroups } from "@/hooks/sidebar-status-view-model";
import {
  splitPinnedSidebarGroups,
  type PinnedSidebarGroups,
  type PinnedSidebarKeys,
} from "@/hooks/use-sidebar-pins";
import {
  applyStoredOrdering,
  compareSidebarWorkspacePlacements,
  type SidebarProjectEntry,
  type SidebarWorkspaceEntry,
  type SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarGroupMode } from "@/stores/sidebar-view-store";
import {
  resolveSidebarProjectIconTargets,
  type SidebarProjectIconTarget,
} from "@/utils/sidebar-project-row-model";
import {
  buildSidebarShortcutSections,
  type SidebarShortcutModel,
  type SidebarShortcutSection,
} from "@/utils/sidebar-shortcuts";
import { statusWorkspaceGroups, type SidebarWorkspaceGroup } from "./sidebar-labels";

export interface SidebarProjection {
  pinnedGroups: PinnedSidebarGroups;
  /** Flat buckets for the status grouping; empty in the workspace grouping. */
  workspaceGroups: SidebarWorkspaceGroup[];
  /**
   * The workspace grouping's top-level rows: every visible workspace with the pinned ones
   * hoisted out, in display order (stored drag order over the name-sort baseline).
   */
  topLevelWorkspaces: SidebarWorkspacePlacement[];
  /**
   * The project icons this projection needs fetched, keyed by `projectViewKey` — one per project,
   * whatever the mode groups by. It sits here rather than beside `useProjectIcons` in the list
   * because it is the same `projects` the rows above are projected from: a mode that renders a
   * row can only ever ask for an icon this list already covers.
   */
  projectIconTargets: SidebarProjectIconTarget[];
  shortcutModel: SidebarShortcutModel;
}

export interface SidebarProjectionInput {
  /** The workspaces the sidebar can show, after host/project/label filters. */
  workspaces: SidebarWorkspacePlacement[];
  /** Every project the sidebar can see — the icon-target pool, not a render list. */
  projects: SidebarProjectEntry[];
  pinnedKeys: PinnedSidebarKeys;
  pinnedWorkspaceOrder: string[];
  topLevelWorkspaceOrder: string[];
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  projectNamesByViewKey: Map<string, string>;
  groupMode: SidebarGroupMode;
  pinnedCollapsed: boolean;
  collapsedWorkspaceGroupKeys: ReadonlySet<string>;
}

export function buildSidebarProjection(input: SidebarProjectionInput): SidebarProjection {
  const pinnedGroups = splitPinnedSidebarGroups({
    workspaces: input.workspaces,
    keys: input.pinnedKeys,
    pinnedWorkspaceOrder: input.pinnedWorkspaceOrder,
  });
  const topLevelWorkspaces = applyStoredOrdering({
    items: [...pinnedGroups.unpinnedWorkspaces].sort(compareSidebarWorkspacePlacements),
    storedOrder: input.topLevelWorkspaceOrder,
    getKey: (workspace) => workspace.workspaceKey,
  });
  const pinnedWorkspaceKeys = new Set(input.pinnedKeys.pinnedWorkspaceKeys);
  const unpinnedWorkspaceEntries = Array.from(input.workspaceEntriesByKey.values()).filter(
    (workspace) => !pinnedWorkspaceKeys.has(workspace.workspaceKey),
  );
  // One switch decides both what the list groups by and what the keyboard shortcuts walk, so the
  // two cannot disagree and a new grouping mode is a compile error here rather than a silent
  // fall-through to the workspace rows.
  const workspaceGroups = buildWorkspaceGroups(input, unpinnedWorkspaceEntries);

  const sections: SidebarShortcutSection[] = [];
  if (!input.pinnedCollapsed) {
    sections.push({ workspaces: pinnedGroups.pinnedChats });
  }
  if (input.groupMode === "project") {
    // A collapsed workspace still shows its header row, and the header is the shortcut
    // target — collapse hides members and agents, never the row the number jumps to.
    sections.push({ workspaces: topLevelWorkspaces });
  } else {
    sections.push(
      ...workspaceGroups.map((group) => ({
        workspaces: group.rows,
        collapsed: input.collapsedWorkspaceGroupKeys.has(group.key),
      })),
    );
  }

  return {
    pinnedGroups,
    workspaceGroups,
    topLevelWorkspaces,
    projectIconTargets: resolveSidebarProjectIconTargets(input.projects),
    shortcutModel: buildSidebarShortcutSections({ sections }),
  };
}

/** The workspace grouping keeps its headers and groups nothing; status mode groups the rows. */
function buildWorkspaceGroups(
  input: SidebarProjectionInput,
  unpinnedWorkspaces: SidebarWorkspaceEntry[],
): SidebarWorkspaceGroup[] {
  switch (input.groupMode) {
    case "project":
      return [];
    case "status":
      return statusWorkspaceGroups(
        buildStatusGroups(unpinnedWorkspaces, input.projectNamesByViewKey),
      );
  }
}
