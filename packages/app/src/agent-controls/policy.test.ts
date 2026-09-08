import { describe, expect, it } from "vitest";
import type { AgentMode } from "@getpaseo/protocol/agent-types";
import {
  filterAgentModesForModel,
  getAgentFeatureSelectOptions,
  isPlanningAgentMode,
  resolveAgentModeForModel,
  resolveNonPlanningModeId,
} from "./policy";
import { findModelByReference } from "@/provider-selection/model-catalog";
import { buildDraftCommandConfig } from "@/provider-selection/provider-selection";

it("filters only native model mode exclusions, including when selected by alias", () => {
  const modes = [
    { id: "default", label: "Default" },
    { id: "auto", label: "Auto" },
    { id: "future-mode", label: "Future mode" },
  ];
  const model = {
    provider: "future-provider",
    id: "native-future-v9",
    label: "Future Model",
    aliases: ["native-future-alias"],
    metadata: { unsupportedModeIds: ["auto"] },
  };
  expect(
    filterAgentModesForModel(modes, findModelByReference([model], "native-future-alias")),
  ).toEqual([modes[0], modes[2]]);
  expect(
    filterAgentModesForModel(modes, {
      ...model,
      metadata: { unsupportedModeIds: ["future-mode"] },
    }),
  ).toEqual([modes[0], modes[1]]);
  expect(filterAgentModesForModel(modes, { ...model, metadata: {} })).toBe(modes);
  const savedModeId = "auto";
  const unsupportedModeId = resolveAgentModeForModel({
    modeId: savedModeId,
    modes,
    defaultModeId: "future-mode",
    model,
  });
  expect(unsupportedModeId).toBe("future-mode");
  expect(
    resolveAgentModeForModel({ modeId: savedModeId, modes, defaultModeId: "auto", model }),
  ).toBe("default");
  expect(
    buildDraftCommandConfig({
      selection: {
        provider: model.provider,
        modelId: model.id,
        modeId: unsupportedModeId,
        thinkingOptionId: "",
        availableModels: [model],
        modeOptions: filterAgentModesForModel(modes, model),
      },
      cwd: "/repo",
      effectiveModelId: model.id,
      effectiveThinkingOptionId: "",
    }),
  ).toEqual({ provider: model.provider, cwd: "/repo", model: model.id, modeId: "future-mode" });
  const supportedModel = { ...model, metadata: { unsupportedModeIds: [] } };
  const restoredModeId = resolveAgentModeForModel({
    modeId: savedModeId,
    modes,
    defaultModeId: "future-mode",
    model: supportedModel,
  });
  expect(restoredModeId).toBe("auto");
  expect(
    buildDraftCommandConfig({
      selection: {
        provider: model.provider,
        modelId: model.id,
        modeId: restoredModeId,
        thinkingOptionId: "",
        availableModels: [supportedModel],
        modeOptions: modes,
      },
      cwd: "/repo",
      effectiveModelId: model.id,
      effectiveThinkingOptionId: "",
    })?.modeId,
  ).toBe("auto");
});

describe("getAgentFeatureSelectOptions", () => {
  it("keeps native tier IDs, labels and descriptions including Standard's empty ID", () => {
    const options = [
      { id: "", label: "Standard", description: "Native default" },
      { id: "future/priority_v7", label: "Ultra PRO", description: "Native fast lane" },
    ];
    expect(
      getAgentFeatureSelectOptions({
        type: "select",
        id: "service_tier",
        label: "Speed",
        value: null,
        options,
      }),
    ).toBe(options);
    expect(
      getAgentFeatureSelectOptions({
        type: "select",
        id: "service_tier",
        label: "Speed",
        value: "saved-tier",
        options,
      }),
    ).toEqual([{ id: "saved-tier", label: "saved-tier" }, ...options]);
  });
});

describe("isPlanningAgentMode", () => {
  it("prefers planning metadata and recognizes existing provider ids", () => {
    expect(isPlanningAgentMode({ id: "research", colorTier: "planning" })).toBe(true);
    expect(isPlanningAgentMode({ id: "plan" })).toBe(true);
    expect(
      isPlanningAgentMode({
        id: "https://agentclientprotocol.com/protocol/session-modes#plan",
      }),
    ).toBe(true);
    expect(isPlanningAgentMode({ id: "default", colorTier: "safe" })).toBe(false);
  });
});

describe("resolveNonPlanningModeId", () => {
  const modes = [
    { id: "plan", label: "Plan", colorTier: "planning" },
    { id: "default", label: "Default", colorTier: "safe" },
    { id: "full", label: "Full", colorTier: "dangerous" },
  ] satisfies AgentMode[];

  it("uses a non-planning provider default", () => {
    expect(resolveNonPlanningModeId(modes, "full")).toBe("full");
  });

  it("does not use a planning or stale provider default", () => {
    expect(resolveNonPlanningModeId(modes, "plan")).toBe("default");
    expect(resolveNonPlanningModeId(modes, "deleted")).toBe("default");
  });

  it("returns null when no non-planning mode exists", () => {
    expect(resolveNonPlanningModeId([modes[0]], "plan")).toBeNull();
  });
});
