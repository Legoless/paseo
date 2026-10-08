import type { WorkspaceMemberDescriptor } from "@/stores/session-store";
import type { ComboboxOptionModel } from "@/components/ui/combobox-options";
import type { PaseoWorktreeListResponse } from "@getpaseo/protocol/messages";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";

export interface BranchComboOption {
  id: string;
  label: string;
}

export function normalizeBranchOptionName(input: string | null | undefined): string | null {
  const trimmed = input?.trim();
  if (!trimmed || trimmed === "HEAD") {
    return null;
  }

  let normalized = trimmed;
  if (normalized.startsWith("refs/heads/")) {
    normalized = normalized.slice("refs/heads/".length);
  } else if (normalized.startsWith("refs/remotes/")) {
    normalized = normalized.slice("refs/remotes/".length);
  }
  if (normalized.startsWith("origin/")) {
    normalized = normalized.slice("origin/".length);
  }

  return normalized.length > 0 && normalized !== "HEAD" ? normalized : null;
}

export function buildBranchComboOptions(input: {
  suggestedBranches?: string[];
  currentBranch?: string | null;
  baseRef?: string | null;
  typedBaseBranch?: string | null;
  worktreeBranchLabels?: string[];
}): BranchComboOption[] {
  const branchSet = new Set<string>();
  const addBranch = (name: string | null | undefined) => {
    const normalized = normalizeBranchOptionName(name);
    if (normalized) {
      branchSet.add(normalized);
    }
  };

  for (const branch of input.suggestedBranches ?? []) {
    addBranch(branch);
  }
  addBranch(input.currentBranch ?? null);
  addBranch(input.baseRef ?? null);
  addBranch(input.typedBaseBranch ?? null);
  for (const label of input.worktreeBranchLabels ?? []) {
    addBranch(label);
  }

  return Array.from(branchSet).map((name) => ({ id: name, label: name }));
}

export function buildBranchWorktreeOptions(input: {
  branches: BranchComboOption[];
  cwd: string;
  projectId: string | null;
  projectRootPath: string | null;
  worktrees: readonly Pick<
    PaseoWorktreeListResponse["payload"]["worktrees"][number],
    "worktreePath" | "branchName"
  >[];
  members: readonly Pick<
    WorkspaceMemberDescriptor,
    "projectId" | "projectRootPath" | "workspaceDirectory" | "branch"
  >[];
}): ComboboxOptionModel[] {
  const options: ComboboxOptionModel[] = input.branches.map((branch) => ({
    id: `branch:${branch.id}`,
    label: branch.label,
  }));
  const seen = new Set([normalizeWorkspacePath(input.cwd)]);
  const appendWorktree = (cwd: string, branch: string | null) => {
    const key = normalizeWorkspacePath(cwd);
    if (!key || seen.has(key)) return;
    seen.add(key);
    options.push({
      id: `worktree:${cwd}`,
      label: branch && branch !== "HEAD" ? branch : cwd.split(/[\\/]/).at(-1) || cwd,
      description: cwd,
      kind: "directory",
    });
  };
  for (const worktree of input.worktrees) {
    appendWorktree(worktree.worktreePath, worktree.branchName ?? null);
  }
  for (const member of input.members) {
    if (
      (input.projectId && member.projectId === input.projectId) ||
      (input.projectRootPath && member.projectRootPath === input.projectRootPath)
    ) {
      appendWorktree(member.workspaceDirectory, member.branch);
    }
  }
  return options;
}
