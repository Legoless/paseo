import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import type { Agent } from "@/stores/session-store";
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

export function buildProviderSwitchDraftSetup(input: {
  cwd: string;
  provider: AgentProvider;
  model: string;
}): WorkspaceDraftTabSetup {
  return {
    provider: input.provider,
    cwd: input.cwd,
    modeId: null,
    model: input.model,
    thinkingOptionId: null,
    featureValues: {},
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
}

export async function replaceOpenAgentWithDraft(
  input: ReplaceOpenAgentWithDraftInput,
): Promise<void> {
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
  await input.archiveAgent({ serverId: input.serverId, agentId: input.agentId });
}
