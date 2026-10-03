import { InitialPromptFailedError } from "@getpaseo/client/internal/daemon-client";
import { resolveSubmissionReadiness } from "@/provider-selection/provider-selection";

export interface WorkspaceDraftAutoSubmitConfig {
  provider: string | null;
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
 * A failed first prompt leaves an agent that holds nothing but the failure. The draft keeps the
 * user's text and attachments for the next send, so that empty agent is archived instead of
 * lingering in the sidebar beside the retry. Archiving is best effort: the retry must not wait
 * on it or fail because of it.
 */
export async function archiveAgentLeftByFailedPrompt(
  error: unknown,
  archiveAgent: (agentId: string) => Promise<unknown>,
): Promise<void> {
  if (!(error instanceof InitialPromptFailedError)) return;
  try {
    await archiveAgent(error.agentId);
  } catch (archiveError) {
    console.warn(
      "[WorkspaceDraft] failed to archive the agent left by a failed prompt",
      archiveError,
    );
  }
}
