import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";

/**
 * The subset of a stored project filter that still names a project the sidebar can see.
 *
 * Empty means "all projects" — both when nothing is pinned and when everything pinned has gone
 * away. That second case is why nothing ever deletes a stored key: the project list is narrowed
 * by the host filter and is empty before any host connects, so absence does not mean the project
 * is gone. A filter goes inert while its host is away and comes back with it.
 *
 * This is the only definition of "is a project filter active". The menu's indicator, the
 * "All projects" check and the per-row selection all read it, so they cannot disagree with what
 * the list is actually doing.
 */
export function resolveActiveProjectFilters(
  projectFilters: readonly string[],
  availableViewKeys: ReadonlySet<string>,
): readonly string[] {
  if (projectFilters.length === 0) return EMPTY_PROJECT_FILTERS;
  const matching = projectFilters.filter((viewKey) => availableViewKeys.has(viewKey));
  return matching.length > 0 ? matching : EMPTY_PROJECT_FILTERS;
}

/**
 * Applies the Project page's selection to the sidebar's workspace entries.
 *
 * A workspace matches when ANY of its project members is pinned — a cross-project workspace
 * shows up under each of its projects, not just its primary one. `projectViewKeysByWorkspaceKey`
 * carries those member keys; a workspace missing from it (session not hydrated, single-project
 * daemon) falls back to its primary placement, which is the only project it can have.
 */
export function filterWorkspacesByProjects(input: {
  workspaces: readonly SidebarWorkspaceEntry[];
  projectFilters: readonly string[];
  projectViewKeysByWorkspaceKey?: ReadonlyMap<string, readonly string[]>;
}): SidebarWorkspaceEntry[] {
  const { workspaces, projectFilters } = input;
  if (projectFilters.length === 0) return [...workspaces];
  const included = new Set(projectFilters);
  return workspaces.filter((workspace) => {
    const memberViewKeys = input.projectViewKeysByWorkspaceKey?.get(workspace.workspaceKey);
    if (!memberViewKeys) {
      return included.has(workspace.projectViewKey);
    }
    return memberViewKeys.some((viewKey) => included.has(viewKey));
  });
}

const EMPTY_PROJECT_FILTERS: readonly string[] = [];
