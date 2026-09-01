import React, { useCallback, useMemo } from "react";
import { View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ellipsis, Globe, Import as ImportIcon, Settings, SquarePen } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { TerminalProfile } from "@getpaseo/protocol/messages";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  extraMutedIconColorMapping,
  iconButtonChromeGlyphSize,
  iconButtonChromeStyle,
} from "@/components/ui/icon-button-chrome";
import { TerminalProfileIcon } from "@/components/terminal-profile-icon";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import {
  getTerminalProfileIcon,
  resolveTerminalProfiles,
} from "@getpaseo/protocol/terminal-profiles";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { SidebarWorkspaceMenuItems } from "@/components/sidebar/sidebar-workspace-menu";
import { useWorkspaceLabelMenuPages, type WorkspaceLabelTarget } from "@/workspace-labels/picker";
import type { Theme } from "@/styles/theme";

const ThemedEllipsis = withUnistyles(Ellipsis);
const ThemedSquarePen = withUnistyles(SquarePen);
const ThemedGlobe = withUnistyles(Globe);
const ThemedImport = withUnistyles(ImportIcon);
const ThemedSettings = withUnistyles(Settings);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const MENU_NEW_AGENT_ICON = <ThemedSquarePen size={16} uniProps={mutedColorMapping} />;
const MENU_NEW_BROWSER_ICON = <ThemedGlobe size={16} uniProps={mutedColorMapping} />;
const MENU_NEW_TERMINAL_ICON = <TerminalProfileIcon iconKey={undefined} size={16} />;
const MENU_IMPORT_ICON = <ThemedImport size={16} uniProps={mutedColorMapping} />;
const MENU_SETTINGS_ICON = <ThemedSettings size={16} uniProps={mutedColorMapping} />;
function WorkspaceHeaderMenuTriggerIcon() {
  return (
    <ThemedEllipsis
      size={iconButtonChromeGlyphSize("large")}
      uniProps={extraMutedIconColorMapping}
    />
  );
}

/**
 * The compact header buttons draw at 32pt, under the 44pt touch minimum, and sit flush against
 * each other — so the slop can only grow vertically. Widening it would put two buttons' slop over
 * the same pixels, which is a worse miss than a small target.
 */
const COMPACT_HEADER_BUTTON_HIT_SLOP = { top: 8, bottom: 8 } as const;

/**
 * Actions that belong to the workspace itself rather than to a tab. Both header menus render them,
 * from the same callbacks, so the two surfaces can't drift.
 */
export interface WorkspaceHeaderWorkspaceActions {
  serverId: string;
  workspaceId: string;
  workspaceKey: string;
  workspaceLabels: readonly string[];
  showWorkspaceSetup: boolean;
  importAgentDisabled: boolean;
  onOpenImportSheet: () => void;
  onRename: () => void;
  onAddProject?: () => void;
  onArchive: () => void;
  archiveLabel?: string;
  archiveStatus?: "idle" | "pending" | "success";
  archivePendingLabel?: string;
  onOpenSetupTab: () => void;
}

/**
 * The workspace-level entries are the sidebar kebab's, rendered from the same component so the two
 * surfaces cannot drift. Copy path, copy branch name and open in file manager are deliberately
 * absent: a workspace spans several project directories, each on its own branch, so none of the
 * three has a single answer at this level. They belong on a project row.
 */
