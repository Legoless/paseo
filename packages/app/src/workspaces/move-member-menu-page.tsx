import { default as React, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FolderInput } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { MenuHint, MenuItem, type MenuPageDefinition } from "@/components/ui/menu";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useMoveWorkspaceMember } from "@/workspaces/use-move-workspace-member";
import type { Theme } from "@/styles/theme";

/** The `MenuSubTrigger` on a member's menu that opens the move-target page. */
export const MOVE_MEMBER_PAGE_ID = "moveWorkspaceMember";

/** Matches the leading column every other member-menu row sits in. */
const MENU_ICON_SIZE = 14;

const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedFolderInput = withUnistyles(FolderInput);
export const MOVE_MEMBER_ICON = <ThemedFolderInput size={MENU_ICON_SIZE} uniProps={mutedMapping} />;

const NO_PAGES: readonly MenuPageDefinition[] = [];

export interface MoveMemberMenuTarget {
  serverId: string;
  /** The workspace the membership leaves. */
  sourceWorkspaceId: string;
  cwd: string;
  projectName: string;
}

/** The page behind a member's `Move to workspace` row, for whichever menu is asking. */
export function useMoveMemberMenuPages(
  target: MoveMemberMenuTarget | null,
): readonly MenuPageDefinition[] {
  const { t } = useTranslation();
  return useMemo(() => {
    if (!target) return NO_PAGES;
    return [
      {
        id: MOVE_MEMBER_PAGE_ID,
        title: t("sidebar.project.actions.moveToWorkspace"),
        content: <MoveMemberPage target={target} />,
      },
    ];
  }, [t, target]);
}

function MoveMemberPage({ target }: { target: MoveMemberMenuTarget }): React.ReactElement {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(target.serverId);
  const moveMember = useMoveWorkspaceMember();
  const workspaces = useSessionStore(
    (state) => state.sessions[target.serverId]?.workspaces ?? null,
  );
  const candidates = useMemo(() => {
    if (!workspaces) return [];
    return [...workspaces.values()]
      .filter((workspace) => workspace.id !== target.sourceWorkspaceId)
      .map((workspace) => ({
        id: workspace.id,
        title: workspace.title?.trim() || workspace.name,
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [workspaces, target.sourceWorkspaceId]);

  const handleSelect = useCallback(
    (workspaceId: string) => {
      const workspace = candidates.find((candidate) => candidate.id === workspaceId);
      if (!workspace) {
        return;
      }
      void moveMember({
        client,
        sourceWorkspaceId: target.sourceWorkspaceId,
        targetWorkspaceId: workspace.id,
        cwd: target.cwd,
        projectName: target.projectName,
        targetTitle: workspace.title,
      });
    },
    [candidates, client, moveMember, target],
  );

  return (
    <>
      {candidates.map((workspace) => (
        <MoveMemberRow
          key={workspace.id}
          testID={`sidebar-member-menu-move-${workspace.id}`}
          title={workspace.title}
          workspaceId={workspace.id}
          onSelect={handleSelect}
        />
      ))}
      {candidates.length === 0 ? (
        <MenuHint>{t("sidebar.project.actions.noOtherWorkspaces")}</MenuHint>
      ) : null}
    </>
  );
}

function MoveMemberRow({
  testID,
  title,
  workspaceId,
  onSelect,
}: {
  testID: string;
  title: string;
  workspaceId: string;
  onSelect: (workspaceId: string) => void;
}): React.ReactElement {
  const handleSelect = useCallback(() => onSelect(workspaceId), [onSelect, workspaceId]);
  // No `selected` check: moving is an action, and there is no "current workspace" to tick.
  return (
    <MenuItem testID={testID} onSelect={handleSelect}>
      {title}
    </MenuItem>
  );
}
