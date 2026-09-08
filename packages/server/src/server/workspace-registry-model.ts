import { randomBytes } from "node:crypto";

import type {
  ProjectCheckoutLitePayload,
  ProjectPlacementPayload,
} from "@getpaseo/protocol/messages";
import type { PersistedWorkspaceMember, PersistedWorkspaceRecord } from "./workspace-registry.js";

export type PersistedProjectKind = "git" | "non_git";
export type PersistedWorkspaceKind = "local_checkout" | "worktree" | "directory";

export function generateWorkspaceId(): string {
  return `wks_${randomBytes(8).toString("hex")}`;
}

export function generateProjectId(): string {
  return `prj_${randomBytes(8).toString("hex")}`;
}

export function deriveProjectKind(checkout: ProjectCheckoutLitePayload): PersistedProjectKind {
  return checkout.isGit ? "git" : "non_git";
}

export function deriveWorkspaceKind(checkout: ProjectCheckoutLitePayload): PersistedWorkspaceKind {
  if (!checkout.isGit) {
    return "directory";
  }
  return checkout.mainRepoRoot ? "worktree" : "local_checkout";
}

export function deriveWorkspaceDisplayName(input: {
  cwd: string;
  checkout: ProjectCheckoutLitePayload;
}): string {
  const branch = input.checkout.currentBranch?.trim() ?? null;
  if (branch && branch.toUpperCase() !== "HEAD") return branch;

  const segments = input.cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return segments[segments.length - 1] ?? input.cwd;
}

export function workspaceMembers(record: PersistedWorkspaceRecord): PersistedWorkspaceMember[] {
  return record.members;
}

export function isProjectlessWorkspace(record: PersistedWorkspaceRecord): boolean {
  return record.members.length === 0;
}

export type PersistedWorkspacePlacement = Pick<
  PersistedWorkspaceMember,
  | "cwd"
  | "kind"
  | "displayName"
  | "branch"
  | "worktreeRoot"
  | "baseBranch"
  | "isPaseoOwnedWorktree"
  | "mainRepoRoot"
>;

export type MutableWorkspacePlacement = Pick<
  PersistedWorkspaceMember,
  "kind" | "branch" | "worktreeRoot" | "isPaseoOwnedWorktree" | "mainRepoRoot"
>;

export type InitialWorkspacePlacementInput =
  | {
      source: "checkout";
      cwd: string;
      checkout: ProjectCheckoutLitePayload;
    }
  | {
      source: "created_worktree";
      cwd: string;
      worktreeRoot: string;
      branch: string | null;
      baseBranch: string | null;
      mainRepoRoot: string;
    };

export interface WorkspacePlacementUpdate {
  member: PersistedWorkspaceMember;
  fields: Partial<MutableWorkspacePlacement>;
}

/** Defines the complete persisted placement for a workspace member. */
export function initialWorkspacePlacement(
  input: InitialWorkspacePlacementInput,
): PersistedWorkspacePlacement {
  if (input.source === "created_worktree") {
    return {
      cwd: input.cwd,
      kind: "worktree",
      displayName: input.branch || input.cwd,
      branch: input.branch,
      worktreeRoot: input.worktreeRoot,
      baseBranch: input.baseBranch,
      isPaseoOwnedWorktree: true,
      mainRepoRoot: input.mainRepoRoot,
    };
  }

  const branch = normalizeBranch(input.checkout.currentBranch);
  return {
    cwd: input.cwd,
    kind: deriveWorkspaceKind(input.checkout),
    displayName: deriveWorkspaceDisplayName(input),
    branch,
    worktreeRoot: input.checkout.isGit ? (input.checkout.worktreeRoot ?? input.cwd) : null,
    baseBranch: null,
    isPaseoOwnedWorktree: input.checkout.isGit && input.checkout.isPaseoOwnedWorktree,
    mainRepoRoot: input.checkout.isGit ? input.checkout.mainRepoRoot : null,
  };
}

