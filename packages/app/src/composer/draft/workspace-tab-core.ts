import { resolveSubmissionReadiness } from "@/provider-selection/provider-selection";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import type { WorkspaceDraftTabSetup } from "@/workspace-tabs/model";

export interface WorkspaceDraftAutoSubmitConfig {
  provider: string;
  model: string | null;
}

export function shouldAllowEmptyDraftText(input: {
  allowsEmptyAutoSubmit: boolean;
  attachments: readonly unknown[];
}): boolean {
  return input.allowsEmptyAutoSubmit || input.attachments.length > 0;
}

export function validateDraftSubmission(input: {
  text: string;
  allowsEmptyAutoSubmit: boolean;
  composerState: {
    providerDefinitions: unknown[];
    selectedProvider: string | null;
    isModelLoading: boolean;
    effectiveModelId: string | null;
    availableModels: unknown[];
  };
  autoSubmitConfig: WorkspaceDraftAutoSubmitConfig | null;
  workspaceDirectory: string | null;
  hasClient: boolean;
}): string | null {
  const {
    text,
    allowsEmptyAutoSubmit,
    composerState,
    autoSubmitConfig,
    workspaceDirectory,
    hasClient,
  } = input;
  const readiness = resolveSubmissionReadiness({
    text,
    allowsEmptyAutoSubmit,
    providerCount: composerState.providerDefinitions.length,
    selection: {
      provider: composerState.selectedProvider,
      modelId: composerState.effectiveModelId ?? "",
      availableModels: composerState.availableModels,
      isModelLoading: composerState.isModelLoading,
    },
    autoSubmitConfig,
    workspaceDirectory,
    hasClient,
  });
  return readiness.ok ? null : (readiness.reason ?? null);
}

/**
 * Produces the draft tab setup for a cwd change from the draft's project picker.
 * An existing setup keeps every field but the cwd; a draft without one snapshots
 * the composer's current selections so the tab target stays the source of truth
 * for the draft's working directory. Returns null when there is no provider to
 * pin yet (the form has not resolved one), leaving the pick unavailable.
 */
export function buildDraftSetupWithCwd(input: {
  currentSetup: WorkspaceDraftTabSetup | null;
  cwd: string;
  provider?: AgentProvider | null;
  modeId?: string | null;
  model?: string | null;
  thinkingOptionId?: string | null;
  featureValues?: Record<string, unknown> | undefined;
}): WorkspaceDraftTabSetup | null {
  if (input.currentSetup) {
    return { ...input.currentSetup, cwd: input.cwd };
  }
  if (!input.provider) {
    return null;
  }
  return {
    provider: input.provider,
    cwd: input.cwd,
    modeId: input.modeId ?? null,
    model: input.model ?? null,
    thinkingOptionId: input.thinkingOptionId ?? null,
    featureValues: input.featureValues ?? {},
  };
}
