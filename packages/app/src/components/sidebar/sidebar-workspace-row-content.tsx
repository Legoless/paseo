import { memo, useMemo, useCallback, useRef, useState, type ReactNode } from "react";
import {
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextInputKeyPressEventData,
  type TextStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react-native";
import { ProjectStatusIndicator } from "@/components/sidebar/project-leading-visual";
import type { SidebarSurfaceBackdrop } from "@/styles/surface-backdrop";
import {
  WorkspaceMetaRow,
  type WorkspaceServiceSummary,
} from "@/components/sidebar/workspace-meta-row";
import { WorkspaceHoverCard } from "@/components/workspace-hover-card";
import type { HostBadgeModel } from "@/hosts/appearance";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import {
  hasSidebarWorkspaceTrailing,
  type SidebarWorkspaceTrailing,
} from "@/components/sidebar/workspace-trailing";
import { useAppSettings } from "@/hooks/use-settings";
import type { Theme } from "@/styles/theme";
import { resolveSidebarWorkspacePrimaryLabel } from "@/components/sidebar/sidebar-workspace-title";
import { TrailingActionScrim } from "@/components/ui/trailing-action-scrim";
import { useWorkspaceLabelDefinitions } from "@/workspace-labels";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import {
  requestWorkspaceRename,
  useWorkspaceRenameIntentStore,
} from "@/stores/workspace-rename-intent-store";
import { WorkspaceTitleRenameTarget } from "@/components/sidebar/workspace-title-rename-target";
import { resolveWorkspaceRenameOutcome } from "@/components/sidebar/workspace-inline-rename";

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedFolder = withUnistyles(Folder);
const ThemedFolderOpen = withUnistyles(FolderOpen);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);

/**
 * The workspace-grouped sidebar's one collapse control. It shares the row's leading slot with
 * the status indicator: the slot keeps its fixed box, so swapping between the two never moves
 * the row. `visible` decides which face shows; the slot is a toggle target whenever the
 * accessory is present. Passed to the row content as scalars (`collapseChevron`,
 * `collapseChevronVisible`, `onCollapseToggle`) so the memoized content keeps stable props.
 */
export interface SidebarWorkspaceCollapseAccessory {
  chevron: "expand" | "collapse";
  visible: boolean;
  onToggle: () => void;
}

