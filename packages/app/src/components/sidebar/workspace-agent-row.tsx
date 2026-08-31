import React, { useCallback, useMemo, useState } from "react";
import { View, Text, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import * as Clipboard from "expo-clipboard";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { CircleAlert, GitBranch } from "lucide-react-native";
import { DiffStat } from "@/components/diff-stat";
import { AgentHoverCard } from "@/components/workspace-hover-card";
import { StatusRing } from "@/components/status-ring";
import { useSidebarRowItems } from "@/components/sidebar/display-preferences/model";
import { useSidebarWorkspaceTrailing } from "@/components/sidebar/workspace-trailing";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { useWorkspaceLabelMenuPages } from "@/workspace-labels/picker";
import { useWorkspaceLabelDefinitions } from "@/workspace-labels";
import type {
  SidebarWorkspaceAgentRow,
  SidebarWorkspaceNewAgentRow,
} from "@/projects/workspace-groups";
import type { PrHint } from "@/git/use-pr-status-query";
import { isWeb as platformIsWeb, isNative as platformIsNative } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import { useToast } from "@/contexts/toast-context";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  WorkspaceAgentKebabMenu,
  WorkspaceAgentMenuItems,
} from "@/components/sidebar/workspace-member-menu";
import type { Theme } from "@/styles/theme";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { getStatusDotColor } from "@/utils/status-dot-color";
import {
  STATUS_INDICATOR_ALERT_SIZE,
  STATUS_INDICATOR_FILLED_DOT_SIZE,
} from "@/utils/status-indicator-geometry";
import {
  workspaceLabelKey,
  type WorkspaceLabelDefinition,
} from "@getpaseo/protocol/workspace-labels";

const ThemedCircleAlert = withUnistyles(CircleAlert);
const ThemedGitBranch = withUnistyles(GitBranch);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const needsInputColorMapping = (theme: Theme) => ({
  color: theme.colors.surface0,
  fill: getStatusDotColor({ theme, bucket: "needs_input" }) ?? undefined,
});

function AgentStatusIndicator({ bucket }: { bucket: SidebarStateBucket }) {
  if (bucket === "running") {
    return (
      <View style={styles.agentStatusSlot} testID="sidebar-agent-status-running">
        <StatusRing />
      </View>
    );
  }
  if (bucket === "needs_input") {
    return (
      <View style={styles.agentStatusSlot} testID="sidebar-agent-status-needs_input">
        <ThemedCircleAlert size={STATUS_INDICATOR_ALERT_SIZE} uniProps={needsInputColorMapping} />
      </View>
    );
  }
  let dotStyle: ViewStyle = styles.agentStatusDotIdle;
  if (bucket === "failed") {
    dotStyle = styles.agentStatusDotFailed;
  } else if (bucket === "attention") {
    dotStyle = styles.agentStatusDotAttention;
  }
  return (
    <View style={styles.agentStatusSlot} testID={`sidebar-agent-status-${bucket}`}>
      <View style={[styles.agentStatusDot, dotStyle]} />
    </View>
  );
}

function useAgentCheckoutPresentation(agent: SidebarWorkspaceAgentRow, serverId: string) {
  const checkout = useCheckoutBranch(agent.cwd, serverId);
  const labelTarget = useMemo(
    () => ({
      kind: "agent" as const,
      serverId,
      agentId: agent.agentId,
      labels: agent.labels,
    }),
    [agent.agentId, agent.labels, serverId],
  );
  return {
    ...checkout,
    labelPages: useWorkspaceLabelMenuPages(labelTarget),
    labelDefinitions: useWorkspaceLabelDefinitions(serverId, agent.labels),
  };
}

function useCheckoutBranch(cwd: string, serverId: string) {
  const { status, isFetching, isError, isConnected, refetch } = useCheckoutStatusQuery({
    serverId,
    cwd,
  });
  const branch =
    status?.isGit && status.currentBranch && status.currentBranch !== "HEAD"
      ? status.currentBranch
      : null;
  return {
    branch,
    branchReady: isConnected && !isFetching && !isError,
    refreshBranch: refetch,
  };
}

function showAgentActions(input: {
  hovered: boolean;
  focused: boolean;
  kebabFocused: boolean;
  compact: boolean;
  menuOpen: boolean;
}): boolean {
  return (
    input.hovered ||
    input.focused ||
    input.kebabFocused ||
    platformIsNative ||
    input.compact ||
    input.menuOpen
  );
}

