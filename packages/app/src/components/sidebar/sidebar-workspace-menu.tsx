import {
  useCallback,
  useMemo,
  type ComponentProps,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import React from "react";
import { useTranslation } from "react-i18next";
import * as Clipboard from "expo-clipboard";
import { type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  Archive,
  CircleCheck,
  Copy,
  FolderPlus,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  Tag,
} from "lucide-react-native";
import { isWeb } from "@/constants/platform";
import { getForgePresentation, normalizeForge } from "@/git/forge";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useAppSettings } from "@/hooks/use-settings";
import type { Theme } from "@/styles/theme";
import type { ShortcutKey } from "@/utils/format-shortcut";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { WorkspaceMenuItem } from "@/components/sidebar/workspace-menu-item";
import { OpenInFileManagerMenuItem } from "@/workspace/open-in-file-manager/menu-item";
import { useToast } from "@/contexts/toast-context";
import { Shortcut } from "@/components/ui/shortcut";
import { resolveSidebarWorkspaceAccessibilityLabel } from "@/components/sidebar/sidebar-workspace-title";
import {
  workspaceServiceLabelKey,
  type WorkspaceServiceSummary,
} from "@/components/sidebar/workspace-meta-row";
import {
  useWorkspaceLabelMenuPages,
  WORKSPACE_LABEL_PAGE_ID,
  type WorkspaceLabelTarget,
} from "@/workspace-labels/picker";

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const ThemedMoreVertical = withUnistyles(MoreVertical);
const ThemedCopy = withUnistyles(Copy);
const ThemedArchive = withUnistyles(Archive);
const ThemedPencil = withUnistyles(Pencil);
const ThemedCircleCheck = withUnistyles(CircleCheck);
const ThemedPin = withUnistyles(Pin);
const ThemedPinOff = withUnistyles(PinOff);
const ThemedTag = withUnistyles(Tag);
const ThemedFolderPlus = withUnistyles(FolderPlus);

const renameLeadingIcon = <ThemedPencil size={14} uniProps={foregroundMutedColorMapping} />;
const copyLeadingIcon = <ThemedCopy size={14} uniProps={foregroundMutedColorMapping} />;
const markAsReadLeadingIcon = (
  <ThemedCircleCheck size={14} uniProps={foregroundMutedColorMapping} />
);
const archiveLeadingIcon = <ThemedArchive size={14} uniProps={foregroundMutedColorMapping} />;
const pinLeadingIcon = <ThemedPin size={14} uniProps={foregroundMutedColorMapping} />;
const unpinLeadingIcon = <ThemedPinOff size={14} uniProps={foregroundMutedColorMapping} />;
const addProjectLeadingIcon = <ThemedFolderPlus size={14} uniProps={foregroundMutedColorMapping} />;

function renderTriggerIcon({ hovered }: { hovered?: boolean }) {
  return (
    <ThemedMoreVertical
      size={14}
      uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
    />
  );
}