export function SidebarWorkspaceRowFrame({
  workspace,
  isDragging = false,
  children,
}: {
  workspace: SidebarWorkspaceEntry;
  isDragging?: boolean;
  children: (input: {
    isHovered: boolean;
    contextMenuOpen: boolean;
    onContextMenuOpenChange: (open: boolean) => void;
    hoverHandlers: { onPointerEnter: () => void; onPointerLeave: () => void };
  }) => ReactNode;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const handlePointerEnter = useCallback(() => {
    if (!contextMenuOpen) setIsHovered(true);
  }, [contextMenuOpen]);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const handleContextMenuOpenChange = useCallback((open: boolean) => {
    setContextMenuOpen(open);
    if (open) setIsHovered(false);
  }, []);
  const hoverHandlers = useMemo(
    () => ({ onPointerEnter: handlePointerEnter, onPointerLeave: handlePointerLeave }),
    [handlePointerEnter, handlePointerLeave],
  );

  return (
    <WorkspaceHoverCard workspace={workspace} isDragging={isDragging} disabled={contextMenuOpen}>
      {children({
        isHovered: isHovered && !contextMenuOpen && !isDragging,
        contextMenuOpen,
        onContextMenuOpenChange: handleContextMenuOpenChange,
        hoverHandlers,
      })}
    </WorkspaceHoverCard>
  );
}

export const SidebarWorkspaceRowContent = memo(function SidebarWorkspaceRowContent({
  workspace,
  hostBadge,
  leadingProjectName = null,
  leadingProjectIconDataUri = null,
  serviceSummary = null,
  backdrop,
  isHovered,
  isLoading,
  isCreating = false,
  shortcutNumber = null,
  showShortcutBadge = false,
  reserveIdleStatusIndicatorSpace = true,
  collapseChevron,
  collapseChevronVisible = false,
  onCollapseToggle,
  children,
}: {
  workspace: SidebarWorkspaceEntry;
  hostBadge?: HostBadgeModel | null;
  /** Hoisted rows use their project icon as the leading visual because no project row contains them. */
  leadingProjectName?: string | null;
  leadingProjectIconDataUri?: string | null;
  serviceSummary?: WorkspaceServiceSummary | null;
  /** The row's current background, so the project status badge can knock out of it. */
  backdrop: SidebarSurfaceBackdrop;
  isHovered: boolean;
  isLoading: boolean;
  isCreating?: boolean;
  shortcutNumber?: number | null;
  showShortcutBadge?: boolean;
  /** Keep the empty leading slot when the workspace has no active status. */
  reserveIdleStatusIndicatorSpace?: boolean;
  /** Top-level workspace rows only: turns the leading slot into the subtree collapse toggle. */
  collapseChevron?: "expand" | "collapse";
  collapseChevronVisible?: boolean;
  onCollapseToggle?: () => void;
  children?: ReactNode;
}) {
  const {
    settings: { workspaceTitleSource },
  } = useAppSettings();
  const workspaceLabel = resolveSidebarWorkspacePrimaryLabel({ workspace, workspaceTitleSource });
  // Cheap despite being per-row: this store only changes when a workspace is
  // created, and the selector collapses to a boolean so other rows never
  // re-render. Kept here rather than at the three call sites so every surface
  // that renders a workspace row can be renamed in place.
  const isRenaming = useWorkspaceRenameIntentStore(
    (state) => state.workspaceKey === workspace.workspaceKey,
  );
  const handleRequestRename = useCallback(
    () =>
      requestWorkspaceRename({
        serverId: workspace.serverId,
        workspaceId: workspace.workspaceId,
      }),
    [workspace.serverId, workspace.workspaceId],
  );
  // The workspace carries label names; their colors live in its host's catalog, so the row is
  // where the two meet — the meta line is handed finished definitions.
  const labels = useWorkspaceLabelDefinitions(workspace.serverId, workspace.labels);
  const workspaceBranchTextStyle = useMemo(
    () => [
      styles.workspaceBranchText,
      isHovered && styles.workspaceBranchTextHovered,
      isCreating && styles.workspaceBranchTextCreating,
    ],
    [isHovered, isCreating],
  );

  return (
    <View style={styles.workspaceRowContent}>
      <View style={styles.workspaceRowMain}>
        {leadingProjectName ? (
          <ProjectStatusIndicator
            iconDataUri={leadingProjectIconDataUri}
            displayName={leadingProjectName}
            projectViewKey={workspace.projectViewKey}
            statusBucket={workspace.statusBucket}
            backdrop={backdrop}
            loading={isLoading}
            testID={`sidebar-row-project-icon-${workspace.workspaceKey}`}
          />
        ) : (
          <WorkspaceLeadingSlot
            reserveIdleSpace={reserveIdleStatusIndicatorSpace}
            collapseChevron={collapseChevron}
            collapseChevronVisible={collapseChevronVisible}
            onCollapseToggle={onCollapseToggle}
            workspaceKey={workspace.workspaceKey}
          />
        )}
        <View style={styles.workspaceContentColumn}>
          <View style={styles.workspaceTitleRow}>
            {isRenaming ? (
              <WorkspaceInlineNameEditor workspace={workspace} style={workspaceBranchTextStyle} />
            ) : (
              <WorkspaceTitleRenameTarget onRequestRename={handleRequestRename}>
                <Text style={workspaceBranchTextStyle} numberOfLines={1}>
                  {workspaceLabel}
                </Text>
              </WorkspaceTitleRenameTarget>
            )}
            <View style={sidebarWorkspaceRowStyles.rowRight}>{children}</View>
          </View>
          <WorkspaceMetaRow
            projectName={leadingProjectName}
            hostBadge={hostBadge ?? null}
            prHint={workspace.prHint}
            serviceSummary={serviceSummary}
            labels={labels}
          />
        </View>
      </View>
      {showShortcutBadge && shortcutNumber !== null ? (
        <View style={styles.shortcutBadgeOverlay} pointerEvents="none">
          <SidebarWorkspaceShortcutBadge number={shortcutNumber} />
        </View>
      ) : null}
    </View>
  );
});

/**
 * Renames a workspace where it sits. Raised automatically right after a workspace
 * is created, so naming it is one keystroke rather than a trip through a dialog.
 *
 * Enter commits; Escape and blur leave the current name alone. Blur deliberately
 * does not commit: the workspace already has a usable name, so losing a
 * half-typed one costs nothing, while committing it by accident does.
 */
function WorkspaceInlineNameEditor({
  workspace,
  style,
}: {
  workspace: SidebarWorkspaceEntry;
  style: StyleProp<TextStyle>;
}) {
  const clearIntent = useWorkspaceRenameIntentStore((state) => state.clear);
  const valueRef = useRef(workspace.title ?? workspace.name);
  const committedRef = useRef(false);

  const finish = useCallback(() => {
    clearIntent(workspace.workspaceKey);
  }, [clearIntent, workspace.workspaceKey]);

  const handleSubmit = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;
    const outcome = resolveWorkspaceRenameOutcome({
      value: valueRef.current,
      title: workspace.title ?? null,
      name: workspace.name,
    });
    finish();
    if (outcome.kind === "unchanged") return;
    const client = getHostRuntimeStore().getClient(workspace.serverId);
    if (!client) return;
    void client.setWorkspaceTitle(
      workspace.workspaceId,
      outcome.kind === "reset" ? null : outcome.title,
    );
  }, [finish, workspace.name, workspace.serverId, workspace.title, workspace.workspaceId]);

  const handleChangeText = useCallback((next: string) => {
    valueRef.current = next;
  }, []);

  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (event.nativeEvent.key === "Escape") finish();
    },
    [finish],
  );

  return (
    <AdaptiveTextInput
      initialValue={workspace.title ?? workspace.name}
      onChangeText={handleChangeText}
      onSubmitEditing={handleSubmit}
      onBlur={finish}
      onKeyPress={handleKeyPress}
      autoFocus
      selectTextOnFocus
      autoCapitalize="none"
      autoCorrect={false}
      style={[style, styles.workspaceNameInput]}
      testID={`sidebar-workspace-name-input-${workspace.workspaceKey}`}
    />
  );
}

