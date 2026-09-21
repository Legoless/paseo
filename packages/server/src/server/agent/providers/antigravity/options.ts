import type { ProviderOptions } from "@getpaseo/protocol/agent-types";
import { z } from "zod";

export const ANTIGRAVITY_EFFORT_IDS = ["low", "medium", "high"] as const;
export type AntigravityEffort = (typeof ANTIGRAVITY_EFFORT_IDS)[number];

const ANTIGRAVITY_EFFORT_LABELS: Record<AntigravityEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export const ANTIGRAVITY_EFFORT_OPTIONS = ANTIGRAVITY_EFFORT_IDS.map((id) => ({
  id,
  label: ANTIGRAVITY_EFFORT_LABELS[id],
}));

export const AntigravityProviderOptionsSchema = z
  .object({
    effort: z.enum(ANTIGRAVITY_EFFORT_IDS).optional(),
    sandbox: z.boolean().optional(),
    agent: z.string().min(1).optional(),
    addDir: z.array(z.string().min(1)).optional(),
  })
  .strict() satisfies z.ZodType<ProviderOptions>;

export type AntigravityProviderOptions = z.infer<typeof AntigravityProviderOptionsSchema>;

export function readAntigravityProviderOptions(
  options: ProviderOptions | undefined,
): AntigravityProviderOptions {
  if (options === undefined) return {};
  const parsed = AntigravityProviderOptionsSchema.safeParse(options);
  return parsed.success ? parsed.data : {};
}

export function normalizeAntigravityEffort(
  value: string | null | undefined,
): AntigravityEffort | null {
  if (value === "low" || value === "medium" || value === "high") return value;
  return null;
}
