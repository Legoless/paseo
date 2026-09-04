import type { ReactNode } from "react";

/**
 * Native has no double-click, so the title is left as-is here. Renaming stays
 * reachable from the row's menu, which raises the same in-place editor.
 */
export function WorkspaceTitleRenameTarget({
  children,
}: {
  children: ReactNode;
  onRequestRename: () => void;
}): ReactNode {
  return children;
}
