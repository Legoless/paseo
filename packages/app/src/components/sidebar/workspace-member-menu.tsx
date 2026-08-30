import { useTranslation } from "react-i18next";
import React from "react";
import { Archive, Copy, ExternalLink, GitBranch, MoreVertical, Trash2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import type { SidebarWorkspaceMemberRow } from "@/projects/workspace-groups";
import type { SidebarWorkspaceAgentRow } from "@/projects/workspace-groups";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ContextMenuSeparator } from "@/components/ui/context-menu";
import { WorkspaceMenuItem } from "@/components/sidebar/workspace-menu-item";
import { OpenInFileManagerMenuItem } from "@/workspace/open-in-file-manager/menu-item";

const ThemedMoreVertical = withUnistyles(MoreVertical);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedCopy = withUnistyles(Copy);
const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedExternalLink = withUnistyles(ExternalLink);
const ThemedArchive = withUnistyles(Archive);

const foregroundColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const styles = StyleSheet.create(() => ({
  kebabButton: {
    padding: 4,
    borderRadius: 4,
  },
  kebabButtonHovered: {
    backgroundColor: "rgba(128, 128, 128, 0.15)",
  },
}));

const trash2LeadingIcon = <ThemedTrash2 size={14} uniProps={foregroundMutedColorMapping} />;
const copyLeadingIcon = <ThemedCopy size={14} uniProps={foregroundMutedColorMapping} />;
const branchLeadingIcon = <ThemedGitBranch size={14} uniProps={foregroundMutedColorMapping} />;
const openLeadingIcon = <ThemedExternalLink size={14} uniProps={foregroundMutedColorMapping} />;
const archiveLeadingIcon = <ThemedArchive size={14} uniProps={foregroundMutedColorMapping} />;

function kebabStyle({ hovered = false }: { hovered?: boolean }) {
  return [styles.kebabButton, hovered && styles.kebabButtonHovered];
}

function renderKebabTriggerIcon({ hovered }: { hovered?: boolean }) {
  return (
    <ThemedMoreVertical
      size={14}
      uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
    />
  );
}

export interface WorkspaceMemberMenuItemsProps {
  member: SidebarWorkspaceMemberRow;
  serverId: string;
  surface: "context" | "dropdown";
  canRemove: boolean;
  onCopyPath: () => void;
  onCopyBranchName: () => void;
  onRemove: () => void;
}