function WorkspaceHeaderWorkspaceActionItems({
  serverId,
  workspaceId,
  workspaceKey,
  workspaceLabels,
  showWorkspaceSetup,
  importAgentDisabled,
  onOpenImportSheet,
  onRename,
  onAddProject,
  onArchive,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  onOpenSetupTab,
}: WorkspaceHeaderWorkspaceActions) {
  const { t } = useTranslation();
  return (
    <>
      <SidebarWorkspaceMenuItems
        surface="dropdown"
        workspaceKey={workspaceKey}
        serverId={serverId}
        workspaceId={workspaceId}
        workspaceLabels={workspaceLabels}
        onRename={onRename}
        onAddProject={onAddProject}
        onArchive={onArchive}
        archiveLabel={archiveLabel}
        archiveStatus={archiveStatus}
        archivePendingLabel={archivePendingLabel}
      />
      <DropdownMenuSeparator />
      <DropdownMenuItem
        testID="workspace-header-import-agent"
        leading={MENU_IMPORT_ICON}
        disabled={importAgentDisabled}
        onSelect={onOpenImportSheet}
      >
        {t("workspace.header.actions.importSession")}
      </DropdownMenuItem>
      {showWorkspaceSetup ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            testID="workspace-header-show-setup"
            leading={MENU_SETTINGS_ICON}
            onSelect={onOpenSetupTab}
          >
            {t("workspace.header.actions.showSetup")}
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}

/** Registers the label picker's submenu pages so the shared items' label trigger has a page to open. */
function useWorkspaceHeaderLabelPages({
  serverId,
  workspaceId,
  workspaceLabels,
}: Pick<WorkspaceHeaderWorkspaceActions, "serverId" | "workspaceId" | "workspaceLabels">) {
  const target = useMemo<WorkspaceLabelTarget | null>(
    () => ({ kind: "workspace", serverId, workspaceId, labels: workspaceLabels }),
    [serverId, workspaceId, workspaceLabels],
  );
  return useWorkspaceLabelMenuPages(target);
}

function workspaceHeaderMenuButtonStyle({
  hovered,
  pressed,
  open,
}: {
  hovered: boolean;
  pressed: boolean;
  open: boolean;
}) {
  return iconButtonChromeStyle({ size: "large", state: { hovered, pressed, open } });
}

/**
 * Wide layouts make tabs from the tab strip's `+` menu, so this one carries workspace actions only.
 */
export function WorkspaceHeaderMenuDesktop(props: WorkspaceHeaderWorkspaceActions) {
  const { t } = useTranslation();
  const pages = useWorkspaceHeaderLabelPages(props);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        testID="workspace-header-menu-trigger"
        style={workspaceHeaderMenuButtonStyle}
        accessibilityRole="button"
        accessibilityLabel={t("workspace.header.actions.workspaceActions")}
      >
        <WorkspaceHeaderMenuTriggerIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" width={220} pages={pages} testID="workspace-header-menu">
        <WorkspaceHeaderWorkspaceActionItems {...props} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface HeaderMenuProfileItemProps {
  profile: TerminalProfile;
  disabled: boolean;
  onCreateTerminalWithProfile: (profile: TerminalProfile) => void;
}

function HeaderMenuProfileItem({
  profile,
  disabled,
  onCreateTerminalWithProfile,
}: HeaderMenuProfileItemProps) {
  const handleSelect = useCallback(() => {
    onCreateTerminalWithProfile(profile);
  }, [onCreateTerminalWithProfile, profile]);

  const leading = useMemo(
    () => (
      <View style={styles.headerMenuProfileIconWrapper}>
        <TerminalProfileIcon iconKey={getTerminalProfileIcon(profile)} size={16} />
      </View>
    ),
    [profile],
  );

  return (
    <DropdownMenuItem leading={leading} disabled={disabled} onSelect={handleSelect}>
      {profile.name}
    </DropdownMenuItem>
  );
}

export interface WorkspaceHeaderMenuMobileProps extends WorkspaceHeaderWorkspaceActions {
  normalizedServerId: string;
  showCreateBrowserTab: boolean;
  createTerminalDisabled: boolean;
  onCreateDraftTab: () => void;
  onCreateTerminal: () => void;
  onCreateTerminalWithProfile: (profile: TerminalProfile) => void;
  onCreateBrowser: () => void;
}

/**
 * Compact layouts have no tab strip to launch from, so new tabs live here alongside the workspace
 * actions.
 */
export function WorkspaceHeaderMenuMobile({
  normalizedServerId,
  showCreateBrowserTab,
  createTerminalDisabled,
  onCreateDraftTab,
  onCreateTerminal,
  onCreateTerminalWithProfile,
  onCreateBrowser,
  ...workspaceActions
}: WorkspaceHeaderMenuMobileProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { config } = useDaemonConfig(normalizedServerId);
  const profiles = useMemo(
    () => resolveTerminalProfiles(config?.terminalProfiles),
    [config?.terminalProfiles],
  );

  const handleEditProfiles = useCallback(() => {
    router.push(buildSettingsHostSectionRoute(normalizedServerId, "terminals") as Href);
  }, [normalizedServerId, router]);
  const pages = useWorkspaceHeaderLabelPages(workspaceActions);

  return (
    <DropdownMenu compactMode="sheet">
      <DropdownMenuTrigger
        testID="workspace-header-menu-trigger"
        style={workspaceHeaderMenuButtonStyle}
        hitSlop={COMPACT_HEADER_BUTTON_HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel={t("workspace.header.actions.workspaceActions")}
      >
        <WorkspaceHeaderMenuTriggerIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        width={220}
        pages={pages}
        testID="workspace-header-menu"
        sheetTitle={t("workspace.header.actions.workspaceActions")}
      >
        <DropdownMenuItem
          testID="workspace-header-new-agent"
          leading={MENU_NEW_AGENT_ICON}
          onSelect={onCreateDraftTab}
        >
          {t("workspace.header.actions.newAgent")}
        </DropdownMenuItem>
        {showCreateBrowserTab ? (
          <DropdownMenuItem
            testID="workspace-header-new-browser"
            leading={MENU_NEW_BROWSER_ICON}
            onSelect={onCreateBrowser}
          >
            {t("workspace.header.actions.newBrowser")}
          </DropdownMenuItem>
        ) : null}
        <WorkspaceHeaderWorkspaceActionItems {...workspaceActions} />
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("workspace.tabs.actions.terminalProfilesMenu")}</DropdownMenuLabel>
        <DropdownMenuItem
          testID="workspace-header-new-terminal"
          leading={MENU_NEW_TERMINAL_ICON}
          disabled={createTerminalDisabled}
          onSelect={onCreateTerminal}
        >
          {t("workspace.header.actions.newTerminal")}
        </DropdownMenuItem>
        {profiles.map((profile) => (
          <HeaderMenuProfileItem
            key={profile.id}
            profile={profile}
            disabled={createTerminalDisabled}
            onCreateTerminalWithProfile={onCreateTerminalWithProfile}
          />
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          testID="workspace-header-edit-terminal-profiles"
          onSelect={handleEditProfiles}
        >
          {t("workspace.tabs.actions.editTerminalProfiles")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create({
  headerMenuProfileIconWrapper: {
    width: 16,
    height: 16,
  },
});
