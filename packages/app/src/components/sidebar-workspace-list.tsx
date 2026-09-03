import { View, Text, ScrollView, type GestureResponderEvent } from "react-native";
import {
  memo,
  useCallback,
  useMemo,
  useState,
  type ReactElement,
  type MutableRefObject,
  type Ref,
} from "react";
import { useTranslation } from "react-i18next";
import { usePathname } from "expo-router";
import {
  navigateToWorkspace,
  useActiveWorkspaceSelection,
  type ActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { StyleSheet } from "react-native-unistyles";
import type { SidebarSurfaceBackdrop } from "@/styles/surface-backdrop";
import { getSidebarRowBackdrop } from "@/components/sidebar/sidebar-row-backdrop";
import { type GestureType } from "react-native-gesture-handler";
import * as Clipboard from "expo-clipboard";
import { WorkspaceRenameModal } from "@/components/workspace-rename-modal";
import { NestableScrollContainer } from "react-native-draggable-flatlist";
import { DraggableList, type DraggableRenderItemInfo } from "./draggable-list";
import type { DraggableListDragHandleProps } from "./draggable-list.types";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import type { PinnedSidebarGroups } from "@/hooks/use-sidebar-pins";
import {
  useSidebarWorkspacePinController,
  type ToggleSidebarWorkspacePin,
} from "@/hooks/use-sidebar-workspace-pin";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import { useHostFeatureMap } from "@/runtime/host-features";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useProjectIcons } from "@/projects/icons";
import type {
  SidebarWorkspaceAgentRow,
  SidebarWorkspaceMemberRow,
  SidebarWorkspaceNewAgentRow,
  SidebarWorkspaceUncategorizedRow,
  SidebarWorkspaceSection,
} from "@/projects/workspace-groups";
import { WorkspaceAgentRow, WorkspaceNewAgentRow } from "@/components/sidebar/workspace-agent-row";
import { useRemoveWorkspaceMember } from "@/workspaces/use-remove-workspace-member";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { parseHostWorkspaceRouteFromPathname } from "@/utils/host-routes";
import {
  applyStoredOrdering,
  type SidebarWorkspaceEntry,
  type SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import {
  hasActiveSidebarLabelFilter,
  useSidebarViewStore,
  type SidebarGroupMode,
} from "@/stores/sidebar-view-store";
import { useShowShortcutBadges } from "@/hooks/use-show-shortcut-badges";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { ProjectStatusIndicator } from "@/components/sidebar/project-leading-visual";
import { useToast } from "@/contexts/toast-context";
import { toWorktreeArchiveRisk } from "@/git/worktree-archive-warning";
import { hasVisibleOrderChanged, mergeWithRemainder } from "@/utils/sidebar-reorder";
import { SidebarStatusWorkspaceList } from "@/components/sidebar/sidebar-status-list";
import type { SidebarWorkspaceGroup } from "@/components/sidebar/sidebar-labels";
import {
  SidebarWorkspaceContextMenu,
  SidebarWorkspaceMenu,
} from "@/components/sidebar/sidebar-workspace-menu";
import {
  WorkspaceMemberKebabMenu,
  WorkspaceMemberMenuItems,
} from "@/components/sidebar/workspace-member-menu";
import { useLongPressDragInteraction } from "@/components/sidebar/use-long-press-drag-interaction";
import { PinnedSectionHeader } from "@/components/sidebar/pinned-section-header";
import { SidebarGroupToggleRow } from "@/components/sidebar/sidebar-group-toggle-row";
import { useLimitedSidebarGroup } from "@/components/sidebar/use-limited-sidebar-group";
import {
  SidebarWorkspaceRowFrame,
  SidebarWorkspaceRowContent,
  resolveTrailingActionVisibility,
  SidebarWorkspaceTrailingActionBase,
  SidebarWorkspaceTrailingActionOverlay,
  SidebarWorkspaceTrailingActionSlot,
  type SidebarWorkspaceCollapseAccessory,
} from "@/components/sidebar/sidebar-workspace-row-content";
import { useOpenKebabMenuVisibility } from "@/components/sidebar/use-open-kebab-menu-visibility";
import {
  SidebarFilterEmptyState,
  SidebarProjectEmptyState,
} from "@/components/sidebar/empty-states";
import { selectWorkspaceServiceSummary } from "@/components/sidebar/workspace-meta-row";
import {
  SidebarWorkspaceTrailingContent,
  useSidebarWorkspaceTrailing,
} from "@/components/sidebar/workspace-trailing";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useClearWorkspaceAttention } from "@/hooks/use-clear-workspace-attention";
import type { PrHint } from "@/git/use-pr-status-query";
import type { SidebarProjectIconTarget } from "@/utils/sidebar-project-row-model";
import { redirectIfArchivingActiveWorkspace } from "@/utils/sidebar-workspace-archive-redirect";
import { useWorkspaceArchive } from "@/workspace/use-workspace-archive";
import { isWeb as platformIsWeb, isNative as platformIsNative } from "@/constants/platform";
import type { HostBadgeModel } from "@/hosts/appearance";
import { useHostBadges } from "@/hosts/use-host-badges";
import { useSidebarRowItems } from "@/components/sidebar/display-preferences/model";

const EMPTY_ORDER: string[] = [];
const EMPTY_MEMBERS: SidebarWorkspaceMemberRow[] = [];
const workspaceKeyExtractor = (workspace: SidebarWorkspacePlacement) => workspace.workspaceKey;

function isWorkspaceSelected(input: {
  selection: ActiveWorkspaceSelection | null;
  serverId: string | null;
  workspaceId: string;
  enabled: boolean;
}): boolean {
  return (
    input.enabled &&
    input.selection?.serverId === input.serverId &&
    input.selection.workspaceId === input.workspaceId
  );
}

function activeWorkspaceSelectionKey(selection: ActiveWorkspaceSelection | null): string {
  return selection ? `${selection.serverId}:${selection.workspaceId}` : "";
}

function selectionForSelectedWorkspace(
  selected: boolean,
  workspace: SidebarWorkspaceEntry,
): ActiveWorkspaceSelection | null {
  return selected ? { serverId: workspace.serverId, workspaceId: workspace.workspaceId } : null;
}

interface SidebarWorkspaceListProps {
  workspaceGroups: SidebarWorkspaceGroup[];
  /** What `useProjectIcons` is asked for, straight from the projection. See `SidebarProjection`. */
  projectIconTargets: SidebarProjectIconTarget[];
  /** Member-row icon targets, keyed by `memberKey`. See `buildSidebarWorkspaceGroupModel`. */
  memberIconTargets: SidebarProjectIconTarget[];
  pinnedGroups: PinnedSidebarGroups;
  /** The workspace grouping's top-level rows, in display order. */
  topLevelWorkspaces: SidebarWorkspacePlacement[];
  sectionsByWorkspaceKey: ReadonlyMap<string, SidebarWorkspaceSection>;
  hasProjectsBeforeFilter: boolean;
  /** Whether a project filter is actually being applied — the resolved list, not the stored one. */
  hasActiveProjectFilter: boolean;
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  collapsedWorkspaceKeys: ReadonlySet<string>;
  onToggleWorkspaceCollapsed: (workspaceKey: string) => void;
  shortcutIndexByWorkspaceKey: Map<string, number>;
  groupMode: SidebarGroupMode;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  onWorkspacePress?: () => void;
  onAddProject?: () => void;
  listFooterComponent?: ReactElement | null;
  // Rendered inside the scroll area, below the Pinned section and above the workspace
  // list. Holds the "Workspaces" section header so pinned items sit above it.
  listHeaderComponent?: ReactElement | null;
  /** Gesture ref for coordinating with parent gestures (e.g., sidebar close) */
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
  dragGestureHostPresented?: boolean;
}

interface WorkspaceRowInnerProps {
  workspace: SidebarWorkspaceEntry;
  hostBadge?: HostBadgeModel | null;
  leadingProjectName?: string | null;
  leadingProjectIconDataUri?: string | null;
  selected: boolean;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  onPress: () => void;
  drag: () => void;
  isDragging: boolean;
  isArchiving: boolean;
  isCreating?: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
  archiveLabel?: string;
  archiveStatus?: "idle" | "pending" | "success";
  archivePendingLabel?: string;
  onArchive?: () => void;
  onRename?: () => void;
  onMarkAsRead?: () => void;
  onAddProject?: () => void;
  archiveShortcutKeys?: ShortcutKey[][] | null;
  isPinned?: boolean;
  onTogglePin?: () => void;
  reserveIdleStatusIndicatorSpace?: boolean;
  collapseAccessory?: WorkspaceCollapseToggle;
}

