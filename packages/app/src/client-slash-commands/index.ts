import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import {
  type ChatHistoryDraftClient,
  seedDraftChatHistory,
} from "@/attachments/chat-history-draft";
import { type Agent, useSessionStore } from "@/stores/session-store";
import {
  buildWorkspaceTabPersistenceKey,
  type WorkspaceDraftTabSetup,
  type WorkspaceTabTarget,
} from "@/workspace-tabs/model";

export type ClientSlashCommandKind = "archive-agent" | "replace-agent-with-draft";
export type ClientSlashCommandExecution = "immediate" | "insert";

export interface ClientSlashCommand {
  name: string;
  aliases: readonly string[];
  description: string;
  descriptionKey: "composer.clientCommands.archiveAgent" | "composer.clientCommands.freshDraft";
  argumentHint: string;
  kind: ClientSlashCommandKind;
  execution: ClientSlashCommandExecution;
}

export const CLIENT_SLASH_COMMANDS: readonly ClientSlashCommand[] = [
  {
    name: "exit",
    aliases: ["quit", "q"],
    description: "Archive the current agent",
    descriptionKey: "composer.clientCommands.archiveAgent",
    argumentHint: "",
    kind: "archive-agent",
    execution: "immediate",
  },
  {
    name: "clear",
    aliases: ["new"],
    description: "Archive this agent and start a fresh draft",
    descriptionKey: "composer.clientCommands.freshDraft",
    argumentHint: "",
    kind: "replace-agent-with-draft",
    execution: "immediate",
  },
];

const COMMAND_BY_NAME = new Map<string, ClientSlashCommand>();
for (const command of CLIENT_SLASH_COMMANDS) {
  COMMAND_BY_NAME.set(command.name, command);
  for (const alias of command.aliases) {
    COMMAND_BY_NAME.set(alias, command);
  }
}

export function resolveClientSlashCommand(input: {
  text: string;
  hasAttachments: boolean;
}): ClientSlashCommand | null {
  if (input.hasAttachments) {
    return null;
  }

  const trimmed = input.text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const commandName = trimmed.slice(1);
  if (!commandName || /\s/.test(commandName)) {
    return null;
  }

  return COMMAND_BY_NAME.get(commandName) ?? null;
}

export function buildDraftAgentSetup(agent: Agent): WorkspaceDraftTabSetup {
  const featureValues: Record<string, unknown> = {};
  for (const feature of agent.features ?? []) {
    featureValues[feature.id] = feature.value;
  }

  return {
    provider: agent.provider,
    cwd: agent.cwd,
    modeId: agent.currentModeId ?? agent.runtimeInfo?.modeId ?? null,
    model: agent.model ?? agent.runtimeInfo?.model ?? null,
    thinkingOptionId: agent.thinkingOptionId ?? agent.runtimeInfo?.thinkingOptionId ?? null,
    featureValues,
  };
}

/**
 * Seeds the draft that replaces an agent when its provider changes. A model row
 * carries only a model; an agent profile also carries mode, thinking and
 * features, and blank means "leave it to the new provider's defaults".
 */
export function buildProviderSwitchDraftSetup(input: {
  cwd: string;
  provider: AgentProvider;
  model: string;
  modeId?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
}): WorkspaceDraftTabSetup {
  return {
    provider: input.provider,
    cwd: input.cwd,
    modeId: input.modeId || null,
    model: input.model || null,
    thinkingOptionId: input.thinkingOptionId || null,
    featureValues: input.featureValues ?? {},
  };
}

export interface ReplaceOpenAgentWithDraftInput {
  serverId: string;
  agentId: string;
  workspaceId: string;
  setup: WorkspaceDraftTabSetup;
  draftId: string;
  retargetCurrentTab: (target: WorkspaceTabTarget) => void;
  unpinWorkspaceAgent: (workspaceKey: string, agentId: string) => void;
  hideWorkspaceAgent: (workspaceKey: string, agentId: string) => void;
  archiveAgent: (input: { serverId: string; agentId: string }) => Promise<unknown>;
  /**
   * Runs once the tab already shows the replacement draft and before the source
   * agent is archived — the only window where the replacement exists and the
   * source is still readable. Archiving closes the runtime and discards the
   * retained timeline, so anything that reads the source has to happen here.
   */
  beforeArchive?: () => Promise<void>;
}

export async function replaceOpenAgentWithDraft(
  input: ReplaceOpenAgentWithDraftInput,
): Promise<void> {
  const sync = useSessionStore.getState().sessions[input.serverId]?.viewedTimelineSync;
  sync?.evictAgent?.(input.agentId);

  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (workspaceKey) {
    input.unpinWorkspaceAgent(workspaceKey, input.agentId);
    input.hideWorkspaceAgent(workspaceKey, input.agentId);
  }
  input.retargetCurrentTab({
    kind: "draft",
    draftId: input.draftId,
    setup: input.setup,
  });
  await input.beforeArchive?.();
  try {
    await input.archiveAgent({ serverId: input.serverId, agentId: input.agentId });
  } catch (error) {
    console.warn("[replaceOpenAgentWithDraft] failed to archive old agent", error);
  }
}

// `beforeArchive` is this function's own mechanism for reading the source before
// it goes, so a caller cannot supply one for it to silently discard.
export interface SwitchAgentProviderToDraftInput extends Omit<
  ReplaceOpenAgentWithDraftInput,
  "beforeArchive"
> {
  /**
   * Fetches the retiring agent's chat history. Null switches without it — a
   * host predating the `agentForkContext` feature, or a caller that wants the
   * replacement to start clean the way `/clear` does.
   */
  chatHistoryClient: ChatHistoryDraftClient | null;
}

/** What became of the source agent's conversation. "skipped" means there was none to carry. */
export type ChatHistoryCarryOutcome = "carried" | "skipped" | "failed";

/**
 * Switching provider is the one moment a conversation outlives the process that
 * held it: the reason to switch mid-task — a spent quota — is not a reason to
 * retell the task. The history rides over as the replacement draft's chat-history
 * attachment, the same plain-text one Fork builds, so the new provider reads it
 * without either side knowing the other's transcript format. It lands as a
 * composer chip, so a switch meant as a clean start is one tap from being one.
 *
 * The switch itself never fails on the history: being stranded on the provider
 * you are trying to leave is worse than arriving without your notes. The caller
 * gets the outcome instead, because a user who believes the context came along
 * when it did not is the one person this feature must not create.
 */
export async function switchAgentProviderToDraft(
  input: SwitchAgentProviderToDraftInput,
): Promise<ChatHistoryCarryOutcome> {
  const { chatHistoryClient, ...replace } = input;
  let outcome: ChatHistoryCarryOutcome = "skipped";
  await replaceOpenAgentWithDraft({
    ...replace,
    beforeArchive: chatHistoryClient
      ? async () => {
          try {
            outcome = (await seedDraftChatHistory({
              client: chatHistoryClient,
              serverId: input.serverId,
              agentId: input.agentId,
              draftId: input.draftId,
            }))
              ? "carried"
              : "skipped";
          } catch (error) {
            console.warn("[switchAgentProviderToDraft] failed to carry chat history", error);
            outcome = "failed";
          }
        }
      : undefined,
  });
  return outcome;
}
