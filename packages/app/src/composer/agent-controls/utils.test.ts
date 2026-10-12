import { describe, expect, it } from "vitest";
import type { AgentModelDefinition } from "@getpaseo/protocol/agent-types";
import { resolveThinkingOptionId } from "@/provider-selection/resolve-agent-form";
import {
  buildDraftCommandTarget,
  resolveEffectiveComposerThinkingOptionId,
} from "@/provider-selection/provider-selection";
import {
  formatDefaultThinkingLabel,
  getFeatureHighlightColor,
  getFeatureTooltip,
  getAgentControlHintKey,
  isFeatureActive,
  normalizeModelId,
  resolveAgentModelSelection,
} from "./utils";

describe("getAgentControlHintKey", () => {
  it("returns translation keys for each editable agent control hint", () => {
    expect(getAgentControlHintKey("thinking")).toBe("agentControls.hints.thinking");
    expect(getAgentControlHintKey("model")).toBe("agentControls.hints.model");
    expect(getAgentControlHintKey("mode")).toBe("agentControls.hints.mode");
  });
});

describe("feature metadata helpers", () => {
  it("prefers explicit feature tooltip copy", () => {
    expect(
      getFeatureTooltip({
        label: "Plan",
        tooltip: "Toggle plan mode",
      }),
    ).toBe("Toggle plan mode");
  });

  it("falls back to the feature label when no tooltip is provided", () => {
    expect(
      getFeatureTooltip({
        label: "Custom",
      }),
    ).toBe("Custom");
  });

  it("maps feature highlight colors by feature id", () => {
    expect(getFeatureHighlightColor("fast_mode")).toBe("yellow");
    expect(getFeatureHighlightColor("service_tier")).toBe("yellow");
    expect(getFeatureHighlightColor("plan_mode")).toBe("blue");
    expect(getFeatureHighlightColor("ultracode")).toBe("blue");
    expect(getFeatureHighlightColor("other")).toBe("default");
  });

  it("treats a select feature as active when a non-default option is selected", () => {
    const speed = {
      type: "select" as const,
      id: "service_tier",
      label: "Speed",
      options: [
        { id: "default", label: "Normal", isDefault: true },
        { id: "fast", label: "Fast" },
      ],
    };
    expect(isFeatureActive({ ...speed, value: "default" })).toBe(false);
    expect(isFeatureActive({ ...speed, value: "fast" })).toBe(true);
    expect(
      isFeatureActive({
        type: "toggle",
        id: "fast_mode",
        label: "Fast",
        value: true,
      }),
    ).toBe(true);
  });
});

describe("normalizeModelId", () => {
  it("treats empty values as unset", () => {
    expect(normalizeModelId("")).toBeNull();
    expect(normalizeModelId(undefined)).toBeNull();
  });

  it("returns trimmed model ids", () => {
    expect(normalizeModelId(" gpt-5.1-codex ")).toBe("gpt-5.1-codex");
    expect(normalizeModelId(" default ")).toBe("default");
  });
});

describe("formatDefaultThinkingLabel", () => {
  const options = [
    { id: "high", label: "High" },
    { id: "xhigh", label: "Extra high" },
  ];

  it("names the level the provider applies when no thinking option is chosen", () => {
    expect(formatDefaultThinkingLabel("Default", options, "xhigh")).toBe("Default · Extra high");
  });

  it("stays plain when the provider default is unknown or not offered", () => {
    expect(formatDefaultThinkingLabel("Default", options, undefined)).toBe("Default");
    expect(formatDefaultThinkingLabel("Default", options, "medium")).toBe("Default");
  });
});