function getProjectWorkspaceRowStyle({
  isDragging,
  isPressed,
  selected,
  isHovered,
}: {
  isDragging: boolean;
  isPressed: boolean;
  selected: boolean;
  isHovered: boolean;
}) {
  return [
    styles.workspaceRow,
    isHovered && styles.workspaceRowHovered,
    selected && styles.sidebarRowSelected,
    isDragging && styles.workspaceRowDragging,
    isPressed && styles.workspaceRowPressed,
  ];
}

function noop() {}

/** The collapse toggle before the row resolves hover — `visible` is decided inside the row. */
type WorkspaceCollapseToggle = Omit<SidebarWorkspaceCollapseAccessory, "visible">;

function WorkspaceRowRightGroup({
  workspace,
  includeProjectActions,
  backdrop,
  isHovered,
  isTouchPlatform,
  isCreating,
  showShortcutBadge,
  shortcutNumber,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  archiveShortcutKeys,
  onArchive,
  onMarkAsRead,
  onRename,
  onAddProject,
  isPinned,
  onTogglePin,
}: {
  workspace: SidebarWorkspaceEntry;
  includeProjectActions: boolean;
  backdrop: SidebarSurfaceBackdrop;
  isHovered: boolean;
  isTouchPlatform: boolean;
  isCreating: boolean;
  showShortcutBadge: boolean;
  shortcutNumber: number | null;
  archiveLabel?: string;
  archiveStatus?: "idle" | "pending" | "success";
  archivePendingLabel?: string;
  archiveShortcutKeys?: ShortcutKey[][] | null;
  onArchive?: () => void;
  onMarkAsRead?: () => void;
  onRename?: () => void;
  onAddProject?: () => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
}) {
  const { t } = useTranslation();
  const trailing = useSidebarWorkspaceTrailing();
  const showShortcut = showShortcutBadge && shortcutNumber !== null;
  const {
    showTrailing,
    showKebab: showKebabInSlot,
    showScrim,
    renderSlot,
    reserveSlotWidth,
  } = resolveTrailingActionVisibility({
    workspace,
    trailing,
    hasArchiveAction: Boolean(onArchive),
    isHovered,
    isTouchPlatform,
    showShortcut,
  });
  const kebab = useOpenKebabMenuVisibility(showKebabInSlot);

  return (
    <>
      {isCreating ? (
        <Text style={styles.workspaceCreatingText}>{t("sidebar.workspace.status.creating")}</Text>
      ) : null}
      {renderSlot ? (
        <SidebarWorkspaceTrailingActionSlot reserveWidth={reserveSlotWidth}>
          <SidebarWorkspaceTrailingActionBase visible={showTrailing}>
            <SidebarWorkspaceTrailingContent workspace={workspace} trailing={trailing} />
          </SidebarWorkspaceTrailingActionBase>
          <SidebarWorkspaceTrailingActionOverlay
            visible={kebab.showKebab}
            scrimBackdrop={showScrim ? backdrop : undefined}
          >
            {onArchive ? (
              <SidebarWorkspaceMenu
                {...kebab.menuProps}
                workspaceKey={workspace.workspaceKey}
                workspace={workspace}
                includeProjectActions={includeProjectActions}
                serverId={workspace.serverId}
                workspaceId={workspace.workspaceId}
                workspaceLabels={workspace.labels}
                onRename={onRename}
                onMarkAsRead={onMarkAsRead}
                onAddProject={onAddProject}
                onArchive={onArchive}
                archiveLabel={archiveLabel}
                archiveStatus={archiveStatus}
                archivePendingLabel={archivePendingLabel}
                archiveShortcutKeys={archiveShortcutKeys}
                isPinned={isPinned}
                onTogglePin={onTogglePin}
              />
            ) : null}
          </SidebarWorkspaceTrailingActionOverlay>
        </SidebarWorkspaceTrailingActionSlot>
      ) : null}
    </>
  );
}

function WorkspaceRowInner({
  workspace,
  hostBadge,
  leadingProjectName,
  leadingProjectIconDataUri,
  selected,
  shortcutNumber,
  showShortcutBadge,
  onPress,
  drag,
  isDragging,
  isArchiving,
  isCreating = false,
  dragHandleProps,
  archiveLabel,
  archiveStatus = "idle",
  archivePendingLabel,
  onArchive,
  onRename,
  onAddProject,
  archiveShortcutKeys,
  isPinned,
  onTogglePin,
  reserveIdleStatusIndicatorSpace = true,
  collapseAccessory,
}: WorkspaceRowInnerProps) {
  const isCompact = useIsCompactFormFactor();
  const [isPressed, setIsPressed] = useState(false);
  const isTouchPlatform = platformIsNative || isCompact;
  const interaction = useLongPressDragInteraction({
    drag,
    menuController: null,
  });
  const {
    role: _dragRole,
    tabIndex: _dragTabIndex,
    "aria-roledescription": _dragRoleDescription,
    ...dragAttributes
  } = dragHandleProps?.attributes ?? {};

  const handlePress = useCallback(() => {
    if (interaction.didLongPressRef.current) {
      interaction.didLongPressRef.current = false;
      return;
    }
    onPress();
  }, [interaction.didLongPressRef, onPress]);
  const handleWorkspacePressIn = useCallback(
    (event: GestureResponderEvent) => {
      setIsPressed(true);
      interaction.handlePressIn(event);
    },
    [interaction],
  );
  const handleWorkspacePressOut = useCallback(() => {
    setIsPressed(false);
    interaction.handlePressOut();
  }, [interaction]);

  const accessibilityState = useMemo(() => ({ selected }), [selected]);

  return (
    <SidebarWorkspaceRowFrame workspace={workspace} isDragging={isDragging}>
      {({ isHovered, contextMenuOpen, onContextMenuOpenChange, hoverHandlers }) => {
        const isDesktop = !isTouchPlatform;
        const serviceSummary = isDesktop ? selectWorkspaceServiceSummary(workspace.scripts) : null;
        const workspaceRowStyle = getProjectWorkspaceRowStyle({
          isDragging,
          isPressed,
          selected,
          isHovered,
        });
        const backdrop = getSidebarRowBackdrop({ isDragging, isPressed, selected, isHovered });
        // The chevron shares the leading slot with the status indicator. Hover swaps them on
        // web; touch has no hover, so a collapsed workspace keeps the expand chevron up there
        // permanently and an expanded one keeps its status dot as the toggle target.
        const collapseChevronVisible = collapseAccessory
          ? isHovered || (isTouchPlatform && collapseAccessory.chevron === "expand")
          : false;
        return (
          <View
            {...dragAttributes}
            {...dragHandleProps?.listeners}
            ref={dragHandleProps?.setActivatorNodeRef as unknown as Ref<View>}
            style={styles.workspaceRowContainer}
            {...hoverHandlers}
          >
            <SidebarWorkspaceContextMenu
              contextMenuOpen={contextMenuOpen}
              onContextMenuOpenChange={onContextMenuOpenChange}
              workspace={workspace}
              leadingProjectName={leadingProjectName}
              hostBadgeLabel={hostBadge?.label}
              workspaceKey={workspace.workspaceKey}
              onRename={onRename}
              onAddProject={onAddProject}
              onArchive={onArchive}
              archiveLabel={archiveLabel}
              archiveStatus={archiveStatus}
              archivePendingLabel={archivePendingLabel}
              archiveShortcutKeys={archiveShortcutKeys}
              isPinned={isPinned}
              onTogglePin={onTogglePin}
              disabled={isArchiving}
              aria-selected={selected}
              accessibilityRole="button"
              accessibilityState={accessibilityState}
              style={workspaceRowStyle}
              highlightStyle={styles.workspaceRowPressed}
              onPressIn={handleWorkspacePressIn}
              onTouchMove={interaction.handleTouchMove}
              onPressOut={handleWorkspacePressOut}
              onPress={handlePress}
              testID={`sidebar-workspace-row-${workspace.workspaceKey}`}
            >
              <SidebarWorkspaceRowContent
                workspace={workspace}
                hostBadge={hostBadge}
                leadingProjectName={leadingProjectName}
                leadingProjectIconDataUri={leadingProjectIconDataUri}
                serviceSummary={serviceSummary}
                backdrop={backdrop}
                isHovered={isHovered}
                isLoading={isArchiving || isCreating}
                isCreating={isCreating}
                shortcutNumber={shortcutNumber}
                showShortcutBadge={showShortcutBadge}
                reserveIdleStatusIndicatorSpace={reserveIdleStatusIndicatorSpace}
                collapseChevron={collapseAccessory?.chevron}
                collapseChevronVisible={collapseChevronVisible}
                onCollapseToggle={collapseAccessory?.onToggle}
              >
                <WorkspaceRowRightGroup
                  workspace={workspace}
                  includeProjectActions={Boolean(leadingProjectName)}
                  backdrop={backdrop}
                  isHovered={isHovered}
                  isTouchPlatform={isTouchPlatform}
                  isCreating={isCreating}
                  showShortcutBadge={showShortcutBadge}
                  shortcutNumber={shortcutNumber}
                  archiveLabel={archiveLabel}
                  archiveStatus={archiveStatus}
                  archivePendingLabel={archivePendingLabel}
                  archiveShortcutKeys={archiveShortcutKeys}
                  onArchive={onArchive}
                  onRename={onRename}
                  onAddProject={onAddProject}
                  isPinned={isPinned}
                  onTogglePin={onTogglePin}
                />
              </SidebarWorkspaceRowContent>
            </SidebarWorkspaceContextMenu>
          </View>
        );
      }}
    </SidebarWorkspaceRowFrame>
  );
}

