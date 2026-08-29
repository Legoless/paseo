import React, { useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  type PressableStateCallbackType,
  type ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { CircleAlert, GitBranch } from "lucide-react-native";
import { DiffStat } from "@/components/diff-stat";
import { StatusRing } from "@/components/status-ring";
import { useSidebarRowItems } from "@/components/sidebar/display-preferences/model";
import { useSidebarWorkspaceTrailing } from "@/components/sidebar/workspace-trailing";
import type { SidebarWorkspaceAgentRow } from "@/projects/workspace-groups";
import { isWeb as platformIsWeb } from "@/constants/platform";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import type { Theme } from "@/styles/theme";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { getStatusDotColor } from "@/utils/status-dot-color";
import {
  STATUS_INDICATOR_ALERT_SIZE,
  STATUS_INDICATOR_FILLED_DOT_SIZE,
} from "@/utils/status-indicator-geometry";

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

/**
 * Two levels under the workspace header: one agent, named, with its status on the left. The
 * checkout facts the workspace row used to carry live here now — the branch and diff of the
 * member project the agent runs in, handed down by the member block so agents sharing a member
 * never re-derive them. The same preferences gate them as before: "Show → Branch" for the
 * branch, the trailing slot's "diff" choice for the diff.
 */
export function WorkspaceAgentRow({
  agent,
  branch,
  diffStat,
  serverId,
  workspaceId,
  onWorkspacePress,
}: {
  agent: SidebarWorkspaceAgentRow;
  /** The parent member's checkout facts — shared by every agent bucketed under it. */
  branch: string | null;
  diffStat: { additions: number; deletions: number } | null;
  serverId: string;
  workspaceId: string;
  onWorkspacePress?: () => void;
}) {
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
  const rowStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.agentRow,
      hovered && !pressed && styles.agentRowHovered,
      pressed && styles.agentRowPressed,
    ],
    [],
  );

  return (
    <Pressable
      accessibilityRole={platformIsWeb ? undefined : "button"}
      accessibilityLabel={agent.title}
      onPress={handlePress}
      style={rowStyle}
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
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
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