export function WorkspaceNewAgentRow({
  newAgent,
  diffStat,
  prHint,
  serverId,
  workspaceId,
  onWorkspacePress,
}: {
  newAgent: SidebarWorkspaceNewAgentRow;
  diffStat: { additions: number; deletions: number } | null;
  prHint: PrHint | null;
  serverId: string;
  workspaceId: string;
  onWorkspacePress?: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isKebabFocused, setIsKebabFocused] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [dropdownMenuOpen, setDropdownMenuOpen] = useState(false);
  const { branch, branchReady, refreshBranch } = useCheckoutBranch(newAgent.cwd, serverId);
  const labelDefinitions = useWorkspaceLabelDefinitions(serverId, newAgent.labels);
  const menuAgent = useMemo(
    () => ({ agentId: newAgent.tabId, cwd: newAgent.cwd }),
    [newAgent.cwd, newAgent.tabId],
  );
  const workspaceKey = `${serverId}:${workspaceId}`;
  const setLabelAssignment = useCallback(
    async (input: { label: WorkspaceLabelDefinition; assigned: boolean }) => {
      const store = useWorkspaceLayoutStore.getState();
      const tab = store
        .getWorkspaceTabs(workspaceKey)
        .find((candidate) => candidate.tabId === newAgent.tabId);
      if (tab?.target.kind !== "new_tab" && tab?.target.kind !== "draft") return;
      const key = workspaceLabelKey(input.label.name);
      const current = tab.target.labels ?? [];
      const labels = input.assigned
        ? [...current.filter((name) => workspaceLabelKey(name) !== key), input.label.name]
        : current.filter((name) => workspaceLabelKey(name) !== key);
      store.replaceTab(workspaceKey, tab.tabId, {
        ...tab.target,
        labels: labels.length > 0 ? labels : undefined,
      });
    },
    [newAgent.tabId, workspaceKey],
  );
  const labelTarget = useMemo(
    () => ({
      kind: "draft" as const,
      serverId,
      labels: newAgent.labels,
      setAssignment: setLabelAssignment,
    }),
    [newAgent.labels, serverId, setLabelAssignment],
  );
  const labelPages = useWorkspaceLabelMenuPages(labelTarget);
  const isCompact = useIsCompactFormFactor();
  const actionsVisible = showAgentActions({
    hovered: isHovered,
    focused: isFocused,
    kebabFocused: isKebabFocused,
    compact: isCompact,
    menuOpen: dropdownMenuOpen,
  });
  const handlePress = useCallback(() => {
    onWorkspacePress?.();
    navigateToWorkspace({ serverId, workspaceId });
    useWorkspaceLayoutStore.getState().focusTab(`${serverId}:${workspaceId}`, newAgent.tabId);
  }, [newAgent.tabId, onWorkspacePress, serverId, workspaceId]);
  const handleCopyPath = useCallback(() => {
    void Clipboard.setStringAsync(newAgent.cwd);
    toast.copied(t("sidebar.workspace.toasts.pathCopied"));
  }, [newAgent.cwd, t, toast]);
  const handleCopyBranchName = useCallback(() => {
    if (!branchReady || !branch) return;
    void Clipboard.setStringAsync(branch);
    toast.copied(t("sidebar.workspace.toasts.branchNameCopied"));
  }, [branch, branchReady, t, toast]);
  const handleFocus = useCallback(() => {
    setIsFocused(true);
    void refreshBranch();
  }, [refreshBranch]);
  const handleBlur = useCallback(() => setIsFocused(false), []);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const handlePressIn = useCallback(() => setIsPressed(true), []);
  const handlePressOut = useCallback(() => setIsPressed(false), []);
  const handleKebabFocus = useCallback(() => setIsKebabFocused(true), []);
  const handleKebabBlur = useCallback(() => setIsKebabFocused(false), []);
  const handleContextMenuOpenChange = useCallback(
    (open: boolean) => {
      setContextMenuOpen(open);
      if (open) void refreshBranch();
    },
    [refreshBranch],
  );
  const handleDropdownMenuOpenChange = useCallback(
    (open: boolean) => {
      setDropdownMenuOpen(open);
      if (open) void refreshBranch();
    },
    [refreshBranch],
  );
  const handleClose = useCallback(() => {
    useWorkspaceLayoutStore.getState().closeTab(workspaceKey, newAgent.tabId);
  }, [newAgent.tabId, workspaceKey]);
  const rowStyle = [
    styles.agentRow,
    isHovered && !isPressed && styles.agentRowHovered,
    isPressed && styles.agentRowPressed,
  ];

  return (
    <AgentHoverCard
      title={t("panels.draft.newAgent")}
      serverId={serverId}
      branch={branch}
      branchPending={!branchReady}
      diffStat={diffStat}
      workspaceDirectory={newAgent.cwd}
      workspaceDirectoryLabel={newAgent.cwdLabel}
      prHint={prHint}
      labels={labelDefinitions}
      disabled={contextMenuOpen || dropdownMenuOpen}
    >
      <View
        style={styles.agentRowContainer}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        <ContextMenu open={contextMenuOpen} onOpenChange={handleContextMenuOpenChange}>
          <ContextMenuTrigger
            accessibilityRole={platformIsWeb ? undefined : "button"}
            accessibilityLabel={t("panels.draft.newAgent")}
            onPress={handlePress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            onFocus={handleFocus}
            onBlur={handleBlur}
            style={rowStyle}
            highlightStyle={styles.agentRowPressed}
            testID={`sidebar-new-agent-row-${newAgent.tabId}`}
          >
            <AgentStatusIndicator bucket="done" />
            <Text style={styles.agentTitle} numberOfLines={1}>
              {t("panels.draft.newAgent")}
            </Text>
            <View
              style={!actionsVisible && styles.agentKebabHidden}
              pointerEvents={actionsVisible ? "auto" : "none"}
            >
              <WorkspaceAgentKebabMenu
                agent={menuAgent}
                serverId={serverId}
                branch={branch}
                branchPending={!branchReady}
                open={dropdownMenuOpen}
                onOpenChange={handleDropdownMenuOpenChange}
                onFocus={handleKebabFocus}
                onBlur={handleKebabBlur}
                labelPages={labelPages}
                onOpen={handlePress}
                onCopyPath={handleCopyPath}
                onCopyBranchName={handleCopyBranchName}
                onClose={handleClose}
                onArchive={handleClose}
              />
            </View>
          </ContextMenuTrigger>
          <ContextMenuContent
            align="start"
            width={220}
            testID={`sidebar-new-agent-context-menu-${newAgent.tabId}`}
            pages={labelPages}
          >
            <WorkspaceAgentMenuItems
              agent={menuAgent}
              serverId={serverId}
              branch={branch}
              branchPending={!branchReady}
              surface="context"
              onOpen={handlePress}
              onCopyPath={handleCopyPath}
              onCopyBranchName={handleCopyBranchName}
              onClose={handleClose}
              onArchive={handleClose}
            />
          </ContextMenuContent>
        </ContextMenu>
      </View>
    </AgentHoverCard>
  );
}

/**
 * Two levels under the workspace header: one agent, named, with its status on the left. The
 * Branch ownership is the agent's exact cwd; the member block contributes diff/PR facts only
 * when that cwd matches the member directory. The same preferences gate them as before:
 * "Show → Branch" for the branch, the trailing slot's "diff" choice for the diff.
 */
export function WorkspaceAgentRow({
  agent,
  diffStat,
  prHint,
  serverId,
  workspaceId,
  onWorkspacePress,
}: {
  agent: SidebarWorkspaceAgentRow;
  diffStat: { additions: number; deletions: number } | null;
  prHint: PrHint | null;
  serverId: string;
  workspaceId: string;
  onWorkspacePress?: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { archiveAgent } = useArchiveAgent();
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isKebabFocused, setIsKebabFocused] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [dropdownMenuOpen, setDropdownMenuOpen] = useState(false);
  const { branch, branchReady, refreshBranch, labelPages, labelDefinitions } =
    useAgentCheckoutPresentation(agent, serverId);
  const isCompact = useIsCompactFormFactor();
  const actionsVisible = showAgentActions({
    hovered: isHovered,
    focused: isFocused,
    kebabFocused: isKebabFocused,
    compact: isCompact,
    menuOpen: dropdownMenuOpen,
  });
  const showBranch = useSidebarRowItems().branch && branch !== null;
  const trailing = useSidebarWorkspaceTrailing();
  const showDiff = trailing === "diff" && diffStat !== null;
  const handlePress = useCallback(() => {
    onWorkspacePress?.();
    navigateToWorkspace({
      serverId,
      workspaceId,
      target: { kind: "agent", agentId: agent.agentId },
    });
  }, [onWorkspacePress, serverId, workspaceId, agent.agentId]);
  const handleCopyPath = useCallback(() => {
    void Clipboard.setStringAsync(agent.cwd);
    toast.copied(t("sidebar.workspace.toasts.pathCopied"));
  }, [agent.cwd, t, toast]);
  const handleCopyBranchName = useCallback(() => {
    if (!branchReady || !branch) return;
    void Clipboard.setStringAsync(branch);
    toast.copied(t("sidebar.workspace.toasts.branchNameCopied"));
  }, [branch, branchReady, t, toast]);
  const handlePointerEnter = useCallback(() => {
    setIsHovered(true);
    void refreshBranch();
  }, [refreshBranch]);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const handlePressIn = useCallback(() => setIsPressed(true), []);
  const handlePressOut = useCallback(() => setIsPressed(false), []);
  const handleFocus = useCallback(() => {
    setIsFocused(true);
    void refreshBranch();
  }, [refreshBranch]);
  const handleBlur = useCallback(() => setIsFocused(false), []);
  const handleKebabFocus = useCallback(() => setIsKebabFocused(true), []);
  const handleKebabBlur = useCallback(() => setIsKebabFocused(false), []);
  const handleContextMenuOpenChange = useCallback(
    (open: boolean) => {
      setContextMenuOpen(open);
      if (open) void refreshBranch();
    },
    [refreshBranch],
  );
  const handleDropdownMenuOpenChange = useCallback(
    (open: boolean) => {
      setDropdownMenuOpen(open);
      if (open) void refreshBranch();
    },
    [refreshBranch],
  );
  const rowStyle = [
    styles.agentRow,
    isHovered && !isPressed && styles.agentRowHovered,
    isPressed && styles.agentRowPressed,
  ];

  const handleArchive = useCallback(async () => {
    const storedAgent = useSessionStore.getState().sessions[serverId]?.agents.get(agent.agentId);
    const isRunning = storedAgent?.status === "running";
    const confirmed = await confirmDialog({
      title: isRunning
        ? t("workspace.tabs.confirmations.archiveRunningAgentTitle")
        : t("sidebar.agent.confirmations.archiveTitle"),
      message: isRunning
        ? t("workspace.tabs.confirmations.archiveRunningAgentMessage")
        : t("sidebar.agent.confirmations.archiveMessage"),
      confirmLabel: t("agentList.archiveSheet.archive"),
      cancelLabel: t("common.actions.cancel"),
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    try {
      await archiveAgent({ serverId, agentId: agent.agentId });
    } catch (error) {
      toast.error(toErrorMessage(error));
    }
  }, [agent.agentId, archiveAgent, serverId, t, toast]);
  const handleClose = useCallback(() => {
    const workspaceKey = `${serverId}:${workspaceId}`;
    const store = useWorkspaceLayoutStore.getState();
    const layout = store.layoutByWorkspace[workspaceKey];
    const tab = layout
      ? collectAllTabs(layout.root).find(
          (candidate) =>
            candidate.target.kind === "agent" && candidate.target.agentId === agent.agentId,
        )
      : undefined;
    if (!tab) return;
    store.hideAgent(workspaceKey, agent.agentId);
    store.closeTab(workspaceKey, tab.tabId);
  }, [agent.agentId, serverId, workspaceId]);

  return (
    <AgentHoverCard
      title={agent.title}
      serverId={serverId}
      branch={branch}
      branchPending={!branchReady}
      diffStat={diffStat}
      workspaceDirectory={agent.cwd}
      workspaceDirectoryLabel={agent.cwdLabel}
      prHint={prHint}
      labels={labelDefinitions}
      disabled={contextMenuOpen || dropdownMenuOpen}
    >
      <View
        style={styles.agentRowContainer}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        <ContextMenu open={contextMenuOpen} onOpenChange={handleContextMenuOpenChange}>
          <ContextMenuTrigger
            accessibilityRole={platformIsWeb ? undefined : "button"}
            accessibilityLabel={agent.title}
            onPress={handlePress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            onFocus={handleFocus}
            onBlur={handleBlur}
            style={rowStyle}
            highlightStyle={styles.agentRowPressed}
            testID={`sidebar-agent-row-${agent.agentId}`}
          >
            <AgentStatusIndicator bucket={agent.statusBucket} />
            <Text style={styles.agentTitle} numberOfLines={1}>
              {agent.title}
            </Text>
            {showBranch || showDiff ? (
              <View style={styles.agentTrailing}>
                {showBranch ? (
                  <View style={styles.agentBranch} testID={`sidebar-agent-branch-${agent.agentId}`}>
                    <ThemedGitBranch size={12} uniProps={foregroundMutedColorMapping} />
                    <Text style={styles.agentBranchText} numberOfLines={1}>
                      {branch}
                    </Text>
                  </View>
                ) : null}
                {showDiff && diffStat ? (
                  <DiffStat
                    additions={diffStat.additions}
                    deletions={diffStat.deletions}
                    testID={`sidebar-agent-diff-${agent.agentId}`}
                  />
                ) : null}
              </View>
            ) : null}
            <View
              style={!actionsVisible && styles.agentKebabHidden}
              pointerEvents={actionsVisible ? "auto" : "none"}
            >
              <WorkspaceAgentKebabMenu
                agent={agent}
                serverId={serverId}
                branch={branch}
                branchPending={!branchReady}
                open={dropdownMenuOpen}
                onOpenChange={handleDropdownMenuOpenChange}
                onFocus={handleKebabFocus}
                onBlur={handleKebabBlur}
                labelPages={labelPages}
                onOpen={handlePress}
                onCopyPath={handleCopyPath}
                onCopyBranchName={handleCopyBranchName}
                onClose={handleClose}
                onArchive={handleArchive}
              />
            </View>
          </ContextMenuTrigger>
          <ContextMenuContent
            align="start"
            width={220}
            testID={`sidebar-agent-context-menu-${agent.agentId}`}
            pages={labelPages}
          >
            <WorkspaceAgentMenuItems
              agent={agent}
              serverId={serverId}
              branch={branch}
              branchPending={!branchReady}
              surface="context"
              onOpen={handlePress}
              onCopyPath={handleCopyPath}
              onCopyBranchName={handleCopyBranchName}
              onClose={handleClose}
              onArchive={handleArchive}
            />
          </ContextMenuContent>
        </ContextMenu>
      </View>
    </AgentHoverCard>
  );
}

const styles = StyleSheet.create((theme) => ({
  agentRowContainer: {
    position: "relative",
  },
  // The agent's status dot sits under its member row's title — see the list's indent math.
  agentRow: {
    minHeight: 28,
    marginBottom: theme.spacing[0.5],
    paddingVertical: theme.spacing[1],
    paddingLeft: theme.spacing[2] + (theme.iconSize.md + theme.spacing[2]) * 2,
    paddingRight: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    userSelect: "none",
  },
  agentRowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  agentRowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  agentKebabHidden: {
    opacity: 0,
  },
  agentStatusSlot: {
    width: theme.iconSize.md,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  agentStatusDot: {
    width: STATUS_INDICATOR_FILLED_DOT_SIZE,
    height: STATUS_INDICATOR_FILLED_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
  },
  agentStatusDotFailed: {
    backgroundColor: getStatusDotColor({ theme, bucket: "failed" }) ?? undefined,
  },
  agentStatusDotAttention: {
    backgroundColor: getStatusDotColor({ theme, bucket: "attention" }) ?? undefined,
  },
  agentStatusDotIdle: {
    backgroundColor: theme.colors.foregroundExtraMuted,
    opacity: 0.3,
  },
  agentTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    minWidth: 0,
    flexShrink: 1,
    flex: 1,
    opacity: 0.86,
  },
  // The member's checkout facts, pinned right: the branch the workspace row's meta line used
  // to carry, then the diff badge its trailing slot used to carry. Same glyph size and ink as
  // the old meta item so the row reads as the same list, one level down.
  agentTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  agentBranch: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    minWidth: 0,
    flexShrink: 1,
  },
  agentBranchText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
    flexShrink: 1,
  },
}));