function WorkspaceLeadingSlot({
  reserveIdleSpace = true,
  collapseChevron,
  collapseChevronVisible = false,
  onCollapseToggle,
  workspaceKey,
}: {
  reserveIdleSpace?: boolean;
  collapseChevron?: "expand" | "collapse";
  collapseChevronVisible?: boolean;
  onCollapseToggle?: () => void;
  workspaceKey: string;
}) {
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      // The toggle belongs to the subtree, not the row: pressing it must not navigate.
      event.stopPropagation();
      onCollapseToggle?.();
    },
    [onCollapseToggle],
  );
  // "collapse" is the action the toggle offers, so it means the subtree is open right now.
  const isOpen = collapseChevron === "collapse";
  const glyph = <WorkspaceLeadingGlyph open={isOpen} reserveIdleSpace={reserveIdleSpace} />;
  if (!collapseChevron || !onCollapseToggle) {
    return glyph;
  }
  let slotContent: ReactNode = glyph;
  if (collapseChevronVisible) {
    slotContent =
      collapseChevron === "collapse" ? (
        <ThemedChevronDown size={14} uniProps={foregroundMutedColorMapping} />
      ) : (
        <ThemedChevronRight size={14} uniProps={foregroundMutedColorMapping} />
      );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        collapseChevron === "collapse" ? "Collapse workspace" : "Expand workspace"
      }
      hitSlop={6}
      onPress={handlePress}
      style={styles.workspaceLeadingSlot}
      testID={`sidebar-workspace-collapse-toggle-${workspaceKey}`}
    >
      {slotContent}
    </Pressable>
  );
}

function WorkspaceLeadingGlyph({
  open,
  reserveIdleSpace = true,
}: {
  open: boolean;
  reserveIdleSpace?: boolean;
}) {
  // The slot used to carry the row's aggregate status — a ring while running, a coloured dot
  // otherwise — which put several shapes in one 16pt box and made the rail shift as agents worked.
  // It shows whether the workspace is open instead, which is the one thing about the row that the
  // glyph can say without moving. Status lives on the agent rows underneath it.
  if (!reserveIdleSpace) {
    return null;
  }
  return (
    <View style={styles.workspaceLeadingSlot} testID="workspace-leading-glyph">
      {open ? (
        <ThemedFolderOpen size={14} uniProps={foregroundMutedColorMapping} />
      ) : (
        <ThemedFolder size={14} uniProps={foregroundMutedColorMapping} />
      )}
    </View>
  );
}

export const sidebarWorkspaceRowStyles = StyleSheet.create((theme) => ({
  // How far a workspace row sits inside the group header above it — a project row or a
  // status group header. Both groupings share this one indent, so every grouped workspace row
  // in the sidebar sits on the same rail regardless of how the list is grouped. Pinned rows
  // are not grouped and stay flush.
  //
  // It is row padding rather than a margin on the list, because the row's hover and selected
  // backgrounds have to keep spanning the group's full width. Indenting the container instead
  // pulls the highlight in with the content and the row stops lining up with its header.
  rowIndented: {
    paddingLeft: theme.spacing[2] + theme.spacing[2],
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  shortcutBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.surface2,
    backgroundColor: theme.colors.surface0,
    flexShrink: 0,
  },
  shortcutBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 14,
  },
  hidden: { opacity: 0 },
  // Stays position:relative at zero width so the absolutely-positioned kebab keeps
  // anchoring to the same right edge whether or not the slot holds anything.
  trailingActionSlot: {
    position: "relative",
    minHeight: 20,
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "flex-start",
  },
  trailingActionSlotReserved: {
    position: "relative",
    minWidth: 18,
    minHeight: 20,
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "flex-start",
  },
  trailingActionOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
  },
}));

