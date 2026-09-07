import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactElement,
} from "react";
import { Text, View } from "react-native";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { StyleSheet } from "react-native-unistyles";
import {
  createExternalDndListRegistry,
  ExternalDndActiveIdContext,
  ExternalDndListRegistryContext,
  type ExternalDndListRegistration,
} from "@/components/drag-reorder/external-dnd-registry";
import {
  asSidebarDndItemData,
  routeSidebarDragEnd,
  type SidebarAgentMoveInput,
  type SidebarMemberMoveDragState,
  type SidebarMemberMoveInput,
} from "./member-move-dnd-model";

export type { SidebarAgentMoveInput, SidebarMemberMoveInput, SidebarMemberMoveDragState };

const DRAG_OVERLAY_STYLE = { pointerEvents: "none" as const };

const INACTIVE_DRAG_STATE: SidebarMemberMoveDragState = {
  activeId: null,
  activeKind: null,
  activeWorkspaceKey: null,
  activeCwd: null,
  overWorkspaceKey: null,
  overMemberKey: null,
};

const DragStateContext = createContext<SidebarMemberMoveDragState>(INACTIVE_DRAG_STATE);

function sidebarDndKind(entry: { data?: unknown }): "workspace" | "member" | "agent" | null {
  const container = (entry as { data?: { droppableContainer?: { data?: { current?: unknown } } } })
    .data?.droppableContainer?.data?.current;
  return asSidebarDndItemData(container)?.kind ?? null;
}

/**
 * Hit-test first: a workspace row the pointer is inside of must win over a member
 * whose center happens to be nearer — closestCenter alone let a 40-row member list
 * swallow drops meant for the collapsed workspace header past it (split-container's
 * collision does the same for its drop zones). Workspace drags keep center fallback
 * so reordering still works on a drop past the last row; member drags get none —
 * a drop on empty canvas must not move a project.
 */
const sidebarCollisionDetection: CollisionDetection = (args) => {
  const activeKind = asSidebarDndItemData(args.active?.data.current)?.kind ?? null;
  const within = pointerWithin(args);
  const agentHits = within.filter((entry) => sidebarDndKind(entry) === "agent");
  const memberHits = within.filter((entry) => sidebarDndKind(entry) === "member");
  const workspaceHits = within.filter((entry) => sidebarDndKind(entry) === "workspace");
  if (activeKind === "agent") {
    // An agent row first, then the project header behind it — dropping on a collapsed or
    // empty copy of the project has to resolve to the member row. No center fallback: a
    // release over blank canvas must not re-parent an agent.
    if (agentHits.length > 0) {
      return agentHits;
    }
    return memberHits;
  }
  if (activeKind === "member") {
    if (memberHits.length > 0) {
      return memberHits;
    }
    return workspaceHits;
  }
  if (activeKind === "workspace") {
    if (workspaceHits.length > 0) {
      return workspaceHits;
    }
    // Released past the last row or above the first: fall back to the nearest workspace
    // rather than the nearest droppable, which is usually a member row and routes to none.
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (container) => asSidebarDndItemData(container.data.current)?.kind === "workspace",
      ),
    });
  }
  return closestCenter(args);
};

/** Drop-target state for workspace and member rows during an active member or agent drag. */
export function useSidebarMemberMoveDragState(): SidebarMemberMoveDragState {
  return useContext(DragStateContext);
}

/**
 * One DndContext for the whole workspace list: workspace-reorder rows, every member list,
 * every agent bucket, the member-to-workspace move and the agent-to-other-copy-of-its-project
 * move all route through it. Per-list contexts would shadow each other — a row's useSortable
 * binds to the nearest ancestor context, which would otherwise be its own list, and a drag
 * could never resolve a drop target outside it.
 */
