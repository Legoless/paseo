import type { CustomCommand } from "@getpaseo/protocol/custom-commands";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { dispatchComposerAgentMessage } from "@/composer/actions";
import { resolveComposerAttachmentSubmitFormat } from "@/composer/attachments/submit";
import { createMessageSubmissionWriter } from "@/composer/submission/writer";
import { encodeImages } from "@/utils/encode-images";
import { useDraftStore } from "@/stores/draft-store";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceDraftSubmissionStore } from "@/stores/workspace-draft-submission-store";
import { generateMessageId } from "@/types/stream";
import {
  collectAllTabs,
  findPaneById,
  useWorkspaceLayoutStore,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-store";
import {
  buildWorkspaceTabPersistenceKey,
  type WorkspaceDraftTabSetup,
  type WorkspaceTabTarget,
} from "@/workspace-tabs/model";
import { i18n } from "@/i18n/i18next";

interface CommandTab {
  tabId: string;
  target: WorkspaceTabTarget;
}

export interface RunCustomCommandInput {
  serverId: string;
  workspaceId: string;
  command: CustomCommand;
  client: DaemonClient | null;
  /**
   * The open tab in the pane whose button was pressed. Without it (a keyboard shortcut, or a
   * header button), the command runs in the focused pane's open tab.
   */
  paneTab?: CommandTab | null;
  /** Error surface — the toast api from whichever surface (menu or keyboard) triggered the run. */
  onError: (message: string) => void;
}

export type CommandTabTarget =
  | { kind: "terminal"; tabId: string; terminalId: string }
  | {
      kind: "chat";
      tabId: string;
      draftKey: string;
      agentId: string | null;
      draftId?: string;
      cwd?: string;
      setup?: WorkspaceDraftTabSetup;
    };

// The pane the workspace screen shows: an unfocused layout (a workspace marked unread) still
// displays its restore pane.
function resolveFocusedTab(
  layout: WorkspaceLayout | undefined,
  restorePaneId: string | null | undefined,
): CommandTab | null {
  if (!layout) {
    return null;
  }
  const paneId = layout.focusedPaneId ?? restorePaneId;
  const focusedTabId = findPaneById(layout.root, paneId)?.focusedTabId;
  return collectAllTabs(layout.root).find((tab) => tab.tabId === focusedTabId) ?? null;
}

/**
 * The tab a command runs in: the tab it was started from, whatever kind it is. A command's
 * `target` field is not consulted. Tabs that are not a chat or a terminal take no command.
 */
export function resolveCommandTabTarget(input: {
  serverId: string;
  layout: WorkspaceLayout | undefined;
  restorePaneId?: string | null;
  paneTab: RunCustomCommandInput["paneTab"];
}): CommandTabTarget | null {
  const tab = input.paneTab ?? resolveFocusedTab(input.layout, input.restorePaneId);
  switch (tab?.target.kind) {
    case "terminal":
      return { kind: "terminal", tabId: tab.tabId, terminalId: tab.target.terminalId };
    case "agent":
      return {
        kind: "chat",
        tabId: tab.tabId,
        draftKey: buildDraftStoreKey({ serverId: input.serverId, agentId: tab.target.agentId }),
        agentId: tab.target.agentId,
      };
    case "draft":
      return {
        kind: "chat",
        tabId: tab.tabId,
        draftKey: buildDraftStoreKey({
          serverId: input.serverId,
          agentId: tab.tabId,
          draftId: tab.target.draftId,
        }),
        agentId: null,
        draftId: tab.target.draftId,
        cwd: tab.target.cwd,
        setup: tab.target.setup,
      };
    default:
      return null;
  }
}

function enqueueDraftTabCommandSubmission(input: {
  serverId: string;
  workspaceId: string;
  commandText: string;
  target: Extract<CommandTabTarget, { kind: "chat" }>;
}): void {
  const { serverId, workspaceId, commandText, target } = input;
  useWorkspaceDraftSubmissionStore.getState().setPending({
    serverId,
    workspaceId,
    draftId: target.draftId ?? "",
    text: commandText.trim(),
    attachments: [],
    cwd: target.setup?.cwd ?? target.cwd ?? "",
    provider: target.setup?.provider,
    clientMessageId: generateMessageId(),
    timestamp: Date.now(),
    modeId: target.setup?.modeId ?? undefined,
    model: target.setup?.model ?? undefined,
    thinkingOptionId: target.setup?.thinkingOptionId ?? undefined,
    featureValues: target.setup?.featureValues,
    allowEmptyText: true,
  });
  useDraftStore.getState().clearDraftInput({ draftKey: target.draftKey, lifecycle: "sent" });
}

async function dispatchAgentCommandMessage(input: {
  client: DaemonClient;
  serverId: string;
  agentId: string;
  commandText: string;
}): Promise<void> {
  const supportsForgeAttachments =
    useSessionStore.getState().sessions[input.serverId]?.serverInfo?.features?.forgeSearch === true;
  await dispatchComposerAgentMessage({
    client: input.client,
    agentId: input.agentId,
    text: input.commandText,
    attachments: [],
    attachmentSubmitFormat: resolveComposerAttachmentSubmitFormat({ supportsForgeAttachments }),
    encodeImages,
    submission: createMessageSubmissionWriter(input.serverId),
  });
}

export async function runCustomCommand(input: RunCustomCommandInput): Promise<void> {
  const { serverId, workspaceId, command, client, onError } = input;
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const layoutStore = useWorkspaceLayoutStore.getState();
  const target = workspaceKey
    ? resolveCommandTabTarget({
        serverId,
        layout: layoutStore.layoutByWorkspace[workspaceKey],
        restorePaneId: layoutStore.focusRestorationByWorkspace[workspaceKey]?.restorePaneId,
        paneTab: input.paneTab,
      })
    : null;
  if (!workspaceKey || !target) {
    onError(i18n.t("workspace.commands.errors.noTarget"));
    return;
  }

  if (target.kind === "terminal") {
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

  if (!command.submit) {
    await useDraftStore
      .getState()
      .replaceDraftText({ draftKey: target.draftKey, text: command.text });
    layoutStore.focusTab(workspaceKey, target.tabId);
    return;
  }

  if (!client) {
    onError(i18n.t("common.errors.daemonClientUnavailable"));
    return;
  }

  // A draft tab has no running agent yet. If submit is requested, enqueue an auto-submit
  // so the draft creates the agent with the command's prompt; without draftId, fall back
  // to draft text replacement.
  if (!target.agentId) {
    if (!target.draftId) {
      await useDraftStore
        .getState()
        .replaceDraftText({ draftKey: target.draftKey, text: command.text });
    } else {
      enqueueDraftTabCommandSubmission({
        serverId,
        workspaceId,
        commandText: command.text,
        target,
      });
    }
    layoutStore.focusTab(workspaceKey, target.tabId);
    return;
  }

  // Send path only, out of the composer: the same wiring the host runtime uses to drain
  // queued messages, so a mounted input is never touched.
  try {
    await dispatchAgentCommandMessage({
      client,
      serverId,
      agentId: target.agentId,
      commandText: command.text,
    });
  } catch (error) {
    onError(
      error instanceof Error ? error.message : i18n.t("workspace.commands.errors.sendFailed"),
    );
    return;
  }
  useDraftStore.getState().clearDraftInput({ draftKey: target.draftKey, lifecycle: "sent" });
  layoutStore.focusTab(workspaceKey, target.tabId);
}
