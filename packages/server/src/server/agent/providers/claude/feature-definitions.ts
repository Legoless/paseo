import type {
  AgentFeature,
  AgentFeatureToggle,
  AgentModelDefinition,
  AgentSessionConfig,
} from "../../agent-sdk-types.js";
import {
  CLAUDE_ULTRACODE_FLAG_MIN_VERSION,
  CLAUDE_ULTRACODE_THINKING_OPTION_ID,
  claudeCodeVersionAtLeast,
  claudeModelCapability,
} from "./models.js";

export const CLAUDE_FAST_MODE_FEATURE: Omit<AgentFeatureToggle, "value"> = {
  type: "toggle",
  id: "fast_mode",
  label: "Fast",
  description: "Lower latency responses at higher token cost",
  tooltip: "Toggle fast mode",
  icon: "zap",
};

export const CLAUDE_ULTRACODE_FEATURE: Omit<AgentFeatureToggle, "value"> = {
  type: "toggle",
  id: "ultracode",
  label: "Ultra Code",
  description: "Multi-agent dynamic workflow orchestration",
  tooltip: "Toggle Ultra Code",
  icon: "sparkles",
};

export function claudeModelSupportsFastMode(model: AgentModelDefinition | undefined): boolean {
  return claudeModelCapability(model, "supportsFastMode");
}

/** Claude Code 2.1.284+ runs ultracode at any effort, so Paseo offers it as a toggle. */
function claudeUltracodeIsFlag(model: AgentModelDefinition | undefined): boolean {
  const version = model?.metadata?.claudeCodeVersion;
  return claudeCodeVersionAtLeast(
    typeof version === "string" ? version : null,
    CLAUDE_ULTRACODE_FLAG_MIN_VERSION,
  );
}

export function claudeModelSupportsUltracode(model: AgentModelDefinition | undefined): boolean {
  if (!claudeUltracodeIsFlag(model)) {
    return false;
  }
  const native = model?.metadata?.claude;
  if (
    native &&
    typeof native === "object" &&
    Array.isArray((native as { supportedEffortLevels?: unknown }).supportedEffortLevels)
  ) {
    return (native as { supportedEffortLevels: string[] }).supportedEffortLevels.includes("xhigh");
  }
  return model?.thinkingOptions?.some((opt) => opt.id === "xhigh") ?? false;
}

/** The ultracode setting Paseo sends to Claude; null leaves it to Claude's own settings. */
export function resolveClaudeUltracode(
  model: AgentModelDefinition | undefined,
  config: Pick<AgentSessionConfig, "thinkingOptionId" | "featureValues">,
): boolean | null {
  const legacyThinking = config.thinkingOptionId === CLAUDE_ULTRACODE_THINKING_OPTION_ID;
  if (!claudeUltracodeIsFlag(model)) {
    // An off chosen while the host ran 2.1.284+ still holds if the host looks older later.
    return legacyThinking ? config.featureValues?.ultracode !== false : null;
  }
  if (!claudeModelSupportsUltracode(model)) {
    return null;
  }
  const explicit = config.featureValues?.ultracode;
  if (typeof explicit === "boolean") {
    return explicit;
  }
  // COMPAT(claudeUltracodeThinking): added in v0.9.2, remove after 2027-03-29. Agents saved with
  // the "ultracode" thinking option keep xhigh effort plus ultracode until toggled off.
  return legacyThinking ? true : null;
}

export function buildClaudeFeatures(input: {
  model: AgentModelDefinition | undefined;
  config: Pick<AgentSessionConfig, "thinkingOptionId" | "featureValues">;
}): AgentFeature[] {
  const features: AgentFeature[] = [];
  if (claudeModelSupportsFastMode(input.model)) {
    features.push({
      ...CLAUDE_FAST_MODE_FEATURE,
      value: input.config.featureValues?.fast_mode === true,
    });
  }
  if (claudeModelSupportsUltracode(input.model)) {
    const value =
      resolveClaudeUltracode(input.model, input.config) ??
      input.model?.metadata?.settingsUltracode === true;
    features.push({ ...CLAUDE_ULTRACODE_FEATURE, value });
  }
  return features;
}
