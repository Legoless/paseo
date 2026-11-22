import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { buildDraftAgentSetup } from "@/client-slash-commands";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FOOTER_HEIGHT } from "@/constants/layout";
import type { AgentScreenAgent } from "@/hooks/use-agent-screen-state-machine";
import { applyArchivedAgentCloseResults } from "@/hooks/use-archive-agent";
import { KeyboardTranslateView } from "@/keyboard/shift";
import { usePaneContext } from "@/panels/pane-context";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { generateDraftId } from "@/stores/draft-keys";
import { type Agent, useSessionStore } from "@/stores/session-store";
import {
  FOCUSED_PANE_PLACEMENT,
  findPaneContainingTab,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import type { Theme } from "@/styles/theme";
import { toErrorMessage } from "@/utils/error-messages";
import {
  buildWorkspaceTabPersistenceKey,
  type WorkspaceDraftTabSetup,
} from "@/workspace-tabs/model";

export interface StartNewSessionPorts {
  archiveAgent(agentId: string): Promise<{ archivedAt: string }>;
  unpinAndHideAgent(): void;
  replaceOrOpenDraftTab(draftId: string, setup?: WorkspaceDraftTabSetup): string | null;
  applyPreservedTabTitle(tabId: string): void;
  applyArchivedResult(archivedAt: string): void;
  evictTimeline(agentId: string): void;
  createDraftId(): string;
}

export async function startNewSessionAfterMissingHistory(input: {
  agentId: string;
  setup?: WorkspaceDraftTabSetup;
  ports: StartNewSessionPorts;
}): Promise<void> {
  const { archivedAt } = await input.ports.archiveAgent(input.agentId);
  input.ports.unpinAndHideAgent();
  const nextTabId = input.ports.replaceOrOpenDraftTab(input.ports.createDraftId(), input.setup);
  if (nextTabId) {
    input.ports.applyPreservedTabTitle(nextTabId);
  }
  input.ports.applyArchivedResult(archivedAt);
  input.ports.evictTimeline(input.agentId);
}

function resolveDraftSetup(
  storedAgent: Agent | null,
  screenAgent: AgentScreenAgent | null,
): WorkspaceDraftTabSetup | undefined {
  if (storedAgent) {
    return buildDraftAgentSetup(storedAgent);
  }
  if (!screenAgent?.provider) {
    return undefined;
  }
  return buildDraftAgentSetup({
    provider: screenAgent.provider,
    cwd: screenAgent.cwd,
    currentModeId: screenAgent.currentModeId ?? null,
    model: screenAgent.model ?? null,
    thinkingOptionId: screenAgent.thinkingOptionId ?? null,
    runtimeInfo: screenAgent.runtimeInfo
      ? {
          provider: screenAgent.provider,
          sessionId: null,
          model: screenAgent.runtimeInfo.model ?? null,
          modeId: screenAgent.runtimeInfo.modeId ?? null,
          thinkingOptionId: screenAgent.runtimeInfo.thinkingOptionId ?? null,
        }
      : undefined,
    features: screenAgent.features ? [...screenAgent.features] : undefined,
  });
}

function snapshotTabRecoveryContext(input: {
  workspaceKey: string | null;
  tabId: string;
  storedAgent: Agent | null;
}): { originalPaneId: string | null; preservedTitle: string | null } {
  const { workspaceKey, tabId, storedAgent } = input;
  const layoutStore = useWorkspaceLayoutStore.getState();
  const currentTab = workspaceKey
    ? layoutStore.getWorkspaceTabs(workspaceKey).find((entry) => entry.tabId === tabId)
    : undefined;
  const currentLayout = workspaceKey ? layoutStore.layoutByWorkspace[workspaceKey] : undefined;
  const originalPaneId = currentLayout
    ? (findPaneContainingTab(currentLayout.root, tabId)?.id ?? null)
    : null;
  const fallbackTitle =
    storedAgent?.title && storedAgent.title !== "Agent" ? storedAgent.title : null;
  return {
    originalPaneId,
    preservedTitle: currentTab?.title ?? fallbackTitle,
  };
}

function replaceOrOpenWorkspaceDraftTab(input: {
  workspaceKey: string | null;
  tabId: string;
  originalPaneId: string | null;
  draftId: string;
  setup?: WorkspaceDraftTabSetup;
  retargetCurrentTab: ReturnType<typeof usePaneContext>["retargetCurrentTab"];
}): string | null {
  const target = {
    kind: "draft" as const,
    draftId: input.draftId,
    ...(input.setup ? { setup: input.setup } : {}),
  };
  if (!input.workspaceKey) {
    input.retargetCurrentTab(target);
    return null;
  }
  const layoutStore = useWorkspaceLayoutStore.getState();
  // The daemon emits `agent_update` (with `archivedAt`) before the
  // `agent_archived` RPC reply, so workspace reconciliation may have already
  // pruned `tabId` while we awaited `archiveAgent`. Fall back to opening the
  // replacement draft in the same pane when that wins.
  const replacedTabId = layoutStore.replaceTab(input.workspaceKey, input.tabId, target);
  if (replacedTabId) {
    return replacedTabId;
  }
  return layoutStore.openTab({
    workspaceKey: input.workspaceKey,
    target,
    intent: "new",
    placement: input.originalPaneId
      ? { mode: "prefer", paneId: input.originalPaneId }
      : FOCUSED_PANE_PLACEMENT,
  });
}

export interface AgentSessionMissingNoticeProps {
  serverId: string;
  workspaceId: string;
  agentId: string;
  agent: AgentScreenAgent | null;
  canStartNewSession: boolean;
  placement: "centered" | "footer";
}

export function AgentSessionMissingNotice({
  serverId,
  workspaceId,
  agentId,
  agent,
  canStartNewSession,
  placement,
}: AgentSessionMissingNoticeProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { tabId, retargetCurrentTab } = usePaneContext();
  const unpinWorkspaceAgent = useWorkspaceLayoutStore((state) => state.unpinAgent);
  const hideWorkspaceAgent = useWorkspaceLayoutStore((state) => state.hideAgent);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const handleStartNewSession = useCallback(async () => {
    if (!canStartNewSession || !client || !isConnected || isStarting) {
      return;
    }
    setIsStarting(true);
    setStartError(null);

    const session = useSessionStore.getState().sessions[serverId];
    const storedAgent =
      session?.agents?.get(agentId) ?? session?.agentDetails?.get(agentId) ?? null;
    const setup = resolveDraftSetup(storedAgent, agent);
    const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
    const { originalPaneId, preservedTitle } = snapshotTabRecoveryContext({
      workspaceKey,
      tabId,
      storedAgent,
    });

    try {
      await startNewSessionAfterMissingHistory({
        agentId,
        setup,
        ports: {
          archiveAgent: (id) => client.archiveAgent(id),
          unpinAndHideAgent: () => {
            if (!workspaceKey) return;
            unpinWorkspaceAgent(workspaceKey, agentId);
            hideWorkspaceAgent(workspaceKey, agentId);
          },
          replaceOrOpenDraftTab: (draftId, nextSetup) =>
            replaceOrOpenWorkspaceDraftTab({
              workspaceKey,
              tabId,
              originalPaneId,
              draftId,
              setup: nextSetup,
              retargetCurrentTab,
            }),
          applyPreservedTabTitle: (nextTabId) => {
            if (!workspaceKey || !preservedTitle) return;
            useWorkspaceLayoutStore.getState().setTabTitle(workspaceKey, nextTabId, preservedTitle);
          },
          applyArchivedResult: (archivedAt) => {
            applyArchivedAgentCloseResults({
              queryClient,
              serverId,
              results: [{ agentId, archivedAt }],
            });
          },
          evictTimeline: (id) => {
            useSessionStore.getState().sessions[serverId]?.viewedTimelineSync?.evictAgent?.(id);
          },
          createDraftId: generateDraftId,
        },
      });
    } catch (error) {
      setStartError(toErrorMessage(error));
      setIsStarting(false);
    }
  }, [
    agent,
    agentId,
    canStartNewSession,
    client,
    hideWorkspaceAgent,
    isConnected,
    isStarting,
    queryClient,
    retargetCurrentTab,
    serverId,
    tabId,
    unpinWorkspaceAgent,
    workspaceId,
  ]);

  const noticeBody = (
    <>
      <Alert
        size="md"
        variant="warning"
        testID="agent-session-missing"
        title={t("agentPanel.sessionMissing.title")}
        description={
          canStartNewSession
            ? t("agentPanel.sessionMissing.description")
            : t("agentPanel.sessionMissing.readOnlyDescription")
        }
      >
        {canStartNewSession ? (
          <Button
            size="sm"
            variant="outline"
            onPress={handleStartNewSession}
            disabled={!isConnected || isStarting}
            testID="agent-session-missing-start-new"
          >
            {isStarting
              ? t("agentPanel.sessionMissing.starting")
              : t("agentPanel.sessionMissing.startNewSession")}
          </Button>
        ) : null}
      </Alert>
      {startError ? (
        <Text style={styles.errorText} testID="agent-session-missing-error">
          {startError}
        </Text>
      ) : null}
    </>
  );

  if (placement === "footer") {
    return (
      <KeyboardTranslateView style={styles.footerContainer}>
        <View style={styles.footerRail} testID="agent-session-missing-view">
          <View style={styles.footerContent}>{noticeBody}</View>
        </View>
      </KeyboardTranslateView>
    );
  }

  return (
    <View style={styles.centeredContainer} testID="agent-session-missing-view">
      <View style={styles.centeredContent}>{noticeBody}</View>
    </View>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  centeredContainer: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[6],
  },
  centeredContent: {
    width: "100%",
    maxWidth: theme.contentMaxWidth,
    gap: theme.spacing[2],
  },
  footerContainer: {
    flexDirection: "column",
    position: "relative",
  },
  footerRail: {
    position: "relative",
    minHeight: FOOTER_HEIGHT,
    marginHorizontal: "auto",
    alignItems: "center",
    width: "100%",
    padding: theme.spacing[4],
  },
  footerContent: {
    width: "100%",
    maxWidth: theme.contentMaxWidth,
    gap: theme.spacing[2],
  },
  errorText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
}));