describe("resolveAgentModelSelection", () => {
  it("inherits an unknown native effort default instead of selecting the first advertised level", () => {
    const model: AgentModelDefinition = {
      provider: "codex",
      id: "native-reasoning-vNext",
      label: "Future Model",
      thinkingOptions: [
        { id: "low", label: "Low" },
        { id: "high", label: "High" },
      ],
    };
    const thinkingOptionId = resolveThinkingOptionId({
      availableModels: [model],
      modelId: model.id,
      requestedThinkingOptionId: "",
    });
    expect(thinkingOptionId).toBe("");
    const display = resolveAgentModelSelection({
      models: [model],
      runtimeModelId: null,
      runtimeThinkingOptionId: null,
      configuredModelId: model.id,
      explicitThinkingOptionId: null,
    });
    expect(display.selectedThinkingId).toBeNull();
    expect(display.displayThinking).toBe("Default");
    const selection = {
      provider: model.provider,
      modelId: model.id,
      modeId: "",
      thinkingOptionId,
      availableModels: [model],
      modeOptions: [],
    };
    expect(
      buildDraftCommandTarget({
        selection,
        cwd: "/repo",
        effectiveModelId: model.id,
        effectiveThinkingOptionId: resolveEffectiveComposerThinkingOptionId(selection, model.id),
      }),
    ).toEqual({
      status: "ready",
      config: { provider: model.provider, cwd: "/repo", model: model.id },
    });
    expect(
      resolveThinkingOptionId({
        availableModels: [{ ...model, defaultThinkingOptionId: "high" }],
        modelId: model.id,
        requestedThinkingOptionId: "",
      }),
    ).toBe("high");
    expect(
      resolveThinkingOptionId({
        availableModels: [model],
        modelId: model.id,
        requestedThinkingOptionId: "low",
      }),
    ).toBe("low");
  });
  it("keeps the requested pin while using a moving native alias only for display metadata", () => {
    const model = {
      provider: "codex",
      id: "native-latest",
      aliases: ["native-pinned-v9"],
      label: "Future Model",
    };
    const selection = resolveAgentModelSelection({
      models: [model],
      runtimeModelId: "native-pinned-v9",
      runtimeThinkingOptionId: null,
      configuredModelId: "native-pinned-v9",
      explicitThinkingOptionId: null,
    });
    expect(selection.activeModelId).toBe("native-pinned-v9");
    expect(selection.selectedModel).toBe(model);
    expect(selection.displayModel).toBe("Future Model");
  });

  it("preserves unknown saved model and reasoning IDs through a stale catalog", () => {
    const selection = resolveAgentModelSelection({
      models: [{ id: "old-default", provider: "codex", label: "Old default", isDefault: true }],
      runtimeModelId: null,
      runtimeThinkingOptionId: null,
      configuredModelId: "future-model/native-alias",
      explicitThinkingOptionId: "future-effort",
    });
    expect(selection.activeModelId).toBe("future-model/native-alias");
    expect(selection.displayModel).toBe("future-model/native-alias");
    expect(selection.selectedThinkingId).toBe("future-effort");
    expect(selection.selectedModel).toBeNull();
  });

  it("uses alias metadata while preserving the configured model reference", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          provider: "claude",
          id: "claude-fable-5",
          aliases: ["claude-fable-5[1m]"],
          label: "Fable 5",
          thinkingOptions: [{ id: "high", label: "High" }],
          defaultThinkingOptionId: "high",
        },
      ],
      runtimeModelId: null,
      configuredModelId: "claude-fable-5[1m]",
      runtimeThinkingOptionId: null,
      explicitThinkingOptionId: null,
    });

    expect(selection.activeModelId).toBe("claude-fable-5[1m]");
    expect(selection.selectedModel?.id).toBe("claude-fable-5");
    expect(selection.displayModel).toBe("Fable 5");
    expect(selection.selectedThinkingId).toBe("high");
  });

  it("shows runtime metadata without replacing the configured request ID", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "codex",
          label: "Model A",
          thinkingOptions: [{ id: "low", label: "Low" }],
          defaultThinkingOptionId: "low",
        },
      ],
      runtimeModelId: "a",
      configuredModelId: "b",
      runtimeThinkingOptionId: null,
      explicitThinkingOptionId: null,
    });

    expect(selection.activeModelId).toBe("b");
    expect(selection.displayModel).toBe("Model A");
    expect(selection.selectedThinkingId).toBe("low");
  });

  it("uses explicit thinking option when provided", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "codex",
          label: "Model A",
          thinkingOptions: [
            { id: "low", label: "Low" },
            { id: "high", label: "High" },
          ],
          defaultThinkingOptionId: "low",
        },
      ],
      runtimeModelId: "a",
      configuredModelId: null,
      runtimeThinkingOptionId: null,
      explicitThinkingOptionId: "high",
    });

    expect(selection.selectedThinkingId).toBe("high");
    expect(selection.displayThinking).toBe("High");
  });

  it("shows the thinking level the agent runs on when none was chosen", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "openrouter/google/gemini-3.6-flash",
          provider: "pi",
          label: "Gemini 3.6 Flash",
          thinkingOptions: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium", isDefault: true },
            { id: "high", label: "High" },
          ],
          defaultThinkingOptionId: "medium",
        },
      ],
      runtimeModelId: "openrouter/google/gemini-3.6-flash",
      configuredModelId: null,
      runtimeThinkingOptionId: "high",
      explicitThinkingOptionId: null,
    });

    expect(selection.selectedThinkingId).toBe("high");
    expect(selection.displayThinking).toBe("High");
  });

  it("falls back to the chosen thinking level when the runtime level is not a model option", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "codex",
          label: "Model A",
          thinkingOptions: [
            { id: "low", label: "Low" },
            { id: "high", label: "High" },
          ],
          defaultThinkingOptionId: "low",
        },
      ],
      runtimeModelId: "a",
      configuredModelId: null,
      runtimeThinkingOptionId: "xhigh",
      explicitThinkingOptionId: "high",
    });

    expect(selection.selectedThinkingId).toBe("high");
  });

  it("formats raw thinking labels in the selected model display", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "claude",
          label: "Model A",
          thinkingOptions: [
            { id: "none", label: "none" },
            { id: "xhigh", label: "xhigh" },
          ],
        },
      ],
      runtimeModelId: "a",
      configuredModelId: null,
      runtimeThinkingOptionId: null,
      explicitThinkingOptionId: "xhigh",
    });

    expect(selection.selectedThinkingId).toBe("xhigh");
    expect(selection.displayThinking).toBe("Extra high");
  });

  it("falls back to the provider default model label instead of Auto", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "codex",
          label: "Model A",
          isDefault: true,
          thinkingOptions: [{ id: "low", label: "Low" }],
          defaultThinkingOptionId: "low",
        },
      ],
      runtimeModelId: null,
      configuredModelId: null,
      runtimeThinkingOptionId: null,
      explicitThinkingOptionId: null,
    });

    expect(selection.displayModel).toBe("Model A");
    expect(selection.displayThinking).toBe("Low");
  });

  it("prefers the configured model when runtime model is not in the model list", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "default",
          provider: "claude",
          label: "Default (Sonnet 4.6)",
          isDefault: true,
          thinkingOptions: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
          ],
        },
      ],
      runtimeModelId: "claude-sonnet-4-6-20260101",
      configuredModelId: "default",
      runtimeThinkingOptionId: null,
      explicitThinkingOptionId: null,
    });

    expect(selection.activeModelId).toBe("default");
    expect(selection.displayModel).toBe("Default (Sonnet 4.6)");
    expect(selection.selectedThinkingId).toBeNull();
    expect(selection.displayThinking).toBe("Default");
  });

  it("shows the agent's own model when the catalog does not list it", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "gpt-6-sol",
          provider: "codex",
          label: "GPT-6-Sol",
          isDefault: true,
          thinkingOptions: [
            { id: "medium", label: "medium" },
            { id: "max", label: "max" },
          ],
          defaultThinkingOptionId: "medium",
        },
      ],
      runtimeModelId: "gpt-6.1-sol",
      configuredModelId: "gpt-6.1-sol",
      runtimeThinkingOptionId: null,
      explicitThinkingOptionId: "max",
    });

    expect(selection.selectedModel).toBeNull();
    expect(selection.activeModelId).toBe("gpt-6.1-sol");
    expect(selection.displayModel).toBe("gpt-6.1-sol");
    expect(selection.displayThinking).toBe("Max");
  });
});
