import { useCallback, type ReactNode } from "react";

// Hoisted: a fresh object each render would re-mount the DOM node.
const CONTENTS_STYLE = { display: "contents" } as const;

/**
 * Double-clicking a workspace title renames it in place.
 *
 * React Native Web does not forward `onDoubleClick` through `View`, so this
 * needs a real DOM node. `display: contents` keeps it out of the layout
 * entirely — the title keeps its own flex behaviour and the row does not shift —
 * while the element stays in the DOM, so the event still reaches this handler.
 * Single clicks bubble past to the row underneath, which keeps navigation.
 */
export function WorkspaceTitleRenameTarget({
  children,
  onRequestRename,
}: {
  children: ReactNode;
  onRequestRename: () => void;
}) {
  const handleDoubleClick = useCallback(
    (event: { stopPropagation: () => void }) => {
      event.stopPropagation();
      onRequestRename();
    },
    [onRequestRename],
  );

  return (
    <div style={CONTENTS_STYLE} onDoubleClick={handleDoubleClick}>
      {children}
    </div>
  );
}