export function SidebarWorkspaceShortcutBadge({ number }: { number: number }) {
  return (
    <View style={sidebarWorkspaceRowStyles.shortcutBadge}>
      <Text style={sidebarWorkspaceRowStyles.shortcutBadgeText}>{number}</Text>
    </View>
  );
}

/**
 * What the trailing slot shows for a row. Derived in one place because three row renderers
 * share it: the two project-mode rows and the status-mode row. The rule used to be copied
 * into each of them and immediately drifted — one call site kept hiding the diff after the
 * others stopped.
 *
 * The trailing content survives the kebab on hover and fades under the scrim instead of
 * blinking out. Touch has no hover, so its permanent kebab still hides the content outright
 * rather than scrimming an unhovered row whose background doesn't match the gradient.
 */
export function resolveTrailingActionVisibility({
  workspace,
  trailing,
  hasArchiveAction,
  isHovered,
  isTouchPlatform,
  showShortcut,
}: {
  workspace: SidebarWorkspaceEntry;
  trailing: SidebarWorkspaceTrailing;
  hasArchiveAction: boolean;
  isHovered: boolean;
  isTouchPlatform: boolean;
  showShortcut: boolean;
}): {
  showTrailing: boolean;
  showKebab: boolean;
  showScrim: boolean;
  renderSlot: boolean;
  reserveSlotWidth: boolean;
} {
  const hasTrailing = hasSidebarWorkspaceTrailing({ workspace, trailing });
  const showKebab = Boolean(hasArchiveAction && (isHovered || isTouchPlatform)) && !showShortcut;
  const showTrailing = hasTrailing && !showShortcut && (isHovered || !showKebab);
  return {
    showTrailing,
    showKebab,
    // The scrim paints the row's own hover background, so it can only be drawn on a hovered
    // row — over an unhovered one the gradient fades to the wrong color. That is also why
    // touch, which shows the kebab without ever hovering, never gets one.
    showScrim: showKebab && isHovered,
    renderSlot: hasArchiveAction || hasTrailing,
    // The slot only holds width for something that permanently sits in it. Trailing content
    // does; the kebab only does on touch, where there is no hover for it to appear on and so
    // no scrim to let it overlay the title. Everywhere else the width goes back to the title
    // and the kebab fades in over its tail.
    reserveSlotWidth: hasTrailing || (hasArchiveAction && isTouchPlatform),
  };
}

export function SidebarWorkspaceTrailingActionSlot({
  reserveWidth,
  children,
}: {
  reserveWidth: boolean;
  children: ReactNode;
}) {
  return (
    <View
      style={
        reserveWidth
          ? sidebarWorkspaceRowStyles.trailingActionSlotReserved
          : sidebarWorkspaceRowStyles.trailingActionSlot
      }
    >
      {children}
    </View>
  );
}

export function SidebarWorkspaceTrailingActionBase({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  if (!children) return null;
  return <View style={visible ? undefined : sidebarWorkspaceRowStyles.hidden}>{children}</View>;
}

export function SidebarWorkspaceTrailingActionOverlay({
  visible,
  scrimBackdrop,
  children,
}: {
  visible: boolean;
  /** Fade the row into the kebab when something (the diff stat) is still rendered behind it. */
  scrimBackdrop?: SidebarSurfaceBackdrop;
  children: ReactNode;
}) {
  if (!visible || !children) return null;
  return (
    <>
      {scrimBackdrop ? (
        <TrailingActionScrim backdrop={scrimBackdrop} testID="sidebar-workspace-trailing-scrim" />
      ) : null}
      <View style={sidebarWorkspaceRowStyles.trailingActionOverlay}>{children}</View>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  workspaceRowContent: {
    position: "relative",
  },
  workspaceRowMain: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    width: "100%",
  },
  workspaceContentColumn: {
    flex: 1,
    minWidth: 0,
  },
  workspaceTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  shortcutBadgeOverlay: {
    position: "absolute",
    top: 1,
    right: 0,
  },
  workspaceLeadingSlot: {
    position: "relative",
    width: theme.iconSize.md,
    height: 20,
    borderRadius: theme.borderRadius.full,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  // The title owns the first line outright now that the host, change request and CI moved
  // to the meta row, so it takes the full width the trailing slot leaves behind.
  workspaceNameInput: {
    flex: 1,
    padding: 0,
    margin: 0,
  },
  workspaceBranchText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "400",
    lineHeight: 20,
    opacity: 0.76,
    flex: 1,
    minWidth: 0,
  },
  workspaceBranchTextCreating: {
    opacity: 0.92,
  },
  workspaceBranchTextHovered: {
    opacity: 1,
  },
}));