/**
 * Applies live placement facts without rewriting the workspace's durable name
 * or its creation-time base branch.
 */
export function reconcileWorkspacePlacement(input: {
  member: PersistedWorkspaceMember;
  checkout: ProjectCheckoutLitePayload;
}): WorkspacePlacementUpdate | null {
  const observed = initialWorkspacePlacement({
    source: "checkout",
    cwd: input.member.cwd,
    checkout: input.checkout,
  });
  const fields: Partial<MutableWorkspacePlacement> = {};
  if (input.member.kind !== observed.kind) fields.kind = observed.kind;
  if (input.member.branch !== observed.branch) fields.branch = observed.branch;
  if (input.member.worktreeRoot !== observed.worktreeRoot)
    fields.worktreeRoot = observed.worktreeRoot;
  if (input.member.isPaseoOwnedWorktree !== observed.isPaseoOwnedWorktree)
    fields.isPaseoOwnedWorktree = observed.isPaseoOwnedWorktree;
  if (input.member.mainRepoRoot !== observed.mainRepoRoot)
    fields.mainRepoRoot = observed.mainRepoRoot;

  if (Object.keys(fields).length === 0) return null;
  return {
    member: { ...input.member, ...fields },
    fields,
  };
}

/** Projects persisted placement onto the checkout shape sent over the wire. */
export function checkoutFromPersistedWorkspacePlacement(input: {
  member: PersistedWorkspaceMember;
  fallbackBranch?: string | null;
  fallbackWorktreeRoot?: string | null;
}): ProjectPlacementPayload["checkout"] {
  const { member } = input;
  if (member.kind === "directory") {
    return {
      cwd: member.cwd,
      isGit: false,
      currentBranch: null,
      remoteUrl: null,
      worktreeRoot: null,
      isPaseoOwnedWorktree: false,
      mainRepoRoot: null,
    };
  }

  const checkout = {
    cwd: member.cwd,
    currentBranch: member.branch ?? input.fallbackBranch ?? null,
    remoteUrl: null,
    worktreeRoot: member.worktreeRoot ?? input.fallbackWorktreeRoot ?? member.cwd,
  };
  if (member.isPaseoOwnedWorktree && member.mainRepoRoot) {
    return {
      ...checkout,
      isGit: true,
      isPaseoOwnedWorktree: true,
      mainRepoRoot: member.mainRepoRoot,
    };
  }
  return {
    ...checkout,
    isGit: true,
    isPaseoOwnedWorktree: false,
    mainRepoRoot: member.mainRepoRoot ?? null,
  };
}

function normalizeBranch(branch: string | null | undefined): string | null {
  const normalized = branch?.trim() ?? null;
  return normalized && normalized.toUpperCase() !== "HEAD" ? normalized : null;
}

export function checkoutLiteFromGitSnapshot(
  cwd: string,
  git: {
    isGit: boolean;
    currentBranch: string | null;
    remoteUrl: string | null;
    repoRoot: string | null;
    isPaseoOwnedWorktree: boolean;
    mainRepoRoot: string | null;
  },
): ProjectCheckoutLitePayload {
  if (!git.isGit) {
    return {
      cwd,
      isGit: false,
      currentBranch: null,
      remoteUrl: null,
      worktreeRoot: null,
      isPaseoOwnedWorktree: false,
      mainRepoRoot: null,
    };
  }
  if (git.isPaseoOwnedWorktree && git.mainRepoRoot) {
    return {
      cwd,
      isGit: true,
      currentBranch: git.currentBranch,
      remoteUrl: git.remoteUrl,
      worktreeRoot: git.repoRoot ?? cwd,
      isPaseoOwnedWorktree: true,
      mainRepoRoot: git.mainRepoRoot,
    };
  }
  return {
    cwd,
    isGit: true,
    currentBranch: git.currentBranch,
    remoteUrl: git.remoteUrl,
    worktreeRoot: git.repoRoot ?? cwd,
    isPaseoOwnedWorktree: false,
    mainRepoRoot: git.mainRepoRoot,
  };
}