export function SidebarMemberMoveDndProvider({
  children,
  onMoveMember,
  onMoveAgent,
}: PropsWithChildren<{
  onMoveMember: (input: SidebarMemberMoveInput) => void;
  onMoveAgent: (input: SidebarAgentMoveInput) => void;
}>): ReactElement {
  const [dragState, setDragState] = useState<SidebarMemberMoveDragState>(INACTIVE_DRAG_STATE);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const listsRef = useRef(new Map<string, ExternalDndListRegistration>());
  const registry = useMemo(() => createExternalDndListRegistry(listsRef.current), []);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = asSidebarDndItemData(event.active.data.current);
    setActiveLabel(data?.label ?? null);
    setDragState({
      activeId: String(event.active.id),
      activeKind: data?.kind ?? null,
      activeWorkspaceKey: data?.workspaceKey ?? null,
      activeCwd: data && data.kind !== "workspace" ? data.cwd : null,
      overWorkspaceKey: null,
      overMemberKey: null,
    });
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const over = asSidebarDndItemData(event.over?.data.current);
    setDragState((current) => {
      if (current.activeKind === "member") {
        // The row the member already belongs to is not a target — hovering it just reorders.
        const overKey = over?.workspaceKey ?? null;
        const overWorkspaceKey = overKey === current.activeWorkspaceKey ? null : overKey;
        return current.overWorkspaceKey === overWorkspaceKey
          ? current
          : { ...current, overWorkspaceKey };
      }
      if (current.activeKind === "agent") {
        // Only the same project's bucket in another workspace lights up, so the highlight
        // never promises a drop `routeSidebarDragEnd` will refuse.
        const isTarget =
          over !== null &&
          over.kind !== "workspace" &&
          current.activeCwd !== null &&
          current.activeCwd.length > 0 &&
          over.cwd === current.activeCwd &&
          over.workspaceKey !== current.activeWorkspaceKey;
        const overMemberKey = isTarget && over !== null ? over.memberKey : null;
        return current.overMemberKey === overMemberKey ? current : { ...current, overMemberKey };
      }
      return current;
    });
  }, []);

  const clearDrag = useCallback(() => {
    setDragState(INACTIVE_DRAG_STATE);
    setActiveLabel(null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const active = asSidebarDndItemData(event.active.data.current);
      const over = asSidebarDndItemData(event.over?.data.current);
      const route = routeSidebarDragEnd({
        active,
        over,
        overId: event.over ? String(event.over.id) : null,
      });
      clearDrag();

      if (route.kind === "reorder") {
        registry.reorderSameList({
          listId: route.listId,
          activeId: String(event.active.id),
          overId: event.over ? String(event.over.id) : null,
        });
        return;
      }
      if (route.kind === "move") {
        onMoveMember(route.input);
        return;
      }
      if (route.kind === "moveAgent") {
        onMoveAgent(route.input);
      }
    },
    [clearDrag, onMoveAgent, onMoveMember, registry],
  );

  return (
    <ExternalDndListRegistryContext.Provider value={registry}>
      <DragStateContext.Provider value={dragState}>
        <ExternalDndActiveIdContext.Provider value={dragState.activeId}>
          <DndContext
            sensors={sensors}
            collisionDetection={sidebarCollisionDetection}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragCancel={clearDrag}
            onDragEnd={handleDragEnd}
          >
            {children}
            {typeof document !== "undefined"
              ? createPortal(
                  <DragOverlay dropAnimation={null} style={DRAG_OVERLAY_STYLE} zIndex={10000}>
                    {activeLabel ? (
                      <View style={styles.overlayChip}>
                        <Text style={styles.overlayLabel} numberOfLines={1}>
                          {activeLabel}
                        </Text>
                      </View>
                    ) : null}
                  </DragOverlay>,
                  document.body,
                )
              : null}
          </DndContext>
        </ExternalDndActiveIdContext.Provider>
      </DragStateContext.Provider>
    </ExternalDndListRegistryContext.Provider>
  );
}

const styles = StyleSheet.create((theme) => ({
  overlayChip: {
    alignSelf: "flex-start",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    pointerEvents: "none",
    ...theme.shadow.md,
  },
  overlayLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    userSelect: "none",
  },
}));
