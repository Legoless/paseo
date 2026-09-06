import { describe, expect, it } from "vitest";
import type { AgentModelDefinition, ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { buildLiveAgentModelSelectorProviders, resolveLiveAgentModelPick } from "./live-model-pick";

function snapshotEntry(
  overrides: Partial<ProviderSnapshotEntry> & Pick<ProviderSnapshotEntry, "provider">,
): ProviderSnapshotEntry {
  const model: AgentModelDefinition = {
    provider: overrides.provider,
    id: `${overrides.provider}-model`,
    label: `${overrides.provider} model`,
  };
  return {
    provider: overrides.provider,
    status: overrides.status ?? "ready",
    enabled: overrides.enabled ?? true,
    label: overrides.label ?? overrides.provider,
    description: overrides.description ?? `${overrides.provider} provider`,
    defaultModeId: overrides.defaultModeId ?? "default",
    modes: overrides.modes ?? [],
    models: overrides.models ?? [model],
  };
}

describe("resolveLiveAgentModelPick", () => {
  it("keeps a same-provider pick as a live model change", () => {
    expect(
      resolveLiveAgentModelPick({
        currentProvider: "cursor",
        nextProvider: "cursor",
        modelId: "gpt-5",
      }),
    ).toEqual({ kind: "set-model", modelId: "gpt-5" });
  });

  it("restarts when the pick is a different provider", () => {
    expect(
      resolveLiveAgentModelPick({
        currentProvider: "cursor",
        nextProvider: "grok",
        modelId: "grok-4",
      }),
    ).toEqual({ kind: "restart", provider: "grok", modelId: "grok-4" });
  });
});

describe("buildLiveAgentModelSelectorProviders", () => {
  it("lists every enabled snapshot provider on a live agent", () => {
    const providers = buildLiveAgentModelSelectorProviders({
      snapshotEntries: [
        snapshotEntry({ provider: "claude", label: "Claude Code" }),
        snapshotEntry({ provider: "cursor", label: "Cursor" }),
        snapshotEntry({ provider: "grok", label: "Grok", enabled: false }),
      ],
      snapshotSelectedEntry: snapshotEntry({ provider: "cursor", label: "Cursor" }),
      providerDefinitions: [],
      modelsByProvider: new Map(),
    });

    expect(providers.map((provider) => provider.id)).toEqual(["claude", "cursor"]);
  });

  it("falls back to the running provider when the snapshot is empty", () => {
    const selected = snapshotEntry({ provider: "cursor", label: "Cursor" });
    const providers = buildLiveAgentModelSelectorProviders({
      snapshotEntries: undefined,
      snapshotSelectedEntry: selected,
      providerDefinitions: [],
      modelsByProvider: new Map(),
    });

    expect(providers.map((provider) => provider.id)).toEqual(["cursor"]);
  });
});
