import type { AgentModelDefinition, ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { AgentProviderDefinition } from "@getpaseo/protocol/provider-manifest";
import {
  buildProviderSelectorProviders,
  buildSelectableProviderSelectorProviders,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";

export type LiveAgentModelPick =
  | { kind: "set-model"; modelId: string }
  | { kind: "restart"; provider: string; modelId: string };

export function resolveLiveAgentModelPick(input: {
  currentProvider: string;
  nextProvider: string;
  modelId: string;
}): LiveAgentModelPick {
  if (input.nextProvider === input.currentProvider) {
    return { kind: "set-model", modelId: input.modelId };
  }
  return { kind: "restart", provider: input.nextProvider, modelId: input.modelId };
}

export function buildLiveAgentModelSelectorProviders(input: {
  snapshotEntries: ProviderSnapshotEntry[] | undefined;
  snapshotSelectedEntry: ProviderSnapshotEntry | null;
  providerDefinitions: AgentProviderDefinition[];
  modelsByProvider: Map<string, AgentModelDefinition[]>;
}): ProviderSelectorProvider[] {
  if (input.snapshotEntries && input.snapshotEntries.length > 0) {
    return buildSelectableProviderSelectorProviders(input.snapshotEntries);
  }
  if (input.snapshotSelectedEntry) {
    return buildSelectableProviderSelectorProviders([input.snapshotSelectedEntry]);
  }
  return buildProviderSelectorProviders({
    providerDefinitions: input.providerDefinitions,
    modelsByProvider: input.modelsByProvider,
  });
}
