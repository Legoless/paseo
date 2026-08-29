import React, { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import {
  useSidebarWorkspacesList,
  useSidebarWorkspaceGroupSections,
  type SidebarProjectEntry,
  type SidebarWorkspaceEntry,
  type SidebarWorkspacePlacement,
  type SidebarWorkspacesListResult,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarWorkspaceEntries } from "@/hooks/use-sidebar-workspace-entries";
import { usePinnedSidebarKeys, type PinnedSidebarGroups } from "@/hooks/use-sidebar-pins";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import {
  hasActiveSidebarLabelFilter,
  useSidebarViewStore,
  type SidebarGroupMode,
} from "@/stores/sidebar-view-store";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import type { SidebarWorkspaceGroupModel } from "@/projects/workspace-groups";
import type { SidebarShortcutModel } from "@/utils/sidebar-shortcuts";
import { buildSidebarProjection } from "./sidebar-projection";
import type { SidebarProjectIconTarget } from "@/utils/sidebar-project-row-model";
import { filterWorkspacesByLabels, type SidebarWorkspaceGroup } from "./sidebar-labels";
import { filterWorkspacesByProjects, resolveActiveProjectFilters } from "./sidebar-project-filter";
import {
  hasAuthoritativeWorkspaceLabelCatalog,
  useWorkspaceLabelProjection,
} from "@/workspace-labels";

interface SidebarModel extends SidebarWorkspacesListResult {
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  /**
   * Every project the sidebar could show, before any filter narrows it.
   *
   * Projects no longer own sidebar sections — this list feeds the display menu's project
   * filter picker, which is why it is NOT the filtered list: narrowing the filter must not
   * delete the rows that would undo it.
   */
  allProjects: SidebarProjectEntry[];
  /** The project filter as it is actually being applied — see `resolveActiveProjectFilters`. */
  resolvedProjectFilters: readonly string[];
  hasProjectsBeforeFilter: boolean;
  hasActiveLabelFilter: boolean;
  groupMode: SidebarGroupMode;
  workspaceGroups: SidebarWorkspaceGroup[];
  topLevelWorkspaces: SidebarWorkspacePlacement[];
  workspaceGroupSections: SidebarWorkspaceGroupModel;
  projectIconTargets: SidebarProjectIconTarget[];
  pinnedGroups: PinnedSidebarGroups;
  collapsedWorkspaceKeys: ReadonlySet<string>;
  toggleWorkspaceCollapsed: (workspaceKey: string) => void;
  shortcutModel: SidebarShortcutModel;
}

const SidebarModelContext = createContext<SidebarModel | null>(null);

export function SidebarModelProvider({
  active,
  children,
}: {
  active?: boolean;
  children: ReactNode;
}) {
  const list = useSidebarWorkspacesList({ enabled: active });
  const groupMode = useSidebarViewStore((state) => state.groupMode);
  const labelFilter = useSidebarViewStore((state) => state.labelFilter);
  const projectFilters = useSidebarViewStore((state) => state.projectFilters);
  const reconcileLabelFilter = useSidebarViewStore((state) => state.reconcileLabelFilter);
  const { hosts: labelHosts } = useWorkspaceLabelProjection();
  const collapsedWorkspaceGroupKeys = useSidebarCollapsedSectionsStore(
    (state) => state.collapsedWorkspaceGroupKeys,
  );
  const collapsedWorkspaceKeys = useSidebarCollapsedSectionsStore(
    (state) => state.collapsedWorkspaceKeys,
  );
  const pinnedCollapsed = useSidebarCollapsedSectionsStore((state) => state.collapsedPinned);
  const pinnedWorkspaceOrder = useSidebarOrderStore((state) => state.pinnedWorkspaceOrder);
  const topLevelWorkspaceOrder = useSidebarOrderStore((state) => state.workspaceOrder);
  const toggleWorkspaceCollapsed = useSidebarCollapsedSectionsStore(
    (state) => state.toggleWorkspaceCollapsed,
  );
  const availableLabelNames = useMemo(
    () => labelHosts.flatMap((host) => host.labels.map((label) => label.name)),
    [labelHosts],
  );
  const hasAuthoritativeLabelCatalog = hasAuthoritativeWorkspaceLabelCatalog(labelHosts);
  useEffect(() => {
    if (!hasAuthoritativeLabelCatalog) return;
    reconcileLabelFilter(availableLabelNames);
  }, [availableLabelNames, hasAuthoritativeLabelCatalog, reconcileLabelFilter]);
  const hasActiveLabelFilter = hasActiveSidebarLabelFilter(labelFilter);
  const resolvedProjectFilters = useMemo(
    () =>
      resolveActiveProjectFilters(
        projectFilters,
        new Set(list.projects.map((project) => project.viewKey)),
      ),
    [projectFilters, list.projects],
  );
  const hasActiveProjectFilter = resolvedProjectFilters.length > 0;
  // The workspace-grouped hierarchy renders workspace rows in every mode, so entries hydrate
  // unconditionally while the sidebar is active. The one remaining gate is the label filter,
  // which reads `labels` — a field that only exists on an entry — and so needs entries even
  // from a retained-but-inactive sidebar.
  const workspaceEntriesByKey = useSidebarWorkspaceEntries(
    list.workspacePlacements,
    active !== false || hasActiveLabelFilter,
  );
  const workspaceGroupSections = useSidebarWorkspaceGroupSections({
    placements: list.workspacePlacements,
    enabled: active !== false,
  });
  // (serverId, projectId) -> viewKey, so a workspace's member projects can be matched against
  // the project filter's viewKey allowlist.
  const projectViewKeyByHostProject = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of list.projects) {
      for (const host of project.hosts) {
        map.set(`${host.serverId}:${host.projectId}`, project.viewKey);
      }
    }
    return map;
  }, [list.projects]);
  const memberProjectViewKeysByWorkspaceKey = useMemo(() => {
    const map = new Map<string, readonly string[]>();
    for (const [workspaceKey, section] of workspaceGroupSections.sectionsByWorkspaceKey) {
      const viewKeys = section.members.flatMap((member) => {
        const viewKey = projectViewKeyByHostProject.get(`${section.serverId}:${member.projectId}`);
        return viewKey ? [viewKey] : [];
      });
      if (viewKeys.length > 0) {
        map.set(workspaceKey, viewKeys);
      }
    }
    return map;
  }, [projectViewKeyByHostProject, workspaceGroupSections]);
  const filteredWorkspaceEntriesByKey = useMemo(() => {
    const byProject = filterWorkspacesByProjects({
      workspaces: [...workspaceEntriesByKey.values()],
      projectFilters: resolvedProjectFilters,
      projectViewKeysByWorkspaceKey: memberProjectViewKeysByWorkspaceKey,
    });
    const filtered = filterWorkspacesByLabels({ workspaces: byProject, ...labelFilter });
    return new Map(filtered.map((workspace) => [workspace.workspaceKey, workspace]));
  }, [
    labelFilter,
    memberProjectViewKeysByWorkspaceKey,
    resolvedProjectFilters,
    workspaceEntriesByKey,
  ]);
  const visibleWorkspaceKeys = useMemo(
    () => new Set(filteredWorkspaceEntriesByKey.keys()),
    [filteredWorkspaceEntriesByKey],
  );
  // With no filter active the placements stand alone — neither filter gets to demand hydration
  // the rows themselves don't need. Once one is active the workspace set narrows to what the
  // filtered entries cover.
  const visiblePlacements = useMemo(() => {
    if (!hasActiveProjectFilter && !hasActiveLabelFilter) {
      return list.workspacePlacements;
    }
    return list.workspacePlacements.filter((placement) =>
      visibleWorkspaceKeys.has(placement.workspaceKey),
    );
  }, [
    hasActiveLabelFilter,
    hasActiveProjectFilter,
    list.workspacePlacements,
    visibleWorkspaceKeys,
  ]);
  const pinnedKeys = usePinnedSidebarKeys(visiblePlacements);
  // The icon pool: exactly the projects the visible rows can reference, so a mode that renders
  // a row can only ask for an icon this list covers.
  const visibleProjects = useMemo(() => {
    const referenced = new Set(visiblePlacements.map((workspace) => workspace.projectViewKey));
    return list.projects.filter((project) => referenced.has(project.viewKey));
  }, [list.projects, visiblePlacements]);
  const projectionInput = useMemo(
    () => ({
      workspaces: visiblePlacements,
      projects: visibleProjects,
      pinnedKeys,
      pinnedWorkspaceOrder,
      topLevelWorkspaceOrder,
      workspaceEntriesByKey: filteredWorkspaceEntriesByKey,
      projectNamesByViewKey: list.projectNamesByViewKey,
      groupMode,
      pinnedCollapsed,
      collapsedWorkspaceGroupKeys,
    }),
    [
      collapsedWorkspaceGroupKeys,
      groupMode,
      list.projectNamesByViewKey,
      visiblePlacements,
      visibleProjects,
      pinnedCollapsed,
      pinnedKeys,
      pinnedWorkspaceOrder,
      topLevelWorkspaceOrder,
      filteredWorkspaceEntriesByKey,
    ],
  );
  const projection = useMemo(() => buildSidebarProjection(projectionInput), [projectionInput]);
  const value = useMemo(
    () => ({
      ...list,
      allProjects: list.projects,
      resolvedProjectFilters,
      hasProjectsBeforeFilter: list.projects.length > 0,
      hasActiveLabelFilter,
      workspaceEntriesByKey: filteredWorkspaceEntriesByKey,
      groupMode,
      workspaceGroups: projection.workspaceGroups,
      topLevelWorkspaces: projection.topLevelWorkspaces,
      workspaceGroupSections,
      projectIconTargets: projection.projectIconTargets,
      pinnedGroups: projection.pinnedGroups,
      collapsedWorkspaceKeys,
      toggleWorkspaceCollapsed,
      shortcutModel: projection.shortcutModel,
    }),
    [
      resolvedProjectFilters,
      collapsedWorkspaceKeys,
      groupMode,
      hasActiveLabelFilter,
      list,
      projection,
      workspaceGroupSections,
      toggleWorkspaceCollapsed,
      filteredWorkspaceEntriesByKey,
    ],
  );

  return <SidebarModelContext.Provider value={value}>{children}</SidebarModelContext.Provider>;
}

export function useSidebarModel(): SidebarModel {
  const model = useContext(SidebarModelContext);
  if (!model) throw new Error("SidebarModelProvider is required");
  return model;
}