function WorkspaceRowWithMenu({
  workspace,
  hostBadge,
  leadingProjectName,
  leadingProjectIconDataUri,
  selected,
  shortcutNumber,
  showShortcutBadge,
  onPress,
  drag,
  isDragging,
  dragHandleProps,
  canPin,
  canAddProject,
  onToggleWorkspacePin,
  reserveIdleStatusIndicatorSpace = true,
  isCreating = false,
  collapseAccessory,
}: {
  workspace: SidebarWorkspaceEntry;
  hostBadge?: HostBadgeModel | null;
  leadingProjectName?: string | null;
  leadingProjectIconDataUri?: string | null;
  selected: boolean;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  onPress: () => void;
  drag: () => void;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
  canPin: boolean;
  canAddProject: boolean;
  onToggleWorkspacePin: ToggleSidebarWorkspacePin;
  reserveIdleStatusIndicatorSpace?: boolean;
  isCreating?: boolean;
  collapseAccessory?: WorkspaceCollapseToggle;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [isHidingWorkspace, setIsHidingWorkspace] = useState(false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const isArchiving = workspace.archivingAt !== null || isHidingWorkspace;
  const redirectAfterArchive = useCallback(() => {
    redirectIfArchivingActiveWorkspace({
      serverId: workspace.serverId,
      workspaceId: workspace.workspaceId,
      activeWorkspaceSelection: selectionForSelectedWorkspace(selected, workspace),
    });
  }, [selected, workspace]);

  const archiveController = useWorkspaceArchive({
    serverId: workspace.serverId,
    workspaceId: workspace.workspaceId,
    workspaceKind: workspace.workspaceKind,
    name: workspace.name,
    ...toWorktreeArchiveRisk(workspace),
    onArchiveStarted: redirectAfterArchive,
    onSetHiding: setIsHidingWorkspace,
  });

  const handleArchive = useCallback(() => {
    if (isArchiving) {
      return;
    }
    archiveController.archive();
  }, [archiveController, isArchiving]);

  const handleOpenRename = useCallback(() => {
    setIsRenameOpen(true);
  }, []);

  const handleCloseRename = useCallback(() => {
    setIsRenameOpen(false);
  }, []);

  const openAddProject = useOpenAddProject();
  const handleAddProject = useCallback(() => {
    openAddProject(workspace.serverId, {
      targetWorkspace: { serverId: workspace.serverId, workspaceId: workspace.workspaceId },
    });
  }, [openAddProject, workspace.serverId, workspace.workspaceId]);
  const onAddProject = canAddProject ? handleAddProject : undefined;
  const isPinned = workspace.pinnedAt != null;
  const handleTogglePin = useCallback(() => {
    onToggleWorkspacePin(workspace);
  }, [onToggleWorkspacePin, workspace]);
  const onTogglePin = canPin ? handleTogglePin : undefined;

  const archiveShortcutKeys = useShortcutKeys("archive-workspace");
  const { hasClearableAttention, clearAttention } = useClearWorkspaceAttention({
    serverId: workspace.serverId,
    workspaceId: workspace.workspaceId,
  });
  const handleMarkAsRead = useCallback(() => {
    void clearAttention().catch((error) => {
      toast.error(error instanceof Error ? error.message : "Failed to mark workspace as read");
    });
  }, [clearAttention, toast]);

  useKeyboardActionHandler({
    handlerId: `workspace-archive-${workspace.workspaceKey}`,
    actions: ["workspace.archive"],
    enabled: selected && !isArchiving,
    priority: 0,
    handle: () => {
      handleArchive();
      return true;
    },
  });

  return (
    <>
      <WorkspaceRowInner
        workspace={workspace}
        hostBadge={hostBadge}
        leadingProjectName={leadingProjectName}
        leadingProjectIconDataUri={leadingProjectIconDataUri}
        selected={selected}
        shortcutNumber={shortcutNumber}
        showShortcutBadge={showShortcutBadge}
        onPress={onPress}
        drag={drag}
        isDragging={isDragging}
        isArchiving={isArchiving}
        isCreating={isCreating}
        dragHandleProps={dragHandleProps}
        archiveLabel={t("sidebar.workspace.actions.archive")}
        archiveStatus={isArchiving ? "pending" : "idle"}
        archivePendingLabel={t("sidebar.workspace.actions.archiving")}
        onArchive={handleArchive}
        onRename={handleOpenRename}
        onMarkAsRead={hasClearableAttention ? handleMarkAsRead : undefined}
        onAddProject={onAddProject}
        archiveShortcutKeys={selected ? archiveShortcutKeys : null}
        isPinned={isPinned}
        onTogglePin={onTogglePin}
        reserveIdleStatusIndicatorSpace={reserveIdleStatusIndicatorSpace}
        collapseAccessory={collapseAccessory}
      />
      <WorkspaceRenameModal
        visible={isRenameOpen}
        workspace={workspace}
        onClose={handleCloseRename}
        testID={`sidebar-workspace-rename-modal-${workspace.workspaceKey}`}
      />
    </>
  );
}

interface WorkspaceRowItemProps {
  workspace: SidebarWorkspacePlacement;
  workspaceEntry: SidebarWorkspaceEntry | null;
  hostBadge?: HostBadgeModel | null;
  leadingProjectName?: string | null;
  leadingProjectIconDataUri?: string | null;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  canPin: boolean;
  canAddProject: boolean;
  onToggleWorkspacePin: ToggleSidebarWorkspacePin;
  reserveIdleStatusIndicatorSpace?: boolean;
  selectionEnabled: boolean;
  activeWorkspaceSelection: ActiveWorkspaceSelection | null;
  onWorkspacePress?: () => void;
  drag?: () => void;
  isDragging?: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
  collapseAccessory?: WorkspaceCollapseToggle;
}

function WorkspaceRowItem({
  workspace,
  workspaceEntry,
  hostBadge,
  leadingProjectName,
  leadingProjectIconDataUri,
  shortcutNumber,
  showShortcutBadge,
  canPin,
  canAddProject,
  onToggleWorkspacePin,
  reserveIdleStatusIndicatorSpace = true,
  selectionEnabled,
  activeWorkspaceSelection,
  onWorkspacePress,
  drag,
  isDragging = false,
  dragHandleProps,
  collapseAccessory,
}: WorkspaceRowItemProps) {
  const handlePress = useCallback(() => {
    if (!workspace.serverId) {
      return;
    }
    onWorkspacePress?.();
    navigateToWorkspace({ serverId: workspace.serverId, workspaceId: workspace.workspaceId });
  }, [onWorkspacePress, workspace.serverId, workspace.workspaceId]);

  return (
    <WorkspaceRow
      workspaceEntry={workspaceEntry}
      hostBadge={hostBadge}
      leadingProjectName={leadingProjectName}
      leadingProjectIconDataUri={leadingProjectIconDataUri}
      shortcutNumber={shortcutNumber}
      showShortcutBadge={showShortcutBadge}
      canPin={canPin}
      canAddProject={canAddProject}
      onToggleWorkspacePin={onToggleWorkspacePin}
      reserveIdleStatusIndicatorSpace={reserveIdleStatusIndicatorSpace}
      selected={isWorkspaceSelected({
        selection: activeWorkspaceSelection,
        serverId: workspace.serverId,
        workspaceId: workspace.workspaceId,
        enabled: selectionEnabled,
      })}
      onPress={handlePress}
      drag={drag ?? noop}
      isDragging={isDragging}
      dragHandleProps={dragHandleProps}
      collapseAccessory={collapseAccessory}
    />
  );
}

function areWorkspaceRowItemPropsEqual(
  previous: WorkspaceRowItemProps,
  next: WorkspaceRowItemProps,
): boolean {
  const previousSelected = isWorkspaceSelected({
    selection: previous.activeWorkspaceSelection,
    serverId: previous.workspace.serverId,
    workspaceId: previous.workspace.workspaceId,
    enabled: previous.selectionEnabled,
  });
  const nextSelected = isWorkspaceSelected({
    selection: next.activeWorkspaceSelection,
    serverId: next.workspace.serverId,
    workspaceId: next.workspace.workspaceId,
    enabled: next.selectionEnabled,
  });
  return (
    previous.workspace === next.workspace &&
    previous.workspaceEntry === next.workspaceEntry &&
    previous.hostBadge === next.hostBadge &&
    previous.leadingProjectName === next.leadingProjectName &&
    previous.leadingProjectIconDataUri === next.leadingProjectIconDataUri &&
    previous.shortcutNumber === next.shortcutNumber &&
    previous.showShortcutBadge === next.showShortcutBadge &&
    previous.canPin === next.canPin &&
    previous.canAddProject === next.canAddProject &&
    previous.onToggleWorkspacePin === next.onToggleWorkspacePin &&
    previous.reserveIdleStatusIndicatorSpace === next.reserveIdleStatusIndicatorSpace &&
    previous.onWorkspacePress === next.onWorkspacePress &&
    previous.drag === next.drag &&
    previous.isDragging === next.isDragging &&
    previous.dragHandleProps === next.dragHandleProps &&
    previous.collapseAccessory === next.collapseAccessory &&
    previousSelected === nextSelected
  );
}

const MemoWorkspaceRowItem = memo(WorkspaceRowItem, areWorkspaceRowItemPropsEqual);

function WorkspaceRow({
  workspaceEntry,
  hostBadge,
  leadingProjectName,
  leadingProjectIconDataUri,
  shortcutNumber,
  showShortcutBadge,
  onPress,
  drag,
  isDragging,
  dragHandleProps,
  canPin,
  canAddProject,
  onToggleWorkspacePin,
  reserveIdleStatusIndicatorSpace = true,
  collapseAccessory,
  selected,
}: {
  workspaceEntry: SidebarWorkspaceEntry | null;
  hostBadge?: HostBadgeModel | null;
  leadingProjectName?: string | null;
  leadingProjectIconDataUri?: string | null;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  onPress: () => void;
  drag: () => void;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
  canPin: boolean;
  canAddProject: boolean;
  onToggleWorkspacePin: ToggleSidebarWorkspacePin;
  reserveIdleStatusIndicatorSpace?: boolean;
  collapseAccessory?: WorkspaceCollapseToggle;
  selected: boolean;
}) {
  if (!workspaceEntry) {
    return null;
  }

  return (
    <WorkspaceRowWithMenu
      workspace={workspaceEntry}
      hostBadge={hostBadge}
      leadingProjectName={leadingProjectName}
      leadingProjectIconDataUri={leadingProjectIconDataUri}
      selected={selected}
      shortcutNumber={shortcutNumber}
      showShortcutBadge={showShortcutBadge}
      onPress={onPress}
      drag={drag}
      isDragging={isDragging}
      dragHandleProps={dragHandleProps}
      canPin={canPin}
      canAddProject={canAddProject}
      onToggleWorkspacePin={onToggleWorkspacePin}
      reserveIdleStatusIndicatorSpace={reserveIdleStatusIndicatorSpace}
      collapseAccessory={collapseAccessory}
    />
  );
}

function WorkspaceMemberRow({
  member,
  serverId,
  iconDataUri,
  canRemove,
  onRemove,
  onPress,
  onCopyPath,
  drag,
  isDragging,
  dragHandleProps,
}: {
  member: SidebarWorkspaceMemberRow;
  serverId: string;
  iconDataUri: string | null;
  canRemove: boolean;
  onRemove: () => void;
  onPress: () => void;
  onCopyPath: () => void;
  drag: () => void;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isKebabFocused, setIsKebabFocused] = useState(false);
  const isCompact = useIsCompactFormFactor();
  const actionsVisible = isHovered || isFocused || isKebabFocused || platformIsNative || isCompact;
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const handlePressIn = useCallback(() => setIsPressed(true), []);
  const handlePressOut = useCallback(() => setIsPressed(false), []);
  const handleFocus = useCallback(() => setIsFocused(true), []);
  const handleBlur = useCallback(() => setIsFocused(false), []);
  const handleKebabFocus = useCallback(() => setIsKebabFocused(true), []);
  const handleKebabBlur = useCallback(() => setIsKebabFocused(false), []);
  const backdrop = getSidebarRowBackdrop({
    isDragging,
    isPressed,
    selected: false,
    isHovered,
  });
  const rowStyle = [
    styles.memberRow,
    isHovered && styles.workspaceRowHovered,
    isPressed && styles.workspaceRowPressed,
    isDragging && styles.workspaceRowDragging,
  ];
  const {
    role: _dragRole,
    tabIndex: _dragTabIndex,
    "aria-roledescription": _dragRoleDescription,
    ...dragAttributes
  } = dragHandleProps?.attributes ?? {};

  return (
    <View
      {...dragAttributes}
      {...dragHandleProps?.listeners}
      ref={dragHandleProps?.setActivatorNodeRef as unknown as Ref<View>}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <ContextMenu>
        <ContextMenuTrigger
          accessibilityRole={platformIsWeb ? undefined : "button"}
          accessibilityLabel={member.projectName}
          onPress={onPress}
          onLongPress={drag}
          enabledOnMobile={false}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          onFocus={handleFocus}
          onBlur={handleBlur}
          style={rowStyle}
          highlightStyle={styles.workspaceRowPressed}
          testID={`sidebar-member-row-${member.memberKey}`}
        >
          <ProjectStatusIndicator
            iconDataUri={iconDataUri}
            displayName={member.projectName}
            projectViewKey={member.memberKey}
            statusBucket={null}
            backdrop={backdrop}
            testID={`sidebar-member-icon-${member.memberKey}`}
          />
          <Text style={styles.memberName} numberOfLines={1}>
            {member.projectName}
          </Text>
          <View
            style={!actionsVisible && styles.kebabButtonHidden}
            pointerEvents={actionsVisible ? "auto" : "none"}
          >
            <WorkspaceMemberKebabMenu
              member={member}
              serverId={serverId}
              onFocus={handleKebabFocus}
              onBlur={handleKebabBlur}
              canRemove={canRemove}
              onCopyPath={onCopyPath}
              onRemove={onRemove}
            />
          </View>
        </ContextMenuTrigger>
        <ContextMenuContent
          align="start"
          width={220}
          testID={`sidebar-member-context-menu-${member.memberKey}`}
        >
          <WorkspaceMemberMenuItems
            member={member}
            serverId={serverId}
            surface="context"
            canRemove={canRemove}
            onCopyPath={onCopyPath}
            onRemove={onRemove}
          />
        </ContextMenuContent>
      </ContextMenu>
    </View>
  );
}

type SidebarMemberAgentItem =
  | { kind: "new"; newAgent: SidebarWorkspaceNewAgentRow }
  | { kind: "agent"; agent: SidebarWorkspaceAgentRow };

function memberAgentKey(item: SidebarMemberAgentItem): string {
  return item.kind === "new" ? `new:${item.newAgent.tabId}` : `agent:${item.agent.agentId}`;
}

function memberKey(member: SidebarWorkspaceMemberRow): string {
  return member.memberKey;
}

function hasUncategorizedRows(section: SidebarWorkspaceSection): boolean {
  return (section.uncategorized.newAgents?.length ?? 0) + section.uncategorized.agents.length > 0;
}

/**
 * The agent rows under one bucket — a project member, or the workspace's uncategorized tabs.
 * Diff and PR facts belong to the bucket's directory, so a row whose cwd is something else shows
 * neither.
 */
function SidebarAgentItemList({
  orderKey,
  newAgents,
  agents,
  diffStat,
  prHint,
  serverId,
  workspaceId,
  onWorkspacePress,
}: {
  orderKey: string;
  newAgents: readonly SidebarWorkspaceNewAgentRow[] | undefined;
  agents: readonly SidebarWorkspaceAgentRow[];
  diffStat: { additions: number; deletions: number } | null;
  prHint: PrHint | null;
  serverId: string;
  workspaceId: string;
  onWorkspacePress?: () => void;
}) {
  const storedAgentOrder = useSidebarOrderStore(
    (state) => state.agentOrderByMember[orderKey] ?? EMPTY_ORDER,
  );
  const setAgentOrder = useSidebarOrderStore((state) => state.setAgentOrder);
  const agentItems = useMemo(() => {
    const items: SidebarMemberAgentItem[] = [
      ...(newAgents ?? []).map((newAgent) => ({ kind: "new" as const, newAgent })),
      ...agents.map((agent) => ({ kind: "agent" as const, agent })),
    ];
    return applyStoredOrdering({ items, storedOrder: storedAgentOrder, getKey: memberAgentKey });
  }, [agents, newAgents, storedAgentOrder]);
  const handleAgentDragEnd = useCallback(
    (items: SidebarMemberAgentItem[]) => {
      setAgentOrder(orderKey, items.map(memberAgentKey));
    },
    [orderKey, setAgentOrder],
  );
  const renderAgent = useCallback(
    ({
      item,
      drag: dragAgent,
      isActive,
      dragHandleProps: agentDragHandleProps,
    }: DraggableRenderItemInfo<SidebarMemberAgentItem>) => {
      if (item.kind === "new") {
        return (
          <WorkspaceNewAgentRow
            newAgent={item.newAgent}
            diffStat={item.newAgent.matchesMemberDirectory ? diffStat : null}
            prHint={item.newAgent.matchesMemberDirectory ? prHint : null}
            serverId={serverId}
            workspaceId={workspaceId}
            onWorkspacePress={onWorkspacePress}
            drag={dragAgent}
            isDragging={isActive}
            dragHandleProps={agentDragHandleProps}
          />
        );
      }
      return (
        <WorkspaceAgentRow
          agent={item.agent}
          diffStat={item.agent.matchesMemberDirectory ? diffStat : null}
          prHint={item.agent.matchesMemberDirectory ? prHint : null}
          serverId={serverId}
          workspaceId={workspaceId}
          onWorkspacePress={onWorkspacePress}
          drag={dragAgent}
          isDragging={isActive}
          dragHandleProps={agentDragHandleProps}
        />
      );
    },
    [diffStat, onWorkspacePress, prHint, serverId, workspaceId],
  );

  return (
    <DraggableList
      testID={`sidebar-agent-list-${orderKey}`}
      data={agentItems}
      keyExtractor={memberAgentKey}
      renderItem={renderAgent}
      onDragEnd={handleAgentDragEnd}
      scrollEnabled={false}
      useDragHandle
      nestable={platformIsNative}
    />
  );
}

/** Tabs and agents the workspace holds that have not chosen a project. */
function WorkspaceUncategorizedBlock({
  uncategorized,
  serverId,
  workspaceId,
  onWorkspacePress,
}: {
  uncategorized: SidebarWorkspaceUncategorizedRow;
  serverId: string;
  workspaceId: string;
  onWorkspacePress?: () => void;
}) {
  const { t } = useTranslation();
  const workspaceKey = `${serverId}:${workspaceId}`;

  return (
    <View testID={`sidebar-uncategorized-${workspaceKey}`}>
      <View style={styles.uncategorizedRow}>
        <Text style={styles.uncategorizedName} numberOfLines={1}>
          {t("sidebar.workspace.uncategorized")}
        </Text>
      </View>
      <SidebarAgentItemList
        orderKey={uncategorized.memberKey}
        newAgents={uncategorized.newAgents}
        agents={uncategorized.agents}
        diffStat={null}
        prHint={null}
        serverId={serverId}
        workspaceId={workspaceId}
        onWorkspacePress={onWorkspacePress}
      />
    </View>
  );
}

function WorkspaceMemberBlock({
  member,
  iconDataUri,
  serverId,
  workspaceId,
  prHint,
  canRemove,
  onWorkspacePress,
  drag,
  isDragging,
  dragHandleProps,
}: {
  member: SidebarWorkspaceMemberRow;
  iconDataUri: string | null;
  serverId: string;
  workspaceId: string;
  prHint: PrHint | null;
  canRemove: boolean;
  onWorkspacePress?: () => void;
  drag: () => void;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const removeWorkspaceMember = useRemoveWorkspaceMember();

  const handleCopyPath = useCallback(() => {
    void Clipboard.setStringAsync(member.workspaceDirectory);
    toast.copied(t("sidebar.workspace.toasts.pathCopied"));
  }, [member.workspaceDirectory, t, toast]);

  const handleRemove = useCallback(() => {
    if (!canRemove) {
      return;
    }
    void removeWorkspaceMember({
      client: getHostRuntimeStore().getClient(serverId),
      workspaceId,
      cwd: member.workspaceDirectory,
      projectName: member.projectName,
    });
  }, [
    canRemove,
    member.projectName,
    member.workspaceDirectory,
    removeWorkspaceMember,
    serverId,
    workspaceId,
  ]);

  const handlePress = useCallback(() => {
    onWorkspacePress?.();
    navigateToWorkspace({ serverId, workspaceId });
  }, [onWorkspacePress, serverId, workspaceId]);
  return (
    <>
      <WorkspaceMemberRow
        member={member}
        serverId={serverId}
        iconDataUri={iconDataUri}
        canRemove={canRemove}
        onRemove={handleRemove}
        onPress={handlePress}
        onCopyPath={handleCopyPath}
        drag={drag}
        isDragging={isDragging}
        dragHandleProps={dragHandleProps}
      />
      <SidebarAgentItemList
        orderKey={member.memberKey}
        newAgents={member.newAgents}
        agents={member.agents}
        diffStat={member.diffStat}
        prHint={prHint}
        serverId={serverId}
        workspaceId={workspaceId}
        onWorkspacePress={onWorkspacePress}
      />
    </>
  );
}

const MemoWorkspaceMemberBlock = memo(WorkspaceMemberBlock);

function WorkspaceSectionBlock({
  placement,
  workspaceEntry,
  section,
  collapsed,
  onToggleCollapsed,
  memberIconByMemberKey,
  canRemoveMembers,
  hostBadge,
  shortcutNumber,
  showShortcutBadge,
  canPin,
  canAddProject,
  onToggleWorkspacePin,
  selectionEnabled,
  activeWorkspaceSelection,
  onWorkspacePress,
  drag,
  isDragging,
  dragHandleProps,
}: {
  placement: SidebarWorkspacePlacement;
  workspaceEntry: SidebarWorkspaceEntry | null;
  section: SidebarWorkspaceSection | null;
  collapsed: boolean;
  onToggleCollapsed: (workspaceKey: string) => void;
  memberIconByMemberKey: ReadonlyMap<string, string | null>;
  canRemoveMembers: boolean;
  hostBadge?: HostBadgeModel | null;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  canPin: boolean;
  canAddProject: boolean;
  onToggleWorkspacePin: ToggleSidebarWorkspacePin;
  selectionEnabled: boolean;
  activeWorkspaceSelection: ActiveWorkspaceSelection | null;
  onWorkspacePress?: () => void;
  drag?: () => void;
  isDragging?: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
}) {
  const storedMemberOrder = useSidebarOrderStore(
    (state) => state.memberOrderByWorkspace[placement.workspaceKey] ?? EMPTY_ORDER,
  );
  const setMemberOrder = useSidebarOrderStore((state) => state.setMemberOrder);
  const orderedMembers = useMemo(
    () =>
      applyStoredOrdering({
        items: section?.members ?? EMPTY_MEMBERS,
        storedOrder: storedMemberOrder,
        getKey: memberKey,
      }),
    [section?.members, storedMemberOrder],
  );
  const handleToggleCollapsed = useCallback(() => {
    onToggleCollapsed(placement.workspaceKey);
  }, [onToggleCollapsed, placement.workspaceKey]);
  const collapseAccessory = useMemo<Omit<SidebarWorkspaceCollapseAccessory, "visible">>(
    () => ({
      chevron: collapsed ? "expand" : "collapse",
      onToggle: handleToggleCollapsed,
    }),
    [collapsed, handleToggleCollapsed],
  );
  const handleMemberDragEnd = useCallback(
    (members: SidebarWorkspaceMemberRow[]) => {
      setMemberOrder(placement.workspaceKey, members.map(memberKey));
    },
    [placement.workspaceKey, setMemberOrder],
  );
  const renderMember = useCallback(
    ({
      item,
      drag: dragMember,
      isActive,
      dragHandleProps: memberDragHandleProps,
    }: DraggableRenderItemInfo<SidebarWorkspaceMemberRow>) => (
      <MemoWorkspaceMemberBlock
        member={item}
        iconDataUri={memberIconByMemberKey.get(item.memberKey) ?? null}
        serverId={placement.serverId}
        workspaceId={placement.workspaceId}
        prHint={item.isPrimary ? (workspaceEntry?.prHint ?? null) : null}
        canRemove={canRemoveMembers}
        onWorkspacePress={onWorkspacePress}
        drag={dragMember}
        isDragging={isActive}
        dragHandleProps={memberDragHandleProps}
      />
    ),
    [
      canRemoveMembers,
      memberIconByMemberKey,
      onWorkspacePress,
      placement.serverId,
      placement.workspaceId,
      workspaceEntry?.prHint,
    ],
  );

  return (
    <View style={!collapsed && section ? styles.workspaceSectionExpanded : undefined}>
      <MemoWorkspaceRowItem
        workspace={placement}
        workspaceEntry={workspaceEntry}
        hostBadge={hostBadge}
        shortcutNumber={shortcutNumber}
        showShortcutBadge={showShortcutBadge}
        canPin={canPin}
        canAddProject={canAddProject}
        onToggleWorkspacePin={onToggleWorkspacePin}
        selectionEnabled={selectionEnabled}
        activeWorkspaceSelection={activeWorkspaceSelection}
        onWorkspacePress={onWorkspacePress}
        drag={drag}
        isDragging={isDragging}
        dragHandleProps={dragHandleProps}
        collapseAccessory={collapseAccessory}
      />
      {!collapsed && section ? (
        <>
          {hasUncategorizedRows(section) ? (
            <WorkspaceUncategorizedBlock
              uncategorized={section.uncategorized}
              serverId={placement.serverId}
              workspaceId={placement.workspaceId}
              onWorkspacePress={onWorkspacePress}
            />
          ) : null}
          <DraggableList
            testID={`sidebar-member-list-${placement.workspaceKey}`}
            data={orderedMembers}
            keyExtractor={memberKey}
            renderItem={renderMember}
            onDragEnd={handleMemberDragEnd}
            scrollEnabled={false}
            useDragHandle
            nestable={platformIsNative}
          />
        </>
      ) : null}
    </View>
  );
}

function areWorkspaceSectionBlockPropsEqual(
  previous: Omit<ComponentPropsOfWorkspaceSectionBlock, "children">,
  next: Omit<ComponentPropsOfWorkspaceSectionBlock, "children">,
): boolean {
  const previousSelected = isWorkspaceSelected({
    selection: previous.activeWorkspaceSelection,
    serverId: previous.placement.serverId,
    workspaceId: previous.placement.workspaceId,
    enabled: previous.selectionEnabled,
  });
  const nextSelected = isWorkspaceSelected({
    selection: next.activeWorkspaceSelection,
    serverId: next.placement.serverId,
    workspaceId: next.placement.workspaceId,
    enabled: next.selectionEnabled,
  });
  return (
    previous.placement === next.placement &&
    previous.workspaceEntry === next.workspaceEntry &&
    previous.section === next.section &&
    previous.collapsed === next.collapsed &&
    previous.onToggleCollapsed === next.onToggleCollapsed &&
    previous.memberIconByMemberKey === next.memberIconByMemberKey &&
    previous.canRemoveMembers === next.canRemoveMembers &&
    previous.hostBadge === next.hostBadge &&
    previous.shortcutNumber === next.shortcutNumber &&
    previous.showShortcutBadge === next.showShortcutBadge &&
    previous.canPin === next.canPin &&
    previous.canAddProject === next.canAddProject &&
    previous.onToggleWorkspacePin === next.onToggleWorkspacePin &&
    previous.onWorkspacePress === next.onWorkspacePress &&
    previous.drag === next.drag &&
    previous.isDragging === next.isDragging &&
    previous.dragHandleProps === next.dragHandleProps &&
    previousSelected === nextSelected
  );
}

type ComponentPropsOfWorkspaceSectionBlock = Parameters<typeof WorkspaceSectionBlock>[0];

const MemoWorkspaceSectionBlock = memo(WorkspaceSectionBlock, areWorkspaceSectionBlockPropsEqual);

export function SidebarWorkspaceList({
  workspaceGroups,
  projectIconTargets,
  memberIconTargets,
  pinnedGroups,
  topLevelWorkspaces,
  sectionsByWorkspaceKey,
  hasProjectsBeforeFilter,
  hasActiveProjectFilter,
  workspaceEntriesByKey,
  collapsedWorkspaceKeys,
  onToggleWorkspaceCollapsed,
  shortcutIndexByWorkspaceKey,
  groupMode,
  isRefreshing: _isRefreshing = false,
  onRefresh: _onRefresh,
  onWorkspacePress,
  onAddProject,
  listFooterComponent,
  listHeaderComponent,
  parentGestureRef,
  dragGestureHostPresented,
}: SidebarWorkspaceListProps) {
  const pathname = usePathname();
  const hosts = useHosts();
  const rowItems = useSidebarRowItems();
  // Host badge visibility is a lattice, not three competing switches: this gate is the global
  // "off", the visible-rows host count is the automatic "there is only one host so it says
  // nothing", and each host's own `badgeDisplay` decides name vs icon vs hidden. Turning the
  // item off here removes the badge everywhere; leaving it on defers to the per-host setting.
  const spansMultipleHosts = useMemo(() => {
    const serverIds = new Set<string>();
    for (const workspace of workspaceEntriesByKey.values()) {
      serverIds.add(workspace.serverId);
    }
    return serverIds.size >= 2;
  }, [workspaceEntriesByKey]);
  const hostBadgeByServerId = useHostBadges({
    enabled: rowItems.host && spansMultipleHosts,
  });
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const supportsPinningByServerId = useHostFeatureMap(serverIds, "workspacePinning");
  const supportsMultiProjectByServerId = useHostFeatureMap(serverIds, "workspaceMultiProject");
  const onToggleWorkspacePin = useSidebarWorkspacePinController();
  const getPinnedWorkspaceOrder = useSidebarOrderStore((state) => state.getPinnedWorkspaceOrder);
  const setPinnedWorkspaceOrder = useSidebarOrderStore((state) => state.setPinnedWorkspaceOrder);
  const hasActiveLabelFilter = useSidebarViewStore((state) =>
    hasActiveSidebarLabelFilter(state.labelFilter),
  );
  const handlePinnedWorkspaceReorder = useCallback(
    (reorderedWorkspaces: SidebarWorkspacePlacement[]) => {
      const reorderedWorkspaceKeys = reorderedWorkspaces.map((workspace) => workspace.workspaceKey);
      const currentOrder = getPinnedWorkspaceOrder();
      if (
        !hasVisibleOrderChanged({
          currentOrder,
          reorderedVisibleKeys: reorderedWorkspaceKeys,
        })
      ) {
        return;
      }

      setPinnedWorkspaceOrder(
        mergeWithRemainder({
          currentOrder,
          reorderedVisibleKeys: reorderedWorkspaceKeys,
        }),
      );
    },
    [getPinnedWorkspaceOrder, setPinnedWorkspaceOrder],
  );
  // One fetch, one map, every mode — pinned and status rows paint project icons keyed by
  // `projectViewKey`. The targets come from the projection that produced the rows, so the
  // question "what is on screen" is answered once.
  const projectIconByProjectViewKey = useProjectIcons({ projects: projectIconTargets });
  // Member rows carry their own project icons, keyed by `memberKey` instead.
  const memberIconByMemberKey = useProjectIcons({ projects: memberIconTargets });

  // A filter that matches nothing swaps the list's body and nothing above it. It used to replace
  // this whole subtree, which unmounted the header — and the header is where the display menu's
  // trigger lives, so filtering the last row away closed the menu you were filtering from.
  //
  // Only the label filter can get here. The project filter resolves against the projects it can
  // see and falls back to "all projects" when nothing matches, so it either keeps at least one
  // workspace or is not applied at all — it can narrow this list but never empty it.
  const hasVisibleRows = topLevelWorkspaces.length > 0 || pinnedGroups.pinnedChats.length > 0;
  const sidebarFilterEmpty = hasActiveLabelFilter && hasProjectsBeforeFilter && !hasVisibleRows;

  // The workspace grouping keeps its three-level sections; every other grouping mode is a flat
  // list of grouped rows, so a new mode lands in the grouped branch rather than silently in this
  // one's `else`.
  const content =
    groupMode !== "project" ? (
      <SidebarGroupedModeList
        workspaceGroups={workspaceGroups}
        pinnedGroups={pinnedGroups}
        workspaceEntriesByKey={workspaceEntriesByKey}
        projectIconByProjectViewKey={projectIconByProjectViewKey}
        shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
        onWorkspacePress={onWorkspacePress}
        hostBadgeByServerId={hostBadgeByServerId}
        supportsPinningByServerId={supportsPinningByServerId}
        onToggleWorkspacePin={onToggleWorkspacePin}
        onPinnedWorkspaceReorder={handlePinnedWorkspaceReorder}
        listHeaderComponent={listHeaderComponent}
        sidebarFilterEmpty={sidebarFilterEmpty}
        parentGestureRef={parentGestureRef}
        dragGestureHostPresented={dragGestureHostPresented}
      />
    ) : (
      <WorkspaceSectionList
        topLevelWorkspaces={topLevelWorkspaces}
        sectionsByWorkspaceKey={sectionsByWorkspaceKey}
        pinnedGroups={pinnedGroups}
        workspaceEntriesByKey={workspaceEntriesByKey}
        projectIconByProjectViewKey={projectIconByProjectViewKey}
        memberIconByMemberKey={memberIconByMemberKey}
        collapsedWorkspaceKeys={collapsedWorkspaceKeys}
        onToggleWorkspaceCollapsed={onToggleWorkspaceCollapsed}
        shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
        onWorkspacePress={onWorkspacePress}
        onAddProject={onAddProject}
        listFooterComponent={listFooterComponent}
        listHeaderComponent={listHeaderComponent}
        sidebarFilterEmpty={sidebarFilterEmpty}
        hasVisibleRows={hasVisibleRows}
        hasProjectsBeforeFilter={hasProjectsBeforeFilter}
        hasActiveProjectFilter={hasActiveProjectFilter}
        parentGestureRef={parentGestureRef}
        dragGestureHostPresented={dragGestureHostPresented}
        pathname={pathname}
        hostBadgeByServerId={hostBadgeByServerId}
        supportsPinningByServerId={supportsPinningByServerId}
        supportsMultiProjectByServerId={supportsMultiProjectByServerId}
        onToggleWorkspacePin={onToggleWorkspacePin}
        onPinnedWorkspaceReorder={handlePinnedWorkspaceReorder}
      />
    );

  return content;
}

/**
 * Every grouping mode except the workspace grouping: the rows are grouped by something else, so
 * each row carries its own project icon. Named for what it does rather than for the first mode
 * that needed it.
 */
function SidebarGroupedModeList({
  workspaceGroups,
  pinnedGroups,
  workspaceEntriesByKey,
  projectIconByProjectViewKey,
  shortcutIndexByWorkspaceKey: _projectShortcutIndex,
  onWorkspacePress,
  hostBadgeByServerId,
  supportsPinningByServerId,
  onToggleWorkspacePin,
  onPinnedWorkspaceReorder,
  listHeaderComponent,
  sidebarFilterEmpty,
  parentGestureRef,
  dragGestureHostPresented,
}: {
  workspaceGroups: SidebarWorkspaceGroup[];
  pinnedGroups: PinnedSidebarGroups;
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  projectIconByProjectViewKey: ReadonlyMap<string, string | null>;
  shortcutIndexByWorkspaceKey: Map<string, number>;
  onWorkspacePress?: () => void;
  hostBadgeByServerId: ReadonlyMap<string, HostBadgeModel>;
  supportsPinningByServerId: ReadonlyMap<string, boolean>;
  onToggleWorkspacePin: ToggleSidebarWorkspacePin;
  onPinnedWorkspaceReorder: (workspaces: SidebarWorkspacePlacement[]) => void;
  listHeaderComponent?: ReactElement | null;
  sidebarFilterEmpty: boolean;
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
  dragGestureHostPresented?: boolean;
}) {
  const showShortcutBadges = useShowShortcutBadges();
  const pinnedWorkspaces = useMemo(
    () =>
      pinnedGroups.pinnedChats.flatMap((workspace) => {
        const entry = workspaceEntriesByKey.get(workspace.workspaceKey);
        return entry ? [entry] : [];
      }),
    [pinnedGroups.pinnedChats, workspaceEntriesByKey],
  );

  return (
    <SidebarStatusWorkspaceList
      groups={workspaceGroups}
      pinnedWorkspaces={pinnedWorkspaces}
      projectIconByProjectViewKey={projectIconByProjectViewKey}
      shortcutIndexByWorkspaceKey={_projectShortcutIndex}
      showShortcutBadges={showShortcutBadges}
      onWorkspacePress={onWorkspacePress}
      hostBadgeByServerId={hostBadgeByServerId}
      supportsPinningByServerId={supportsPinningByServerId}
      onToggleWorkspacePin={onToggleWorkspacePin}
      onPinnedWorkspaceReorder={onPinnedWorkspaceReorder}
      listHeaderComponent={listHeaderComponent}
      sidebarFilterEmpty={sidebarFilterEmpty}
      parentGestureRef={parentGestureRef}
      dragGestureHostPresented={dragGestureHostPresented}
    />
  );
}

function WorkspaceSectionList({
  topLevelWorkspaces,
  sectionsByWorkspaceKey,
  pinnedGroups,
  workspaceEntriesByKey,
  projectIconByProjectViewKey,
  memberIconByMemberKey,
  collapsedWorkspaceKeys,
  onToggleWorkspaceCollapsed,
  shortcutIndexByWorkspaceKey,
  onWorkspacePress,
  onAddProject,
  listFooterComponent,
  listHeaderComponent,
  sidebarFilterEmpty,
  hasVisibleRows,
  hasProjectsBeforeFilter,
  hasActiveProjectFilter,
  parentGestureRef,
  dragGestureHostPresented,
  pathname,
  hostBadgeByServerId,
  supportsPinningByServerId,
  supportsMultiProjectByServerId,
  onToggleWorkspacePin,
  onPinnedWorkspaceReorder,
}: {
  topLevelWorkspaces: SidebarWorkspacePlacement[];
  sectionsByWorkspaceKey: ReadonlyMap<string, SidebarWorkspaceSection>;
  pinnedGroups: PinnedSidebarGroups;
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  projectIconByProjectViewKey: ReadonlyMap<string, string | null>;
  memberIconByMemberKey: ReadonlyMap<string, string | null>;
  collapsedWorkspaceKeys: ReadonlySet<string>;
  onToggleWorkspaceCollapsed: (workspaceKey: string) => void;
  shortcutIndexByWorkspaceKey: Map<string, number>;
  onWorkspacePress?: () => void;
  onAddProject?: () => void;
  listFooterComponent?: ReactElement | null;
  listHeaderComponent?: ReactElement | null;
  sidebarFilterEmpty: boolean;
  hasVisibleRows: boolean;
  hasProjectsBeforeFilter: boolean;
  hasActiveProjectFilter: boolean;
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
  dragGestureHostPresented?: boolean;
  pathname: string;
  hostBadgeByServerId: ReadonlyMap<string, HostBadgeModel>;
  supportsPinningByServerId: ReadonlyMap<string, boolean>;
  supportsMultiProjectByServerId: ReadonlyMap<string, boolean>;
  onToggleWorkspacePin: ToggleSidebarWorkspacePin;
  onPinnedWorkspaceReorder: (workspaces: SidebarWorkspacePlacement[]) => void;
}) {
  const hasActiveHostFilter = useSidebarViewStore((state) => state.hostFilters.length > 0);
  const showShortcutBadges = useShowShortcutBadges();
  const pinnedCollapsed = useSidebarCollapsedSectionsStore((state) => state.collapsedPinned);
  const togglePinnedCollapsed = useSidebarCollapsedSectionsStore(
    (state) => state.togglePinnedCollapsed,
  );

  const getTopLevelWorkspaceOrder = useSidebarOrderStore(
    (state) => state.getTopLevelWorkspaceOrder,
  );
  const setTopLevelWorkspaceOrder = useSidebarOrderStore(
    (state) => state.setTopLevelWorkspaceOrder,
  );

  const isWorkspaceRoute = useMemo(
    () => Boolean(pathname && parseHostWorkspaceRouteFromPathname(pathname)),
    [pathname],
  );
  const selectionEnabled = isWorkspaceRoute;
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const { pinnedChats } = pinnedGroups;
  const {
    visibleItems: visiblePinnedChats,
    expanded: pinnedChatsExpanded,
    canToggle: canTogglePinnedChats,
    toggleExpanded: togglePinnedChatsExpanded,
  } = useLimitedSidebarGroup(pinnedChats);
  const nativeScrollGestureProps = useMemo(
    () =>
      parentGestureRef
        ? ({
            // NestableScrollContainer forwards props to RNGH ScrollView. Keep
            // vertical scroll and sidebar close pan simultaneous: vertical
            // intent scrolls immediately, clear horizontal intent can still
            // activate close from inside the list.
            simultaneousHandlers: parentGestureRef,
          } as object)
        : undefined,
    [parentGestureRef],
  );

  const handleWorkspaceDragEnd = useCallback(
    (reorderedWorkspaces: SidebarWorkspacePlacement[]) => {
      const reorderedWorkspaceKeys = reorderedWorkspaces.map((workspace) => workspace.workspaceKey);
      const currentOrder = getTopLevelWorkspaceOrder();
      if (
        !hasVisibleOrderChanged({
          currentOrder,
          reorderedVisibleKeys: reorderedWorkspaceKeys,
        })
      ) {
        return;
      }

      setTopLevelWorkspaceOrder(
        mergeWithRemainder({
          currentOrder,
          reorderedVisibleKeys: reorderedWorkspaceKeys,
        }),
      );
    },
    [getTopLevelWorkspaceOrder, setTopLevelWorkspaceOrder],
  );

  const renderWorkspaceSection = useCallback(
    ({
      item,
      drag,
      isActive,
      dragHandleProps,
    }: DraggableRenderItemInfo<SidebarWorkspacePlacement>) => {
      const section = sectionsByWorkspaceKey.get(item.workspaceKey) ?? null;
      return (
        <MemoWorkspaceSectionBlock
          placement={item}
          workspaceEntry={workspaceEntriesByKey.get(item.workspaceKey) ?? null}
          section={section}
          collapsed={collapsedWorkspaceKeys.has(item.workspaceKey)}
          onToggleCollapsed={onToggleWorkspaceCollapsed}
          memberIconByMemberKey={memberIconByMemberKey}
          canRemoveMembers={
            supportsMultiProjectByServerId.get(item.serverId) === true &&
            (section?.members.length ?? 0) > 1
          }
          hostBadge={hostBadgeByServerId.get(item.serverId) ?? null}
          shortcutNumber={shortcutIndexByWorkspaceKey.get(item.workspaceKey) ?? null}
          showShortcutBadge={showShortcutBadges}
          canPin={supportsPinningByServerId.get(item.serverId) === true}
          canAddProject={supportsMultiProjectByServerId.get(item.serverId) === true}
          onToggleWorkspacePin={onToggleWorkspacePin}
          selectionEnabled={selectionEnabled}
          activeWorkspaceSelection={activeWorkspaceSelection}
          onWorkspacePress={onWorkspacePress}
          drag={drag}
          isDragging={isActive}
          dragHandleProps={dragHandleProps}
        />
      );
    },
    [
      sectionsByWorkspaceKey,
      workspaceEntriesByKey,
      collapsedWorkspaceKeys,
      onToggleWorkspaceCollapsed,
      memberIconByMemberKey,
      supportsMultiProjectByServerId,
      hostBadgeByServerId,
      shortcutIndexByWorkspaceKey,
      showShortcutBadges,
      supportsPinningByServerId,
      onToggleWorkspacePin,
      selectionEnabled,
      activeWorkspaceSelection,
      onWorkspacePress,
    ],
  );

  const renderPinnedChat = useCallback(
    ({
      item: workspace,
      drag,
      isActive,
      dragHandleProps,
    }: DraggableRenderItemInfo<SidebarWorkspacePlacement>) => {
      return (
        <MemoWorkspaceRowItem
          workspace={workspace}
          workspaceEntry={workspaceEntriesByKey.get(workspace.workspaceKey) ?? null}
          hostBadge={hostBadgeByServerId.get(workspace.serverId) ?? null}
          leadingProjectName={workspace.projectName}
          leadingProjectIconDataUri={
            projectIconByProjectViewKey.get(workspace.projectViewKey) ?? null
          }
          shortcutNumber={shortcutIndexByWorkspaceKey.get(workspace.workspaceKey) ?? null}
          showShortcutBadge={showShortcutBadges}
          canPin={supportsPinningByServerId.get(workspace.serverId) === true}
          canAddProject={supportsMultiProjectByServerId.get(workspace.serverId) === true}
          onToggleWorkspacePin={onToggleWorkspacePin}
          selectionEnabled={selectionEnabled}
          activeWorkspaceSelection={activeWorkspaceSelection}
          onWorkspacePress={onWorkspacePress}
          drag={drag}
          isDragging={isActive}
          dragHandleProps={dragHandleProps}
        />
      );
    },
    [
      activeWorkspaceSelection,
      hostBadgeByServerId,
      onWorkspacePress,
      selectionEnabled,
      shortcutIndexByWorkspaceKey,
      showShortcutBadges,
      supportsPinningByServerId,
      supportsMultiProjectByServerId,
      onToggleWorkspacePin,
      projectIconByProjectViewKey,
      workspaceEntriesByKey,
    ],
  );

  let workspaceBody: ReactElement | null = null;
  if (hasVisibleRows) {
    workspaceBody = (
      <DraggableList
        testID="sidebar-project-list"
        data={topLevelWorkspaces}
        keyExtractor={workspaceKeyExtractor}
        renderItem={renderWorkspaceSection}
        onDragEnd={handleWorkspaceDragEnd}
        extraData={activeWorkspaceSelectionKey(activeWorkspaceSelection)}
        scrollEnabled={false}
        useDragHandle
        nestable={platformIsNative}
        simultaneousGestureRef={parentGestureRef}
        gestureHostPresented={dragGestureHostPresented}
        containerStyle={styles.workspaceListContainer}
      />
    );
  } else if (!hasProjectsBeforeFilter) {
    workspaceBody = <SidebarProjectEmptyState onAddProject={onAddProject} />;
  }

  const content = (
    <>
      {pinnedChats.length > 0 ? (
        <View style={styles.pinnedSection} testID="sidebar-pinned-section">
          <PinnedSectionHeader collapsed={pinnedCollapsed} onToggle={togglePinnedCollapsed} />
          {pinnedCollapsed ? null : (
            <>
              <DraggableList
                testID="sidebar-pinned-list"
                data={visiblePinnedChats}
                keyExtractor={workspaceKeyExtractor}
                renderItem={renderPinnedChat}
                onDragEnd={onPinnedWorkspaceReorder}
                extraData={activeWorkspaceSelectionKey(activeWorkspaceSelection)}
                scrollEnabled={false}
                useDragHandle
                nestable={platformIsNative}
                simultaneousGestureRef={parentGestureRef}
                gestureHostPresented={dragGestureHostPresented}
                containerStyle={styles.workspaceListContainer}
              />
              {canTogglePinnedChats ? (
                <SidebarGroupToggleRow
                  expanded={pinnedChatsExpanded}
                  onPress={togglePinnedChatsExpanded}
                  testID="sidebar-pinned-show-more"
                />
              ) : null}
            </>
          )}
        </View>
      ) : null}
      {/* The header carries the display menu, which is the only way back out of a filter, so it
        stays for as long as a filter is what emptied the list. It is absent only when the
        sidebar is genuinely empty, where a section heading would sit over nothing. */}
      {hasVisibleRows || hasActiveHostFilter || hasActiveProjectFilter || sidebarFilterEmpty
        ? listHeaderComponent
        : null}
      {sidebarFilterEmpty ? <SidebarFilterEmptyState /> : workspaceBody}
      {listFooterComponent}
    </>
  );

  return (
    <View style={styles.container}>
      {platformIsNative ? (
        <NestableScrollContainer
          {...nativeScrollGestureProps}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          testID="sidebar-project-workspace-list-scroll"
        >
          {content}
        </NestableScrollContainer>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          testID="sidebar-project-workspace-list-scroll"
        >
          {content}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: theme.spacing[2],
    // Optical inset: aligns the visible Pinned/Workspaces glyph edge with the
    // Schedules icon across the divider; their layout boxes have different insets.
    paddingTop: 2,
    paddingBottom: theme.spacing[4],
  },
  pinnedSection: {
    marginBottom: theme.spacing[1],
  },
  workspaceListContainer: {},
  // Same role as the old project block's expanded padding: the break between two workspace
  // sections reads as a break rather than as one more row of pitch. Padding on the block rather
  // than margin, and only while it has children: a collapsed workspace gives the gap back.
  workspaceSectionExpanded: {
    paddingBottom: theme.spacing[3],
  },
  // One level under the workspace header: the icon sits under the header's title, on the same
  // rail the grouped rows used. Padding rather than margin so the hover and pressed fills stay
  // the same box as every other row in the sidebar.
  memberRow: {
    minHeight: 32,
    marginBottom: theme.spacing[0.5],
    paddingVertical: theme.spacing[1.5],
    paddingLeft: theme.spacing[2] + theme.iconSize.md + theme.spacing[2],
    paddingRight: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    userSelect: "none",
  },
  // A label, not a project row: the members' rail so its children line up with theirs, but no
  // icon, no hover, and nothing to press.
  uncategorizedRow: {
    minHeight: 32,
    marginBottom: theme.spacing[0.5],
    paddingVertical: theme.spacing[1.5],
    paddingLeft: theme.spacing[2] + theme.iconSize.md + theme.spacing[2],
    paddingRight: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    userSelect: "none",
  },
  uncategorizedName: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: "400",
    minWidth: 0,
    flex: 1,
    flexShrink: 1,
  },
  memberName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "400",
    minWidth: 0,
    flex: 1,
    flexShrink: 1,
  },
  workspaceRow: {
    minHeight: 36,
    marginBottom: theme.spacing[0.5],
    paddingVertical: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "center",
    gap: theme.spacing[1],
    userSelect: "none",
  },
  workspaceRowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  workspaceRowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  workspaceRowDragging: {
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    transform: [{ scale: 1.02 }],
    zIndex: 3,
    ...theme.shadow.md,
  },
  sidebarRowSelected: {
    backgroundColor: theme.colors.surfaceSidebarSelected,
  },
  workspaceRowContainer: {
    position: "relative",
  },
  workspaceCreatingText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 0,
  },
  kebabButtonHidden: {
    opacity: 0,
  },
}));
