import { useCallback, useMemo, useRef } from "react";
import { Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { GitBranch, FolderGit2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Combobox, ComboboxItem, type ComboboxProps } from "@/components/ui/combobox";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { useBranchSwitcher } from "@/hooks/use-branch-switcher";
import { buildBranchWorktreeOptions } from "@/utils/branch-suggestions";
import { canSwitchTabProject } from "@/workspace-tabs/switch-tab-project";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import type { Theme } from "@/styles/theme";

const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedFolderGit2 = withUnistyles(FolderGit2);
const accentIconMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const branchOptionIcon = <ThemedGitBranch size={14} uniProps={mutedIconMapping} />;
const worktreeOptionIcon = <ThemedFolderGit2 size={14} uniProps={mutedIconMapping} />;

/** The active pane's directory owns both the branch operation and worktree choice. */
export function PaneBranchBadge({
  serverId,
  workspaceId,
  cwd,
  activeTab,
  onSwitchProject,
}: {
  serverId: string;
  workspaceId: string;
  cwd: string;
  activeTab: WorkspaceTabDescriptor | null;
  onSwitchProject: (input: { tabId: string; cwd: string; projectId?: string }) => void;
}) {
  const { t } = useTranslation();
  const { status } = useCheckoutStatusQuery({ serverId, cwd });
  const branch = status?.isGit ? status.currentBranch : null;
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const toast = useToast();
  const queryClient = useQueryClient();
  const anchorRef = useRef<View | null>(null);
  const workspaces = useSessionStore((state) => state.sessions[serverId]?.workspaces);
  const members = useMemo(
    () => [...(workspaces?.values() ?? [])].flatMap((workspace) => workspace.members),
    [workspaces],
  );
  const root = status?.isGit ? (status.mainRepoRoot ?? status.repoRoot) : null;
  const project = useMemo(
    () =>
      members.find((member) => member.workspaceDirectory === cwd) ??
      members.find((member) => member.projectRootPath === root) ??
      null,
    [cwd, members, root],
  );
  // COMPAT(checkoutWorktreeList): added in v0.9.2, remove gate after 2027-04-08.
  const supportsWorktreeList = useHostFeature(serverId, "checkoutWorktreeList");
  const canSwitchWorktree = activeTab !== null && canSwitchTabProject(activeTab.target);
  const canSelectWorktree = canSwitchWorktree && supportsWorktreeList;
  const {
    branchOptions,
    isOpen,
    setIsOpen,
    handleBranchSelect,
    branchError,
    isLoadingBranches,
    refetchBranches,
  } = useBranchSwitcher({
    client,
    normalizedServerId: serverId,
    normalizedWorkspaceId: workspaceId,
    workspaceDirectory: cwd,
    currentBranchName: branch,
    isGitCheckout: status?.isGit === true,
    isConnected,
    toast,
    queryClient,
  });
  const worktreeQuery = useFetchQuery({
    queryKey: ["paneWorktrees", serverId, cwd],
    queryFn: async () => {
      if (!client) throw new Error(t("common.errors.daemonClientUnavailable"));
      const payload = await client.getPaseoWorktreeList({ cwd, includeExternal: true });
      if (payload.error) throw new Error(payload.error.message);
      return payload.worktrees;
    },
    enabled: isOpen && canSelectWorktree && status?.isGit === true && isConnected && !!client,
    retry: false,
    staleTimeMs: 15_000,
    dataShape: "list",
  });
  const worktrees = worktreeQuery.isPlaceholderData ? undefined : worktreeQuery.data;
  const options = useMemo(
    () =>
      buildBranchWorktreeOptions({
        branches: branchOptions,
        cwd,
        projectId: project?.projectId ?? null,
        projectRootPath: project?.projectRootPath ?? root,
        worktrees: canSelectWorktree ? (worktrees ?? []) : [],
        members: canSelectWorktree ? members : [],
      }),
    [branchOptions, canSelectWorktree, cwd, members, project, root, worktrees],
  );
  const handleSelect = useCallback(
    (id: string) => {
      if (id.startsWith("worktree:") && activeTab && canSelectWorktree) {
        onSwitchProject({
          tabId: activeTab.tabId,
          cwd: id.slice("worktree:".length),
          ...(project ? { projectId: project.projectId } : {}),
        });
      } else if (id.startsWith("branch:")) {
        handleBranchSelect(id.slice("branch:".length));
      }
    },
    [activeTab, canSelectWorktree, handleBranchSelect, onSwitchProject, project],
  );
  const openPicker = useCallback(() => setIsOpen(true), [setIsOpen]);
  const { refetch: refetchWorktrees } = worktreeQuery;
  const retry = useCallback(() => {
    refetchBranches();
    if (canSelectWorktree) void refetchWorktrees();
  }, [canSelectWorktree, refetchBranches, refetchWorktrees]);
  const renderOption = useCallback<NonNullable<ComboboxProps["renderOption"]>>(
    ({ option, selected, active, onPress }) => {
      return (
        <ComboboxItem
          label={option.label}
          description={option.description}
          selected={selected}
          active={active}
          onPress={onPress}
          leadingSlot={option.kind === "directory" ? worktreeOptionIcon : branchOptionIcon}
          testID={`pane-branch-option-${option.id}`}
        />
      );
    },
    [],
  );
  const error = branchError ?? worktreeQuery.error;
  const footer = useMemo(() => {
    if (error) {
      return (
        <Alert variant="error" description={error.message} testID="pane-branch-picker-error">
          <Button variant="outline" size="sm" onPress={retry}>
            {t("common.actions.retry")}
          </Button>
        </Alert>
      );
    }
    if (canSwitchWorktree && !supportsWorktreeList) {
      return <Text style={styles.pickerHint}>{t("branchSwitcher.updateHostForWorktrees")}</Text>;
    }
    return null;
  }, [canSwitchWorktree, error, retry, supportsWorktreeList, t]);

  if (!branch || branch === "HEAD") return null;
  return (
    <>
      <ComboboxTrigger
        ref={anchorRef}
        onPress={openPicker}
        style={styles.badge}
        chevron={null}
        disabled={!isConnected}
        testID="pane-branch-badge"
        accessibilityRole="button"
        accessibilityLabel={t("branchSwitcher.currentBranch", { branchName: branch })}
      >
        <ThemedGitBranch size={12} uniProps={accentIconMapping} />
        <Text numberOfLines={1} ellipsizeMode="tail" style={styles.badgeText}>
          {branch}
        </Text>
      </ComboboxTrigger>
      <Combobox
        options={options}
        value={`branch:${branch}`}
        onSelect={handleSelect}
        searchable
        searchPlaceholder={t("branchSwitcher.branchOrWorktreeSearchPlaceholder")}
        emptyText={t(
          isLoadingBranches || worktreeQuery.isFetching ? "common.loading" : "branchSwitcher.empty",
        )}
        title={t("branchSwitcher.branchOrWorktreeTitle")}
        open={isOpen}
        onOpenChange={setIsOpen}
        anchorRef={anchorRef}
        desktopPlacement="bottom-start"
        desktopPreventInitialFlash
        desktopMinWidth={280}
        renderOption={renderOption}
        footer={footer}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  pickerHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[2],
  },
  badge: {
    minWidth: 0,
    maxWidth: "70%",
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
  badgeText: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.accentForeground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
}));