export interface SidebarWorkspaceMenuProps {
  workspaceKey: string;
  workspace?: SidebarWorkspaceEntry;
  includeProjectActions?: boolean;
  serverId?: string;
  workspaceId?: string;
  workspaceLabels?: readonly string[];
  onRename?: () => void;
  onMarkAsRead?: () => void;
  onAddProject?: () => void;
  onArchive: () => void;
  archiveLabel?: string;
  archiveStatus?: "idle" | "pending" | "success";
  archivePendingLabel?: string;
  archiveShortcutKeys?: ShortcutKey[][] | null;
  isPinned?: boolean;
  onTogglePin?: () => void;
  /**
   * Lifted so the row that reveals the kebab can keep it mounted while its menu is up. See
   * `useOpenKebabMenuVisibility`.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface SidebarWorkspaceMenuItemsProps extends Omit<
  SidebarWorkspaceMenuProps,
  "onArchive" | "open" | "onOpenChange" | "workspace" | "includeProjectActions"
> {
  onCopyPath?: () => void;
  openInFileManagerPath?: string | null;
  onArchive?: () => void;
}

type MenuSurface = "context" | "dropdown";

function useWorkspaceProjectMenuActions(
  workspace: SidebarWorkspaceEntry | undefined,
  enabled: boolean,
) {
  const { t } = useTranslation();
  const toast = useToast();
  const handleCopyPath = useCallback(() => {
    if (!workspace) return;
    void Clipboard.setStringAsync(workspace.workspaceDirectory);
    toast.copied(t("sidebar.workspace.toasts.pathCopied"));
  }, [t, toast, workspace]);
  return {
    onCopyPath: enabled && workspace ? handleCopyPath : undefined,
    openInFileManagerPath: enabled ? workspace?.workspaceDirectory : undefined,
  };
}

function SidebarWorkspaceMenuItems({
  surface,
  workspaceKey,
  serverId,
  workspaceId,
  onCopyPath,
  openInFileManagerPath,
  onRename,
  onMarkAsRead,
  onAddProject,
  onArchive,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  archiveShortcutKeys,
  isPinned,
  onTogglePin,
}: SidebarWorkspaceMenuItemsProps & { surface: MenuSurface }): ReactNode {
  const { t } = useTranslation();
  const archiveTrailing = useMemo(
    () => (archiveShortcutKeys ? <Shortcut chord={archiveShortcutKeys} /> : null),
    [archiveShortcutKeys],
  );
  const labelLeading = useMemo(
    () => <ThemedTag size={14} uniProps={foregroundMutedColorMapping} />,
    [],
  );

  return (
    <>
      {onCopyPath ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-copy-path-${workspaceKey}`}
          leading={copyLeadingIcon}
          onSelect={onCopyPath}
        >
          {t("sidebar.workspace.actions.copyPath")}
        </WorkspaceMenuItem>
      ) : null}
      {onRename ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-rename-${workspaceKey}`}
          leading={renameLeadingIcon}
          onSelect={onRename}
        >
          {t("sidebar.workspace.actions.rename")}
        </WorkspaceMenuItem>
      ) : null}
      {onMarkAsRead ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-mark-as-read-${workspaceKey}`}
          leading={markAsReadLeadingIcon}
          onSelect={onMarkAsRead}
        >
          Mark as read
        </WorkspaceMenuItem>
      ) : null}
      {onTogglePin ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-pin-${workspaceKey}`}
          leading={isPinned ? unpinLeadingIcon : pinLeadingIcon}
          onSelect={onTogglePin}
        >
          {isPinned ? t("sidebar.workspace.actions.unpin") : t("sidebar.workspace.actions.pin")}
        </WorkspaceMenuItem>
      ) : null}
      {onAddProject ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-add-project-${workspaceKey}`}
          leading={addProjectLeadingIcon}
          onSelect={onAddProject}
        >
          Add project…
        </WorkspaceMenuItem>
      ) : null}
      {serverId && workspaceId ? (
        <DropdownMenuSubTrigger
          id={WORKSPACE_LABEL_PAGE_ID}
          leading={labelLeading}
          testID={`sidebar-workspace-menu-labels-${workspaceKey}`}
        >
          {t("workspaceLabels.title")}
        </DropdownMenuSubTrigger>
      ) : null}
      <OpenInFileManagerMenuItem
        surface={surface}
        serverId={serverId}
        path={openInFileManagerPath}
        testID={`sidebar-workspace-menu-open-folder-${workspaceKey}`}
      />
      {onArchive ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-archive-${workspaceKey}`}
          leading={archiveLeadingIcon}
          trailing={archiveTrailing}
          status={archiveStatus}
          pendingLabel={archivePendingLabel}
          onSelect={onArchive}
        >
          {archiveLabel ?? t("sidebar.workspace.actions.archive")}
        </WorkspaceMenuItem>
      ) : null}
    </>
  );
}

export function SidebarWorkspaceMenu({
  workspaceKey,
  workspace,
  includeProjectActions = false,
  serverId,
  workspaceId,
  workspaceLabels,
  onRename,
  onMarkAsRead,
  onAddProject,
  onArchive,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  archiveShortcutKeys,
  isPinned,
  onTogglePin,
  open,
  onOpenChange,
}: SidebarWorkspaceMenuProps) {
  const { t } = useTranslation();
  const projectActions = useWorkspaceProjectMenuActions(workspace, includeProjectActions);
  const workspaceTarget = useMemo<WorkspaceLabelTarget | null>(
    () =>
      serverId && workspaceId
        ? { kind: "workspace", serverId, workspaceId, labels: workspaceLabels ?? [] }
        : null,
    [serverId, workspaceId, workspaceLabels],
  );
  const pages = useWorkspaceLabelMenuPages(workspaceTarget);
  return (
    <DropdownMenu compactMode="sheet" open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        hitSlop={8}
        style={triggerStyle}
        accessibilityRole={isWeb ? undefined : "button"}
        accessibilityLabel={t("sidebar.workspace.actions.menu")}
        testID={`sidebar-workspace-kebab-${workspaceKey}`}
      >
        {renderTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        width={260}
        pages={pages}
        sheetTitle={t("sidebar.workspace.actions.menu")}
      >
        <SidebarWorkspaceMenuItems
          surface="dropdown"
          workspaceKey={workspaceKey}
          serverId={serverId}
          workspaceId={workspaceId}
          workspaceLabels={workspaceLabels}
          onCopyPath={projectActions.onCopyPath}
          openInFileManagerPath={projectActions.openInFileManagerPath}
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type ContextTriggerProps = Omit<
  ComponentProps<typeof ContextMenuTrigger>,
  "children" | "enabledOnMobile" | "highlightStyle"
>;

export function SidebarWorkspaceContextMenu({
  children,
  contextMenuOpen,
  onContextMenuOpenChange,
  workspace,
  leadingProjectName,
  hostBadgeLabel,
  serviceSummary,
  workspaceKey,
  onRename,
  onMarkAsRead,
  onAddProject,
  onArchive,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  archiveShortcutKeys,
  isPinned,
  onTogglePin,
  accessibilityLabel,
  highlightStyle,
  ...triggerProps
}: PropsWithChildren<
  SidebarWorkspaceMenuItemsProps &
    ContextTriggerProps & {
      contextMenuOpen: boolean;
      onContextMenuOpenChange: (open: boolean) => void;
      workspace: SidebarWorkspaceEntry;
      leadingProjectName?: string | null;
      hostBadgeLabel?: string | null;
      serviceSummary?: WorkspaceServiceSummary | null;
      highlightStyle: ComponentProps<typeof ContextMenuTrigger>["highlightStyle"];
    }
>) {
  const {
    settings: { workspaceTitleSource },
  } = useAppSettings();
  const { t } = useTranslation();
  const projectActions = useWorkspaceProjectMenuActions(workspace, Boolean(leadingProjectName));
  const pullRequestLabel = workspace.prHint
    ? t("workspace.git.pr.accessibility.pullRequest", {
        number: workspace.prHint.number,
        context: getForgePresentation(normalizeForge(workspace.prHint.forge)).changeRequestContext,
      })
    : null;
  const rowAccessibilityLabel = resolveSidebarWorkspaceAccessibilityLabel({
    workspace,
    workspaceTitleSource,
    leadingProjectName,
    hostBadgeLabel,
    pullRequestLabel,
    serviceLabel: serviceSummary
      ? t(workspaceServiceLabelKey(serviceSummary), { name: serviceSummary.name })
      : null,
  });
  const workspaceTarget = useMemo<WorkspaceLabelTarget>(
    () => ({
      kind: "workspace",
      serverId: workspace.serverId,
      workspaceId: workspace.workspaceId,
      labels: workspace.labels ?? [],
    }),
    [workspace],
  );
  const pages = useWorkspaceLabelMenuPages(workspaceTarget);

  return (
    <ContextMenu open={contextMenuOpen} onOpenChange={onContextMenuOpenChange}>
      <ContextMenuTrigger
        {...triggerProps}
        enabledOnMobile={false}
        accessibilityLabel={accessibilityLabel ?? rowAccessibilityLabel}
        highlightStyle={highlightStyle}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        align="start"
        width={260}
        testID={`sidebar-workspace-context-menu-${workspaceKey}`}
        pages={pages}
      >
        <SidebarWorkspaceMenuItems
          surface="context"
          workspaceKey={workspaceKey}
          serverId={workspace.serverId}
          workspaceId={workspace.workspaceId}
          workspaceLabels={workspace.labels}
          onCopyPath={projectActions.onCopyPath}
          openInFileManagerPath={projectActions.openInFileManagerPath}
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
      </ContextMenuContent>
    </ContextMenu>
  );
}

function triggerStyle({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.trigger, hovered && styles.triggerHovered];
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    padding: 2,
    borderRadius: 4,
    marginLeft: 2,
    // MoreVertical paints only around the center of its SVG. Keep the padded hit box, but
    // pull the painted dots through that unused view-box space onto the trailing-content rail.
    marginRight: -7,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
}));
