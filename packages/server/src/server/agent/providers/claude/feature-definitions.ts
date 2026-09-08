import type {
  AgentFeature,
  AgentFeatureToggle,
  AgentModelDefinition,
} from "../../agent-sdk-types.js";
import { claudeModelCapability } from "./models.js";

export const CLAUDE_FAST_MODE_FEATURE: Omit<AgentFeatureToggle, "value"> = {
  type: "toggle",
  id: "fast_mode",
  label: "Fast",
  description: "Lower latency responses at higher token cost",
  tooltip: "Toggle fast mode",
  icon: "zap",
};

export function claudeModelSupportsFastMode(model: AgentModelDefinition | undefined): boolean {
  return claudeModelCapability(model, "supportsFastMode");
}

export function buildClaudeFeatures(input: {
  model: AgentModelDefinition | undefined;
  fastModeEnabled: boolean;
}): AgentFeature[] {
  return claudeModelSupportsFastMode(input.model)
    ? [{ ...CLAUDE_FAST_MODE_FEATURE, value: input.fastModeEnabled }]
    : [];
}
