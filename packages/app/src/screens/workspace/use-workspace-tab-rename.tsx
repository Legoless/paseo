import { useCallback, useState } from "react";
import { type QueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ListTerminalsResponse } from "@getpaseo/protocol/messages";
import { useTranslation } from "react-i18next";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

interface RenamingTabState {
  kind: "terminal" | "agent" | "tab";
  id: string;
  currentTitle: string;
}

interface UseWorkspaceTabRenameInput {
  client: DaemonClient | null;
  normalizedServerId: string;
  queryClient: QueryClient;
  terminalsData: ListTerminalsResponse["payload"] | undefined;
  terminalsQueryKey: readonly unknown[];
  /** Null while the workspace has no persistence key; renaming is unavailable until it does. */
  persistenceKey: string | null;
}

interface UseWorkspaceTabRenameResult {
  renamingTab: RenamingTabState | null;
  handleRenameTab: (tab: WorkspaceTabDescriptor) => void;
  handleRenameModalSubmit: (nextTitle: string) => Promise<void>;
  handleRenameModalClose: () => void;
}

export function useWorkspaceTabRename(
  input: UseWorkspaceTabRenameInput,
): UseWorkspaceTabRenameResult {
  const {
    client,
    normalizedServerId,
    queryClient,
    terminalsData,
    terminalsQueryKey,
    persistenceKey,
  } = input;
  const setTabTitle = useWorkspaceLayoutStore((state) => state.setTabTitle);
  const { t } = useTranslation();
  const [renamingTab, setRenamingTab] = useState<RenamingTabState | null>(null);

  const handleRenameTab = useCallback(
    (tab: WorkspaceTabDescriptor) => {
      if (tab.target.kind === "terminal") {
        const { terminalId } = tab.target;
        const terminal = terminalsData?.terminals.find((entry) => entry.id === terminalId) ?? null;
        const currentTitle = terminal?.title ?? terminal?.name ?? "";
        setRenamingTab({ kind: "terminal", id: terminalId, currentTitle });
        return;
      }
      if (tab.target.kind === "agent") {
        const { agentId } = tab.target;
        const agent =
          useSessionStore.getState().sessions[normalizedServerId]?.agents?.get(agentId) ?? null;
        const currentTitle = agent?.title ?? "";
        setRenamingTab({ kind: "agent", id: agentId, currentTitle });
        return;
      }
      // Everything else — the launcher, Files, Changes, a diff, the browser — has no entity whose
      // title could hold the name, so it lives on the tab.
      // Opens blank when the tab has never been named: the derived label is computed by the
      // panel's own hook at render time and is not reachable from here.
      setRenamingTab({ kind: "tab", id: tab.tabId, currentTitle: tab.title ?? "" });
    },
    [normalizedServerId, terminalsData],
  );

  const handleRenameModalSubmit = useCallback(
    async (nextTitle: string) => {
      if (!renamingTab) return;
      const trimmed = nextTitle.trim();
      if (renamingTab.kind === "tab") {
        if (!persistenceKey) return;
        // Empty hands the tab back to its panel's derived label.
        setTabTitle(persistenceKey, renamingTab.id, trimmed || null);
        return;
      }
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      if (renamingTab.kind === "terminal") {
        const result = await client.renameTerminal({
          terminalId: renamingTab.id,
          title: trimmed,
        });
        if (!result.success) {
          throw new Error(result.error ?? "Failed to rename terminal");
        }
        void queryClient.invalidateQueries({ queryKey: terminalsQueryKey });
        return;
      }
      await client.updateAgent(renamingTab.id, { name: trimmed });
      void queryClient.invalidateQueries({
        queryKey: ["sidebarAgentsList", normalizedServerId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["allAgents", normalizedServerId],
      });
    },
    [
      client,
      normalizedServerId,
      persistenceKey,
      queryClient,
      renamingTab,
      setTabTitle,
      terminalsQueryKey,
      t,
    ],
  );

  const handleRenameModalClose = useCallback(() => {
    setRenamingTab(null);
  }, []);

  return {
    renamingTab,
    handleRenameTab,
    handleRenameModalSubmit,
    handleRenameModalClose,
  };
}

export interface WorkspaceTabRenameModalProps {
  renamingTab: RenamingTabState | null;
  onClose: () => void;
  onSubmit: (nextTitle: string) => Promise<void>;
}

export function WorkspaceTabRenameModal({
  renamingTab,
  onClose,
  onSubmit,
}: WorkspaceTabRenameModalProps) {
  const { t } = useTranslation();
  const title =
    renamingTab?.kind === "terminal"
      ? t("workspace.tabs.menu.renameTerminal")
      : t("workspace.tabs.menu.renameAgent");
  const initialValue = renamingTab?.currentTitle ?? "";
  const testID = renamingTab
    ? `workspace-tab-rename-modal-${renamingTab.kind}-${renamingTab.id}`
    : undefined;
  return (
    <AdaptiveRenameModal
      visible={renamingTab !== null}
      title={title}
      initialValue={initialValue}
      submitLabel={t("workspace.tabs.menu.rename")}
      maxLength={200}
      onClose={onClose}
      onSubmit={onSubmit}
      testID={testID}
    />
  );
}
