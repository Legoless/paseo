import { useCallback, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { CircleSlash, Folder, FolderGit2, FolderPlus } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { buildWorkspaceProjectPickerOptions } from "@/components/workspace-project-picker";
import { useHostHomeDirectory } from "@/workspace-tabs/launcher/project-selector";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { matchWorkspaceProject } from "@/projects/match-workspace-project";
import { canSwitchTabProject } from "@/workspace-tabs/switch-tab-project";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedProjectFolder = withUnistyles(FolderGit2);
/** A plain folder for "no project"; the git folder means one of the workspace's projects. */
const ThemedPlainFolder = withUnistyles(Folder);
const ThemedFolderPlus = withUnistyles(FolderPlus);
const ThemedCircleSlash = withUnistyles(CircleSlash);

const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const addProjectIcon = <ThemedFolderPlus size={ICON_SIZE.sm} uniProps={mutedIconMapping} />;
const leaveProjectIcon = <ThemedCircleSlash size={ICON_SIZE.sm} uniProps={mutedIconMapping} />;

interface PaneProjectBadgeProps {
  serverId: string;
  workspaceId: string;
  cwd: string;
  activeTab: WorkspaceTabDescriptor | null;
  /** Re-points the tab at another project. Owns the confirmation and the relaunch. */
  onSwitchProject: (input: { tabId: string; cwd: string }) => void;
}

/**
 * The project this pane is pointed at, sitting left of the branch pill. A tab that owns its working
 * directory gets a picker; every other tab is already running somewhere it cannot move, so the badge
 * is a plain label — and an Uncategorized one has no project to name, so it gets no badge at all.
 *
 * The list is a Combobox rather than a menu because it is searchable and unbounded: `docs/design.md`
 * puts a small fixed set in a DropdownMenu and anything you type to find in a Combobox.
 */
export function PaneProjectBadge({
  serverId,
  workspaceId,
  cwd,
  activeTab,
  onSwitchProject,
}: PaneProjectBadgeProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const anchorRef = useRef<View | null>(null);
  const members = useWorkspaceFields(serverId, workspaceId, (workspace) => workspace.members);
  const openAddProject = useOpenAddProject();
  const homeDirectory = useHostHomeDirectory(serverId);
  const projects = useMemo(() => buildWorkspaceProjectPickerOptions(members ?? []), [members]);
  const matched = useMemo(() => matchWorkspaceProject(projects, cwd), [cwd, projects]);
  const switchable = activeTab !== null && canSwitchTabProject(activeTab.target);

  // The cwd is the option id: it is what the switch needs, and it is already unique per member.
  const options = useMemo<ComboboxOption[]>(
    () =>
      projects.map((project) => ({
        id: project.cwd,
        label: project.label,
        description: project.path,
        kind: "directory" as const,
      })),
    [projects],
  );

  const handleSelect = useCallback(
    (nextCwd: string) => {
      if (!activeTab) {
        return;
      }
      onSwitchProject({ tabId: activeTab.tabId, cwd: nextCwd });
    },
    [activeTab, onSwitchProject],
  );
  const openPicker = useCallback(() => setIsOpen(true), []);
  const handleAddProject = useCallback(() => {
    setIsOpen(false);
    openAddProject(serverId, { targetWorkspace: { serverId, workspaceId } });
  }, [openAddProject, serverId, workspaceId]);
  // "No project" is the daemon user's home directory: a tab belongs to no project until one is
  // picked, and going back there is leaving the project rather than choosing another.
  const handleLeaveProject = useCallback(() => {
    setIsOpen(false);
    if (homeDirectory) {
      handleSelect(homeDirectory);
    }
  }, [handleSelect, homeDirectory]);

  const footer = useMemo(
    () => (
      <>
        <ComboboxItem
          label={t("sidebar.actions.addProject")}
          leadingSlot={addProjectIcon}
          onPress={handleAddProject}
          testID="pane-project-badge-add-project"
        />
        {homeDirectory ? (
          <ComboboxItem
            label={t("workspace.tabs.projectSelector.leaveProject")}
            leadingSlot={leaveProjectIcon}
            selected={!matched}
            onPress={handleLeaveProject}
            testID="pane-project-badge-leave-project"
          />
        ) : null}
      </>
    ),
    [handleAddProject, handleLeaveProject, homeDirectory, matched, t],
  );

  // A tab the workspace files as Uncategorized runs somewhere that is nobody's project — home,
  // most often. There is no project to name, so a tab that cannot move shows nothing. One that can
  // keeps its badge either way: there the badge assigns the project rather than reporting it.
  if (!matched && !switchable) {
    return null;
  }

  const label = matched?.label ?? t("workspace.tabs.projectSelector.noProject");
  const FolderIcon = matched ? ThemedProjectFolder : ThemedPlainFolder;
  const content = (
    <>
      <FolderIcon size={12} uniProps={mutedIconMapping} />
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        style={styles.badgeText}
        testID="pane-project-badge-label"
      >
        {label}
      </Text>
    </>
  );

  if (!switchable) {
    return (
      <View pointerEvents="none" style={styles.badge} testID="pane-project-badge">
        {content}
      </View>
    );
  }

  return (
    <>
      <ComboboxTrigger
        ref={anchorRef}
        onPress={openPicker}
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={t("workspace.tabs.projectPicker.selectProject")}
        testID="pane-project-badge"
      >
        {content}
      </ComboboxTrigger>
      <Combobox
        options={options}
        value={matched?.cwd ?? ""}
        onSelect={handleSelect}
        searchable
        searchPlaceholder={t("workspace.tabs.projectSelector.searchPlaceholder")}
        title={t("workspace.tabs.projectSelector.label")}
        emptyText={t("workspace.tabs.projectSelector.empty")}
        open={isOpen}
        onOpenChange={setIsOpen}
        anchorRef={anchorRef}
        desktopPlacement="bottom-start"
        desktopMinWidth={280}
        footer={footer}
      />
    </>
  );
}

function triggerStyle({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) {
  return [styles.badge, (hovered === true || pressed) && styles.badgeActive];
}

const styles = StyleSheet.create((theme) => ({
  badge: {
    minWidth: 0,
    maxWidth: "45%",
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
  },
  badgeActive: {
    backgroundColor: theme.colors.surface3,
  },
  badgeText: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
}));
