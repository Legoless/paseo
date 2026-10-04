import { buildDraftCreationKey } from "@/composer/draft/create-flow";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

type WorkspaceCreationFailure = Pick<
  Awaited<ReturnType<DaemonClient["createWorkspace"]>>,
  "workspace" | "creation" | "errorCode"
>;

export class WorkspaceCreationFailedError extends Error {
  readonly canRetry: boolean;

  constructor(message: string, payload: WorkspaceCreationFailure) {
    super(message);
    this.name = "WorkspaceCreationFailedError";
    const rejectedBeforeProvision =
      payload.errorCode === "directory_not_found" || payload.errorCode === "source_required";
    const outcomeUnknown = payload.creation?.outcomeUnknown;
    const confirmedFailure = outcomeUnknown === false || rejectedBeforeProvision;
    this.canRetry = !payload.workspace && outcomeUnknown !== true && confirmedFailure;
  }
}

export interface WorkspaceCreationKey {
  /** Retires the key only when the daemon confirms creation failed without a workspace. */
  run<T>(create: (idempotencyKey: string) => Promise<T>): Promise<T>;
}

/**
 * The idempotency key the New workspace screen sends with its workspace creation.
 *
 * The daemon keeps a receipt per key: the same request under it resumes, a different request is
 * rejected as `workspace_request_key_conflict`. A confirmed failure before a workspace exists
 * needs a fresh key for an edited retry. Transport errors and uncertain outcomes keep the key:
 * creation may already have succeeded, so changing it could duplicate the workspace.
 */
export function createWorkspaceCreationKey(
  draftId: string,
  now: () => Date = () => new Date(),
): WorkspaceCreationKey {
  let key = draftId;
  let lastTimestamp = 0;
  return {
    async run(create) {
      try {
        return await create(key);
      } catch (error) {
        if (error instanceof WorkspaceCreationFailedError && error.canRetry) {
          // Two failures in one millisecond must still leave distinct keys.
          lastTimestamp = Math.max(now().getTime(), lastTimestamp + 1);
          key = buildDraftCreationKey(draftId, { timestamp: new Date(lastTimestamp) });
        }
        throw error;
      }
    },
  };
}
