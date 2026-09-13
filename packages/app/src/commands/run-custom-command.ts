import type { CustomCommand } from "@getpaseo/protocol/custom-commands";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { resolveFocusedChatTarget } from "@/composer/focused-chat-target";
import { resolveFocusedTerminalTarget } from "@/composer/focused-terminal-target";
import { dispatchComposerAgentMessage } from "@/composer/actions";
import { resolveComposerAttachmentSubmitFormat } from "@/composer/attachments/submit";
import { createMessageSubmissionWriter } from "@/composer/submission/writer";
import { encodeImages } from "@/utils/encode-images";
import { useDraftStore } from "@/stores/draft-store";
import { useSessionStore } from "@/stores/session-store";
import {
  collectAllTabs,
  useWorkspaceLayoutStore,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { i18n } from "@/i18n/i18next";

export interface RunCustomCommandInput {
  serverId: string;
  workspaceId: string;
  command: CustomCommand;
  client: DaemonClient | null;
  /** Error surface — the toast api from whichever surface (menu or keyboard) triggered the run. */
  onError: (message: string) => void;
}

function resolveAgentIdForTab(layout: WorkspaceLayout | undefined, tabId: string): string | null {
  if (!layout) {
    return null;
  }
  const tab = collectAllTabs(layout.root).find((candidate) => candidate.tabId === tabId);
  return tab?.target.kind === "agent" ? tab.target.agentId : null;
}

export async function runCustomCommand(input: RunCustomCommandInput): Promise<void> {
  const { serverId, workspaceId, command, client, onError } = input;
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  if (!workspaceKey) {
    return;
  }
  const layoutStore = useWorkspaceLayoutStore.getState();
  const layout = layoutStore.layoutByWorkspace[workspaceKey];

  if (command.target === "terminal") {
    const target = resolveFocusedTerminalTarget({ layout });
    if (!target) {
      onError(i18n.t("workspace.commands.errors.noTerminalTarget"));
      return;
    }
    if (!client) {
      onError(i18n.t("common.errors.daemonClientUnavailable"));
      return;
    }
    client.sendTerminalInput(target.terminalId, {
      type: "input",
      data: command.text + (command.submit ? "\r" : ""),
    });
    layoutStore.focusTab(workspaceKey, target.tabId);
    return;
  }

  const chat = resolveFocusedChatTarget({ serverId, layout });
  if (!chat) {
    onError(i18n.t("workspace.commands.errors.noAgentTarget"));
    return;
  }
  const agentId = resolveAgentIdForTab(layout, chat.tabId);

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
