import type { PropsWithChildren, ReactNode } from "react";
import type {
  SidebarAgentMoveInput,
  SidebarDndItemData,
  SidebarMemberMoveDragState,
  SidebarMemberMoveInput,
} from "./member-move-dnd-model";

export type {
  SidebarAgentMoveInput,
  SidebarDndItemData,
  SidebarMemberMoveDragState,
  SidebarMemberMoveInput,
};
export { asSidebarDndItemData, routeSidebarDragEnd } from "./member-move-dnd-model";

const INACTIVE_DRAG_STATE: SidebarMemberMoveDragState = {
  activeId: null,
  activeKind: null,
  activeWorkspaceKey: null,
  activeCwd: null,
  overWorkspaceKey: null,
  overMemberKey: null,
};

/**
 * Native fallback: cross-list drags do not exist on draggable-flatlist, so the provider is a
 * passthrough and both moves live in a row's menu instead.
 */
export function SidebarMemberMoveDndProvider(
  props: PropsWithChildren<{
    onMoveMember: (input: SidebarMemberMoveInput) => void;
    onMoveAgent: (input: SidebarAgentMoveInput) => void;
  }>,
): ReactNode {
  return props.children;
}

export function useSidebarMemberMoveDragState(): SidebarMemberMoveDragState {
  return INACTIVE_DRAG_STATE;
}
