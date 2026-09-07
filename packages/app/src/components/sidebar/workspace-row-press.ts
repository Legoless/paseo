/**
 * Pressing a workspace row navigates to it — unless it is already open, in
 * which case the press toggles its subtree instead.
 *
 * On web the toggle waits out the double-click window: a second press means
 * the rename gesture owns the interaction (see `WorkspaceTitleRenameTarget`),
 * so the pending toggle is dropped rather than fired. The leading chevron
 * stays instant — it never feeds the rename gesture.
 */
export type WorkspaceRowPressAction = "navigate" | "toggle";

export const WORKSPACE_ROW_DOUBLE_PRESS_WINDOW_MS = 300;

export function resolveWorkspaceRowPressAction(input: {
  selected: boolean;
  hasCollapseToggle: boolean;
}): WorkspaceRowPressAction {
  if (!input.selected || !input.hasCollapseToggle) return "navigate";
  return "toggle";
}
