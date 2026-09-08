import { z } from "zod";
import type { AgentFeature, AgentFeatureToggle, AgentModelDefinition } from "../agent-sdk-types.js";

export const CodexServiceTierSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
});

export type CodexServiceTier = z.infer<typeof CodexServiceTierSchema>;

const CodexModelFeatureMetadataSchema = z.object({
  serviceTiers: z.array(CodexServiceTierSchema).optional().default([]),
  defaultServiceTier: z.string().nullable().optional().default(null),
});

export function codexModelFeatureMetadata(model: AgentModelDefinition | undefined) {
  return CodexModelFeatureMetadataSchema.parse(model?.metadata ?? {});
}

export const CODEX_PLAN_MODE_FEATURE: Omit<AgentFeatureToggle, "value"> = {
  type: "toggle",
  id: "plan_mode",
  label: "Plan",
  description: "Switch Codex into planning-only collaboration mode",
  tooltip: "Toggle plan mode",
  icon: "list-todo",
};

export function resolveCodexServiceTier(input: {
  featureValues: Record<string, unknown> | undefined;
  serviceTiers: CodexServiceTier[];
}): string | null {
  const selected = input.featureValues?.service_tier;
  if (typeof selected === "string") {
    return input.serviceTiers.some((tier) => tier.id === selected) ? selected : null;
  }
  // COMPAT(codexFastMode): added in v0.7.0, remove after 2027-03-08.
  // Old saved agents/profiles stored a boolean; only an advertised tier can replace it.
  if (input.featureValues?.fast_mode === true) {
    const fast =
      input.serviceTiers.find((tier) => tier.id === "priority") ??
      input.serviceTiers.find((tier) => tier.name.toLowerCase() === "fast");
    return fast?.id ?? null;
  }
  return null;
}

export function buildCodexFeatures(input: {
  serviceTiers: CodexServiceTier[];
  serviceTier: string | null;
  planModeEnabled: boolean;
  planModeAvailable?: boolean;
}): AgentFeature[] {
  const features: AgentFeature[] = [];
  if (input.serviceTiers.length > 0) {
    features.push({
      type: "select",
      id: "service_tier",
      label: "Speed",
      tooltip: "Select inference speed",
      icon: "zap",
      value: input.serviceTier ?? "",
      options: [
        { id: "", label: "Default" },
        ...input.serviceTiers.map((tier) => ({
          id: tier.id,
          label: tier.name,
          ...(tier.description ? { description: tier.description } : {}),
        })),
      ],
    });
  }
  if (input.planModeAvailable !== false) {
    features.push({ ...CODEX_PLAN_MODE_FEATURE, value: input.planModeEnabled });
  }
  return features;
}
