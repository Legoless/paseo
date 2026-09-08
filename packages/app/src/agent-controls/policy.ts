import type {
  AgentFeatureSelect,
  AgentMode,
  AgentModelDefinition,
  AgentSelectOption,
} from "@getpaseo/protocol/agent-types";

export const PLAN_MODE_FEATURE_ID = "plan_mode";
export const FAST_MODE_FEATURE_ID = "fast_mode";

export function filterAgentModesForModel(
  modes: AgentMode[],
  model: AgentModelDefinition | null,
): AgentMode[] {
  const unsupported = model?.metadata?.unsupportedModeIds;
  if (!Array.isArray(unsupported) || unsupported.length === 0) return modes;
  return modes.filter((mode) => !unsupported.includes(mode.id));
}

export function resolveAgentModeForModel(input: {
  modeId: string;
  modes: AgentMode[];
  defaultModeId: string | null | undefined;
  model: AgentModelDefinition | null;
}): string {
  const unsupported = input.model?.metadata?.unsupportedModeIds;
  if (!Array.isArray(unsupported) || !unsupported.includes(input.modeId)) return input.modeId;
  const allowed = filterAgentModesForModel(input.modes, input.model);
  return allowed.find((mode) => mode.id === input.defaultModeId)?.id ?? allowed[0]?.id ?? "";
}

export function getAgentFeatureSelectOptions(feature: AgentFeatureSelect): AgentSelectOption[] {
  if (feature.value === null || feature.options.some((option) => option.id === feature.value)) {
    return feature.options;
  }
  return [{ id: feature.value, label: feature.value }, ...feature.options];
}

export function isPlanningAgentMode(mode: Pick<AgentMode, "id" | "colorTier">): boolean {
  return mode.colorTier === "planning" || mode.id === "plan" || mode.id.endsWith("#plan");
}

export function resolveNonPlanningModeId(
  modes: readonly AgentMode[],
  defaultModeId: string | null,
): string | null {
  const defaultMode = modes.find((mode) => mode.id === defaultModeId);
  if (defaultMode && !isPlanningAgentMode(defaultMode)) {
    return defaultMode.id;
  }
  return modes.find((mode) => !isPlanningAgentMode(mode))?.id ?? null;
}
