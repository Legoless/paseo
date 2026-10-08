import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Terminal } from "lucide-react-native";
import { Text, View } from "react-native";
import invariant from "tiny-invariant";
import type { ListTerminalsResponse } from "@getpaseo/protocol/messages";
import { deriveTerminalActivityStatusBucket } from "@getpaseo/protocol/terminal-activity";
import { TerminalPane } from "@/components/terminal-pane";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor } from "@/panels/panel-registry";
import { queryClient } from "@/data/query-client";
import {
  buildTerminalsQueryKey,
  resolveTerminalListRoot,
  resolveTerminalContextCwd,
} from "@/screens/workspace/terminals/state";
import { usePanelStore } from "@/stores/panel-store";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { useCheckoutStatusQuery } from "@/git/use-status-query";

type ListTerminalsPayload = ListTerminalsResponse["payload"];

const CENTERED_PADDED_STYLE = {
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
} as const;

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function useTerminalPanelDescriptor(
  target: { kind: "terminal"; terminalId: string },
  context: { serverId: string; workspaceId: string },
): PanelDescriptor {
  const { t } = useTranslation();
  const client = useSessionStore((state) => state.sessions[context.serverId]?.client ?? null);
  const workspaceFields = useWorkspaceFields(
    context.serverId,
    context.workspaceId,
    (workspace) => ({
      workspaceDirectory:
        workspace.members.length === 1 ? workspace.members[0]!.workspaceDirectory : null,
      memberCount: workspace.members.length,
    }),
  );
  const workspaceDirectory = workspaceFields?.workspaceDirectory ?? null;
  const terminalListRoot = resolveTerminalListRoot(workspaceDirectory, context.workspaceId);
  const terminalsQuery = useQuery(
    {
      queryKey: buildTerminalsQueryKey(
        context.serverId,
        terminalListRoot,
        context.workspaceId || null,
      ),
      enabled: Boolean(client && context.workspaceId),
      queryFn: async (): Promise<ListTerminalsPayload> => {
        if (!client) {
          throw new Error("Workspace terminals are unavailable");
        }
        return client.listTerminals(terminalListRoot ?? undefined, undefined, {
          workspaceId: context.workspaceId || undefined,
        });
      },
      staleTime: 5_000,
    },
    queryClient,
  );
  const terminal =
    terminalsQuery.data?.terminals.find((entry) => entry.id === target.terminalId) ?? null;
  const label =
    trimNonEmpty(terminal?.title ?? terminal?.name ?? null) ??
    t("workspace.tabs.fallback.terminal");

  return {
    label,
    subtitle: t("workspace.tabs.fallback.terminal"),
    tooltip: label,
    titleState: terminalsQuery.isPending ? "loading" : "ready",
    icon: Terminal,
    statusBucket: deriveTerminalActivityStatusBucket(terminal?.activity),
  };
}

function TerminalPanel() {
  const { serverId, workspaceId, target, openFileInWorkspace } = usePaneContext();
  const { isWorkspaceFocused, isPaneFocused } = usePaneFocus();
  invariant(target.kind === "terminal", "TerminalPanel requires terminal target");
  const workspaceFields = useWorkspaceFields(serverId, workspaceId, (w) => ({
    workspaceDirectory: w.members.length === 1 ? w.members[0]!.workspaceDirectory : null,
    members: w.members,
    memberCount: w.members.length,
  }));
  const primaryWorkspaceDirectory = workspaceFields?.workspaceDirectory || null;
  const terminalListRoot = resolveTerminalListRoot(primaryWorkspaceDirectory, workspaceId);
  const terminalsQuery = useQuery(
    {
      queryKey: buildTerminalsQueryKey(serverId, terminalListRoot, workspaceId || null),
      enabled: Boolean(workspaceId),
      queryFn: async (): Promise<ListTerminalsPayload> => {
        const client = useSessionStore.getState().sessions[serverId]?.client ?? null;
        if (!client) {
          throw new Error("Workspace terminals are unavailable");
        }
        return client.listTerminals(terminalListRoot ?? undefined, undefined, {
          workspaceId: workspaceId || undefined,
        });
      },
      staleTime: 5_000,
    },
    queryClient,
  );
  const terminal = terminalsQuery.data?.terminals.find((entry) => entry.id === target.terminalId);
  const launchDirectory = terminal?.cwd ?? primaryWorkspaceDirectory;
  const contextDirectory = resolveTerminalContextCwd(terminal, launchDirectory);
  const { status } = useCheckoutStatusQuery({ serverId, cwd: contextDirectory ?? "" });
  const isGitCheckout = status?.isGit === true;
  const openCompactFileExplorer = usePanelStore((state) => state.openCompactFileExplorer);
  const handleOpenFileExplorer = useCallback(() => {
    if (!contextDirectory) {
      return;
    }
    openCompactFileExplorer({ serverId, cwd: contextDirectory, isGit: isGitCheckout });
  }, [contextDirectory, isGitCheckout, openCompactFileExplorer, serverId]);
  if (!launchDirectory) {
    return (
      <View style={CENTERED_PADDED_STYLE}>
        <Text>Workspace directory not found.</Text>
      </View>
    );
  }

  return (
    <TerminalPane
      serverId={serverId}
      cwd={launchDirectory}
      contextCwd={contextDirectory ?? launchDirectory}
      terminalId={target.terminalId}
      isWorkspaceFocused={isWorkspaceFocused}
      isPaneFocused={isPaneFocused}
      onOpenFileExplorer={handleOpenFileExplorer}
      onOpenWorkspaceFile={openFileInWorkspace}
    />
  );
}

export const terminalPanelRegistration = definePanel("terminal", {
  component: TerminalPanel,
  useDescriptor: useTerminalPanelDescriptor,
});
