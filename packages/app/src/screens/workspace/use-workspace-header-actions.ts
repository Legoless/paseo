import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RenamableWorkspace } from "@/components/workspace-rename-modal";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { redirectIfArchivingActiveWorkspace } from "@/utils/sidebar-workspace-archive-redirect";
import { useWorkspaceArchive } from "@/workspace/use-workspace-archive";

const EMPTY_LABELS: readonly string[] = [];

export interface WorkspaceHeaderActions {
  workspaceKey: string;
  workspaceLabels: readonly string[];
  onRename: () => void;
  onAddProject: () => void;
  onArchive: () => void;
  archiveLabel: string;
  archivePendingLabel: string;
  archiveStatus: "idle" | "pending";
  isRenameOpen: boolean;
  onCloseRename: () => void;
  renameTarget: RenamableWorkspace | null;
}

/**
 * The workspace-level actions the header kebab shares with the sidebar row. Lives outside the
 * screen so the descriptor's optional fields are unpacked here rather than adding branches to
 * `WorkspaceScreenContent`.
 */
export function useWorkspaceHeaderActions(input: {
  serverId: string;
  workspaceId: string;
  workspace: WorkspaceDescriptor | null | undefined;
}): WorkspaceHeaderActions {
  const { serverId, workspaceId, workspace } = input;
  const { t } = useTranslation();
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isHiding, setIsHiding] = useState(false);
  const activeWorkspaceSelection = useActiveWorkspaceSelection();

  const onRename = useCallback(() => setIsRenameOpen(true), []);
  const onCloseRename = useCallback(() => setIsRenameOpen(false), []);

  const onArchiveStarted = useCallback(() => {
    redirectIfArchivingActiveWorkspace({ serverId, workspaceId, activeWorkspaceSelection });
  }, [activeWorkspaceSelection, serverId, workspaceId]);

  const archiveController = useWorkspaceArchive({
    serverId,
    workspaceId,
    workspaceKind: workspace?.workspaceKind ?? "local_checkout",
    name: workspace?.name ?? "",
    isDirty: workspace?.gitRuntime?.isDirty ?? null,
    aheadOfOrigin: workspace?.gitRuntime?.aheadOfOrigin ?? null,
    diffStat: workspace?.diffStat ?? null,
    onArchiveStarted,
    onSetHiding: setIsHiding,
  });

  const isArchiving = (workspace?.archivingAt ?? null) !== null || isHiding;
  const onArchive = useCallback(() => {
    if (isArchiving) {
      return;
    }
    archiveController.archive();
  }, [archiveController, isArchiving]);

  const openAddProject = useOpenAddProject();
  const onAddProject = useCallback(() => {
    openAddProject(serverId, { targetWorkspace: { serverId, workspaceId } });
  }, [openAddProject, serverId, workspaceId]);

  const renameTarget = useMemo<RenamableWorkspace | null>(
    () => (workspace ? { serverId, workspaceId, name: workspace.name } : null),
    [serverId, workspace, workspaceId],
  );

  return {
    workspaceKey: `${serverId}:${workspaceId}`,
    workspaceLabels: workspace?.labels ?? EMPTY_LABELS,
    onRename,
    onAddProject,
    onArchive,
    archiveLabel: t("sidebar.workspace.actions.archive"),
    archivePendingLabel: t("sidebar.workspace.actions.archiving"),
    archiveStatus: isArchiving ? "pending" : "idle",
    isRenameOpen,
    onCloseRename,
    renameTarget,
  };
}
