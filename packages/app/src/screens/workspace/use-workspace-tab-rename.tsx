import { useCallback, useState } from "react";
import { type QueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ListTerminalsResponse } from "@getpaseo/protocol/messages";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

interface RenamingTabState {
  kind: "terminal" | "agent" | "tab";
  id: string;
  tabId: string;
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
  handleRenameTab: (tab: WorkspaceTabDescriptor, currentLabel?: string) => void;
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
    (tab: WorkspaceTabDescriptor, currentLabel?: string) => {
      if (tab.target.kind === "terminal") {
        const { terminalId } = tab.target;
        const terminal = terminalsData?.terminals.find((entry) => entry.id === terminalId) ?? null;
        const currentTitle = tab.title || terminal?.title || terminal?.name || currentLabel || "";
        setRenamingTab({ kind: "terminal", id: terminalId, tabId: tab.tabId, currentTitle });
        return;
      }
      if (tab.target.kind === "agent") {
        const { agentId } = tab.target;
        const agent =
          useSessionStore.getState().sessions[normalizedServerId]?.agents?.get(agentId) ?? null;
        const currentTitle = tab.title || agent?.title || currentLabel || "";
        setRenamingTab({ kind: "agent", id: agentId, tabId: tab.tabId, currentTitle });
        return;
      }
      // Everything else — the launcher, Files, Changes, a diff, the browser — has no entity whose
      // title could hold the name, so it lives on the tab.
      setRenamingTab({
        kind: "tab",
        id: tab.tabId,
        tabId: tab.tabId,
        currentTitle: tab.title || currentLabel || "",
      });
    },
    [normalizedServerId, terminalsData],
  );

  const handleRenameModalSubmit = useCallback(
    async (nextTitle: string) => {
      if (!renamingTab) return;
      const trimmed = nextTitle.trim();
      if (persistenceKey && renamingTab.tabId) {
        setTabTitle(persistenceKey, renamingTab.tabId, trimmed || null);
      }
      if (renamingTab.kind === "tab") {
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

function getRenameModalTitle(kind: RenamingTabState["kind"] | undefined, t: TFunction): string {
  if (kind === "terminal") {
    return t("workspace.tabs.menu.renameTerminal");
  }
  if (kind === "agent") {
    return t("workspace.tabs.menu.renameAgent");
  }
  return t("workspace.tabs.menu.renameTab");
}

export function WorkspaceTabRenameModal({
  renamingTab,
  onClose,
  onSubmit,
}: WorkspaceTabRenameModalProps) {
  const { t } = useTranslation();
  const title = getRenameModalTitle(renamingTab?.kind, t);
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
