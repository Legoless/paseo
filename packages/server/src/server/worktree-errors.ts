import { MissingCheckoutTargetError } from "./resolve-worktree-creation-intent.js";
import { BranchAlreadyCheckedOutError, UnknownBranchError } from "../utils/worktree.js";

export type WorktreeWireErrorCode =
  | "branch_already_checked_out"
  | "missing_checkout_target"
  | "unknown_branch"
  | "unknown";

export interface WorktreeWireError {
  code: WorktreeWireErrorCode;
  message: string;
}

export class WorktreeRequestError extends Error {
  readonly code: WorktreeWireErrorCode;

  constructor(error: WorktreeWireError) {
    super(error.message);
    this.name = "WorktreeRequestError";
    this.code = error.code;
  }
}

function readThrownMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error) {
    return error;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }
  try {
    const encoded = JSON.stringify(error);
    if (encoded && encoded !== "null") {
      return encoded;
    }
  } catch {
    /* circular throw bodies still need a string */
  }
  return "Unknown error";
}

export function toWorktreeWireError(error: unknown): WorktreeWireError {
  if (error instanceof BranchAlreadyCheckedOutError) {
    return { code: "branch_already_checked_out", message: error.message };
  }
  if (error instanceof MissingCheckoutTargetError) {
    return { code: "missing_checkout_target", message: error.message };
  }
  if (error instanceof UnknownBranchError) {
    return { code: "unknown_branch", message: error.message };
  }
  return { code: "unknown", message: readThrownMessage(error) };
}

export function toWorktreeRequestError(error: unknown): WorktreeRequestError {
  return new WorktreeRequestError(toWorktreeWireError(error));
}
