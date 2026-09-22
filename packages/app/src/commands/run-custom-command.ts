import type { CustomCommand } from "@getpaseo/protocol/custom-commands";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { resolveFocusedChatTarget } from "@/composer/focused-chat-target";
import { resolveFocusedTerminalTarget } from "@/composer/focused-terminal-target";
import { dispatchComposerAgentMessage } from "@/composer/actions";
import { resolveComposerAttachmentSubmitFormat } from "@/composer/attachments/submit";
import { createMessageSubmissionWriter } from "@/composer/submission/writer";
import { encodeImages } from "@/utils/encode-images";
import { useDraftStore } from "@/stores/draft-store";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useSessionStore } from "@/stores/session-store";
import {
  collectAllTabs,
  useWorkspaceLayoutStore,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey, type WorkspaceTabTarget } from "@/workspace-tabs/model";
import { i18n } from "@/i18n/i18next";

export interface RunCustomCommandInput {
  serverId: string;
  workspaceId: string;
  command: CustomCommand;
  client: DaemonClient | null;
  /**
   * The tab in the pane whose button was pressed. Git actions use that pane's
   * directory; a command uses its tab, instead of whichever pane happens to be focused.
   */
  paneTab?: { tabId: string; target: WorkspaceTabTarget } | null;
  /** Error surface — the toast api from whichever surface (menu or keyboard) triggered the run. */
  onError: (message: string) => void;
}

export function resolveCommandPaneTarget(input: {
  serverId: string;
  commandTarget: CustomCommand["target"];
  paneTab: RunCustomCommandInput["paneTab"];
}):
  | { kind: "terminal"; tabId: string; terminalId: string }
  | { kind: "chat"; tabId: string; draftKey: string; agentId: string | null }
  | null {
  const paneTab = input.paneTab;
  if (!paneTab) {
    return null;
  }
  if (input.commandTarget === "terminal" && paneTab.target.kind === "terminal") {
    return { kind: "terminal", tabId: paneTab.tabId, terminalId: paneTab.target.terminalId };
  }
  if (input.commandTarget === "agent" && paneTab.target.kind === "agent") {
    return {
      kind: "chat",
      tabId: paneTab.tabId,
      draftKey: buildDraftStoreKey({ serverId: input.serverId, agentId: paneTab.target.agentId }),
      agentId: paneTab.target.agentId,
    };
  }
  if (input.commandTarget === "agent" && paneTab.target.kind === "draft") {
    return {
      kind: "chat",
      tabId: paneTab.tabId,
      draftKey: buildDraftStoreKey({
        serverId: input.serverId,
        agentId: paneTab.tabId,
        draftId: paneTab.target.draftId,
      }),
      agentId: null,
    };
  }
  return null;
}

function resolveAgentIdForTab(layout: WorkspaceLayout | undefined, tabId: string): string | null {
  if (!layout) {
    return null;
  }
  const tab = collectAllTabs(layout.root).find((candidate) => candidate.tabId === tabId);
  return tab?.target.kind === "agent" ? tab.target.agentId : null;
}

function runTerminalCustomCommand(input: {
  command: CustomCommand;
  client: DaemonClient | null;
  workspaceKey: string;
  layout: WorkspaceLayout | undefined;
  paneTarget: ReturnType<typeof resolveCommandPaneTarget>;
  onError: (message: string) => void;
}): void {
  const target =
    input.paneTarget?.kind === "terminal"
      ? input.paneTarget
      : resolveFocusedTerminalTarget({ layout: input.layout });
  if (!target) {
    input.onError(i18n.t("workspace.commands.errors.noTerminalTarget"));
    return;
  }
  if (!input.client) {
    input.onError(i18n.t("common.errors.daemonClientUnavailable"));
    return;
  }
  input.client.sendTerminalInput(target.terminalId, {
    type: "input",
    data: input.command.text + (input.command.submit ? "\r" : ""),
  });
  useWorkspaceLayoutStore.getState().focusTab(input.workspaceKey, target.tabId);
}

export async function runCustomCommand(input: RunCustomCommandInput): Promise<void> {
  const { serverId, workspaceId, command, client, onError } = input;
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const missingTargetMessage = i18n.t(
    command.target === "terminal"
      ? "workspace.commands.errors.noTerminalTarget"
      : "workspace.commands.errors.noAgentTarget",
  );
  if (!workspaceKey) {
    onError(missingTargetMessage);
    return;
  }
  const layoutStore = useWorkspaceLayoutStore.getState();
  const layout = layoutStore.layoutByWorkspace[workspaceKey];
  const paneTarget = resolveCommandPaneTarget({
    serverId,
    commandTarget: command.target,
    paneTab: input.paneTab,
  });

  if (command.target === "terminal") {
    runTerminalCustomCommand({ command, client, workspaceKey, layout, paneTarget, onError });
    return;
  }

  const chat =
    paneTarget?.kind === "chat" ? paneTarget : resolveFocusedChatTarget({ serverId, layout });
  if (!chat) {
    onError(missingTargetMessage);
    return;
  }
  const agentId =
    paneTarget?.kind === "chat" ? paneTarget.agentId : resolveAgentIdForTab(layout, chat.tabId);

  // A draft tab has no agent yet, so there is nothing to send to — the text lands in the
  // composer for the user to submit, the same place a `submit: false` command goes.
  if (!command.submit || !agentId) {
    await useDraftStore
      .getState()
      .replaceDraftText({ draftKey: chat.draftKey, text: command.text });
    layoutStore.focusTab(workspaceKey, chat.tabId);
    return;
  }
  if (!client) {
    onError(i18n.t("common.errors.daemonClientUnavailable"));
    return;
  }

  // Send path only, out of the composer: the same wiring the host runtime uses to drain
  // queued messages, so a mounted input is never touched.
  const supportsForgeAttachments =
    useSessionStore.getState().sessions[serverId]?.serverInfo?.features?.forgeSearch === true;
  try {
    await dispatchComposerAgentMessage({
      client,
      agentId,
      text: command.text,
      attachments: [],
      attachmentSubmitFormat: resolveComposerAttachmentSubmitFormat({ supportsForgeAttachments }),
      encodeImages,
      submission: createMessageSubmissionWriter(serverId),
    });
  } catch (error) {
    onError(
      error instanceof Error ? error.message : i18n.t("workspace.commands.errors.sendFailed"),
    );
    return;
  }
  useDraftStore.getState().clearDraftInput({ draftKey: chat.draftKey, lifecycle: "sent" });
  layoutStore.focusTab(workspaceKey, chat.tabId);
}
