import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Folder, FolderGit2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  buildWorkspaceProjectPickerOptions,
  WorkspaceProjectMenuItems,
} from "@/components/workspace-project-picker";
import type { WorkspaceProjectPickerOption } from "@/components/workspace-project-picker";
import { useHostHomeDirectory } from "@/workspace-tabs/launcher/project-selector";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";
import { shortenPath } from "@/utils/shorten-path";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import type { Theme } from "@/styles/theme";

const ThemedProjectFolder = withUnistyles(FolderGit2);
/** A plain folder for "no project"; the git folder means one of the workspace's projects. */
const ThemedPlainFolder = withUnistyles(Folder);

const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface PaneProjectBadgeProps {
  serverId: string;
  workspaceId: string;
  workspaceKey: string;
  cwd: string;
  activeTab: WorkspaceTabDescriptor | null;
}

interface BadgeTriggerState {
  hovered: boolean;
  pressed: boolean;
  open: boolean;
}

type DraftTarget = Extract<WorkspaceTabDescriptor["target"], { kind: "draft" }>;

/**
 * The workspace project a directory belongs to, or null when it belongs to none. Matching is the
 * sidebar's rule from `projects/workspace-groups.ts` — a normalized directory equal to a member's,
 * nothing looser — so a pane and its sidebar row agree on what counts as Uncategorized.
 */
export function matchWorkspaceProject(
  options: readonly WorkspaceProjectPickerOption[],
  cwd: string,
): WorkspaceProjectPickerOption | null {
  const normalized = normalizeWorkspacePath(cwd);
  if (!normalized) {
    return null;
  }
  return options.find((option) => normalizeWorkspacePath(option.cwd) === normalized) ?? null;
}

/**
 * Both cwd fields move together: `setup.cwd` wins once a provider is pinned, and the bare `cwd`
 * carries the pick until one is. Leaving either behind strands the draft on a stale directory.
 */
export function repointDraftTarget(target: DraftTarget, cwd: string): DraftTarget {
  return {
    ...target,
    cwd,
    ...(target.setup ? { setup: { ...target.setup, cwd } } : {}),
  };
}

/**
 * The project this pane is pointed at, sitting left of the branch pill. A draft owns its working
 * directory, so there the badge is a picker that re-points it. Every other tab is already running
 * somewhere it cannot move, so the badge is a plain label — and an Uncategorized one has no project
 * to name, so it gets no badge at all.
 */
export function PaneProjectBadge({
  serverId,
  workspaceId,
  workspaceKey,
  cwd,
  activeTab,
}: PaneProjectBadgeProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const members = useWorkspaceFields(serverId, workspaceId, (workspace) => workspace.members);
  const openAddProject = useOpenAddProject();
  const replaceTab = useWorkspaceLayoutStore((state) => state.replaceTab);
  const homeDirectory = useHostHomeDirectory(serverId);
  const options = useMemo(() => buildWorkspaceProjectPickerOptions(members ?? []), [members]);
  const matched = useMemo(() => matchWorkspaceProject(options, cwd), [cwd, options]);
  const draftTarget = activeTab?.target.kind === "draft" ? activeTab.target : null;

  const handleSelect = useCallback(
    (nextCwd: string) => {
      if (!activeTab || !draftTarget) {
        return;
      }
      replaceTab(workspaceKey, activeTab.tabId, repointDraftTarget(draftTarget, nextCwd));
    },
    [activeTab, draftTarget, replaceTab, workspaceKey],
  );
  const handleSelectHome = useCallback(() => {
    if (homeDirectory) {
      handleSelect(homeDirectory);
    }
  }, [handleSelect, homeDirectory]);
  const handleBrowse = useCallback(() => {
    openAddProject(serverId, { targetWorkspace: { serverId, workspaceId } });
  }, [openAddProject, serverId, workspaceId]);
  const triggerStyle = useCallback(
    ({ hovered, pressed, open }: BadgeTriggerState) => [
      styles.badge,
      (hovered || pressed || open) && styles.badgeActive,
    ],
    [],
  );

  // An agent or terminal the workspace files as Uncategorized runs somewhere that is nobody's
  // project — home, most often. There is no project to name, so the pane shows none. A draft keeps
  // its badge either way: there it is the control that assigns one.
  if (!matched && !draftTarget) {
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

  if (!draftTarget) {
    return (
      <View pointerEvents="none" style={styles.badge} testID="pane-project-badge">
        {content}
      </View>
    );
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel={t("workspace.tabs.projectPicker.selectProject")}
        style={triggerStyle}
        testID="pane-project-badge"
      >
        {content}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" minWidth={240} testID="pane-project-badge-content">
        {homeDirectory ? (
          <DropdownMenuItem
            selected={!matched}
            showSelectedCheck
            description={shortenPath(homeDirectory)}
            onSelect={handleSelectHome}
            testID="pane-project-badge-home"
          >
            {t("workspace.tabs.projectSelector.noProject")}
          </DropdownMenuItem>
        ) : null}
        {homeDirectory && options.length > 0 ? <DropdownMenuSeparator /> : null}
        <WorkspaceProjectMenuItems
          options={options}
          selectedCwd={matched?.cwd ?? null}
          onSelect={handleSelect}
          testIDPrefix="pane-project-badge"
        />
        {options.length > 0 ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem onSelect={handleBrowse} testID="pane-project-badge-browse">
          {t("projectPicker.browse")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
