import type { AgentProvider } from "./agent-sdk-types.js";

/**
 * Thrown when a persisted provider session or its transcript no longer exists
 * (for example, pruned by provider cleanup or deleted on disk), so history
 * cannot be loaded and the session cannot be resumed.
 */
export class PersistedSessionMissingError extends Error {
  readonly provider: AgentProvider;
  readonly sessionId: string;
  readonly historyPath?: string;

  constructor(input: {
    provider: AgentProvider;
    sessionId: string;
    historyPath?: string;
    message?: string;
    cause?: unknown;
  }) {
    super(
      input.message ??
        `Persisted ${input.provider} session ${input.sessionId} is no longer available`,
      input.cause !== undefined ? { cause: input.cause } : undefined,
    );
    this.name = "PersistedSessionMissingError";
    this.provider = input.provider;
    this.sessionId = input.sessionId;
    this.historyPath = input.historyPath;
  }
}

export function isPersistedSessionMissingError(
  error: unknown,
): error is PersistedSessionMissingError {
  return error instanceof PersistedSessionMissingError;
}

export function isMissingSessionFileError(error: unknown): boolean {
  if (error instanceof PersistedSessionMissingError) return true;
  if (typeof error === "object" && error !== null && "code" in error) {
    if ((error as { code?: unknown }).code === "ENOENT") return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /\bENOENT\b|no such file|does not exist|session file not found|session not found/i.test(
    message,
  );
}