export function WorkspaceMemberMenuItems({
  member,
  serverId,
  surface,
  canRemove,
  onCopyPath,
  onCopyBranchName,
  onRemove,
}: WorkspaceMemberMenuItemsProps) {
  const { t } = useTranslation();
  const Separator = surface === "context" ? ContextMenuSeparator : DropdownMenuSeparator;
  return (
    <>
      <WorkspaceMenuItem
        surface={surface}
        testID={`sidebar-member-menu-copy-path-${member.memberKey}`}
        leading={copyLeadingIcon}
        onSelect={onCopyPath}
      >
        {t("sidebar.workspace.actions.copyPath")}
      </WorkspaceMenuItem>
      {member.branch ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-member-menu-copy-branch-${member.memberKey}`}
          leading={branchLeadingIcon}
          onSelect={onCopyBranchName}
        >
          {t("sidebar.workspace.actions.copyBranchName")}
        </WorkspaceMenuItem>
      ) : null}
      <OpenInFileManagerMenuItem
        serverId={serverId}
        path={member.workspaceDirectory}
        testID={`sidebar-member-menu-open-folder-${member.memberKey}`}
        surface={surface}
      />
      {canRemove ? (
        <>
          <Separator />
          <WorkspaceMenuItem
            surface={surface}
            testID={`sidebar-member-menu-remove-${member.memberKey}`}
            leading={trash2LeadingIcon}
            onSelect={onRemove}
          >
            {t("sidebar.project.actions.removeFromWorkspace")}
          </WorkspaceMenuItem>
        </>
      ) : null}
    </>
  );
}

export function WorkspaceMemberKebabMenu({
  member,
  serverId,
  onFocus,
  onBlur,
  canRemove,
  onCopyPath,
  onCopyBranchName,
  onRemove,
}: Omit<WorkspaceMemberMenuItemsProps, "surface"> & {
  onFocus: () => void;
  onBlur: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu compactMode="sheet">
      <DropdownMenuTrigger
        hitSlop={8}
        style={kebabStyle}
        accessibilityRole="button"
        accessibilityLabel={t("sidebar.project.actions.menu")}
        onFocus={onFocus}
        onBlur={onBlur}
        testID={`sidebar-member-kebab-${member.memberKey}`}
      >
        {renderKebabTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={220} sheetTitle={t("sidebar.project.actions.menu")}>
        <WorkspaceMemberMenuItems
          member={member}
          serverId={serverId}
          surface="dropdown"
          canRemove={canRemove}
          onCopyPath={onCopyPath}
          onCopyBranchName={onCopyBranchName}
          onRemove={onRemove}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface WorkspaceAgentMenuItemsProps {
  agent: SidebarWorkspaceAgentRow;
  serverId: string;
  branch: string | null;
  surface: "context" | "dropdown";
  onOpen: () => void;
  onCopyPath: () => void;
  onCopyBranchName: () => void;
  onArchive: () => void;
}

export function WorkspaceAgentMenuItems({
  agent,
  serverId,
  branch,
  surface,
  onOpen,
  onCopyPath,
  onCopyBranchName,
  onArchive,
}: WorkspaceAgentMenuItemsProps) {
  const { t } = useTranslation();
  const Separator = surface === "context" ? ContextMenuSeparator : DropdownMenuSeparator;
  return (
    <>
      <WorkspaceMenuItem
        surface={surface}
        testID={`sidebar-agent-menu-open-${agent.agentId}`}
        leading={openLeadingIcon}
        onSelect={onOpen}
      >
        {t("sidebar.agent.actions.open")}
      </WorkspaceMenuItem>
      <WorkspaceMenuItem
        surface={surface}
        testID={`sidebar-agent-menu-copy-path-${agent.agentId}`}
        leading={copyLeadingIcon}
        onSelect={onCopyPath}
      >
        {t("sidebar.workspace.actions.copyPath")}
      </WorkspaceMenuItem>
      {branch ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-agent-menu-copy-branch-${agent.agentId}`}
          leading={branchLeadingIcon}
          onSelect={onCopyBranchName}
        >
          {t("sidebar.workspace.actions.copyBranchName")}
        </WorkspaceMenuItem>
      ) : null}
      <OpenInFileManagerMenuItem
        serverId={serverId}
        path={agent.cwd}
        testID={`sidebar-agent-menu-open-folder-${agent.agentId}`}
        surface={surface}
      />
      <Separator />
      <WorkspaceMenuItem
        surface={surface}
        testID={`sidebar-agent-menu-archive-${agent.agentId}`}
        leading={archiveLeadingIcon}
        onSelect={onArchive}
      >
        {t("sidebar.agent.actions.archive")}
      </WorkspaceMenuItem>
    </>
  );
}

export function WorkspaceAgentKebabMenu({
  open,
  onOpenChange,
  onFocus,
  onBlur,
  ...items
}: Omit<WorkspaceAgentMenuItemsProps, "surface"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu compactMode="sheet" open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        hitSlop={8}
        style={kebabStyle}
        accessibilityRole="button"
        accessibilityLabel={t("sidebar.agent.actions.menu")}
        onFocus={onFocus}
        onBlur={onBlur}
        testID={`sidebar-agent-kebab-${items.agent.agentId}`}
      >
        {renderKebabTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        width={220}
        sheetTitle={t("sidebar.agent.actions.menu")}
        testID={`sidebar-agent-dropdown-${items.agent.agentId}`}
      >
        <WorkspaceAgentMenuItems {...items} surface="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
