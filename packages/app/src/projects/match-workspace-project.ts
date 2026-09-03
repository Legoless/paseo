import { normalizeWorkspacePath } from "@/utils/workspace-identity";
import type { WorkspaceProjectPickerOption } from "@/components/workspace-project-picker";

/**
 * The workspace project a directory belongs to, or null when it belongs to none. Matching is the
 * sidebar's rule from `./workspace-groups.ts` — a normalized directory equal to a member's, nothing
 * looser — so a pane and its sidebar row agree on what counts as Uncategorized.
 */
export function matchWorkspaceProject(
  options: readonly WorkspaceProjectPickerOption[],
  cwd: string,
): WorkspaceProjectPickerOption | null {
  const normalized = normalizeWorkspacePath(cwd);
  if (!normalized) {
    return null;
  }
  return options.find((option) => normalizeWorkspacePath(option.cwd) === normalized) ?? null;
}
