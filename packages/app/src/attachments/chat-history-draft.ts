import type {
  AgentForkContextOptions,
  DaemonClient,
} from "@getpaseo/client/internal/daemon-client";
import type { WorkspaceComposerAttachment } from "@/attachments/types";
import {
  buildDraftWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";

/** The one client call this needs, so callers can pass a narrow stub in tests. */
export type ChatHistoryDraftClient = Pick<DaemonClient, "buildAgentForkContext">;

/**
 * Boundary marking where the carried context should stop. Omit it entirely to
 * take the whole timeline *up to now* — including a partially streamed
 * in-flight turn. `selectForkContextRows` projects the full timeline when
 * neither field is present, which is what makes mid-run forking work.
 */
export type ChatHistoryDraftBoundary = Pick<
  AgentForkContextOptions,
  "boundaryCursor" | "boundaryMessageId"
>;

export interface SeedDraftChatHistoryInput {
  client: ChatHistoryDraftClient;
  serverId: string;
  agentId: string;
  draftId: string;
  boundary?: ChatHistoryDraftBoundary;
  /** Fork surfaces this in a toast; the provider switch never shows it. */
  missingAttachmentMessage?: string;
}

function buildChatHistoryAttachment(input: {
  draftId: string;
  serverId: string;
  agentId: string;
  payload: Awaited<ReturnType<ChatHistoryDraftClient["buildAgentForkContext"]>>;
  missingAttachmentMessage: string;
}): WorkspaceComposerAttachment {
  if (!input.payload.attachment) {
    throw new Error(input.missingAttachmentMessage);
  }
  return {
    kind: "chat_history",
    id: `chat_history:${input.draftId}`,
    attachment: input.payload.attachment,
    source: {
      serverId: input.serverId,
      agentId: input.agentId,
      boundaryMessageId: input.payload.boundaryMessageId,
      boundaryCursor: input.payload.boundaryCursor,
      itemCount: input.payload.itemCount,
    },
  };
}

/**
 * Fetches an agent's curated chat history and parks it on a draft's attachment
 * scope, so the draft's first prompt carries the conversation into whatever
 * provider that draft launches on. The daemon renders it as plain text, so the
 * receiving provider never has to be the one that produced it.
 *
 * Shared by Fork and by the provider switch, which is a fork that retires its
 * source. Requires the `agentForkContext` host feature.
 *
 * Returns false when the source had nothing to carry, leaving the draft clean.
 * The daemon still answers with an attachment there, whose body is the literal
 * "No chat history to display." — prepending that to the first prompt of an
 * agent switched before it was ever prompted is worse than sending nothing.
 */
export async function seedDraftChatHistory(input: SeedDraftChatHistoryInput): Promise<boolean> {
  const payload = await input.client.buildAgentForkContext(input.agentId, input.boundary);
  if (payload.itemCount === 0) {
    return false;
  }
  const attachment = buildChatHistoryAttachment({
    draftId: input.draftId,
    serverId: input.serverId,
    agentId: input.agentId,
    payload,
    missingAttachmentMessage: input.missingAttachmentMessage ?? "Chat history is unavailable.",
  });
  useWorkspaceAttachmentsStore.getState().setWorkspaceAttachments({
    scopeKey: buildDraftWorkspaceAttachmentScopeKey(input.draftId),
    attachments: [attachment],
  });
  return true;
}
