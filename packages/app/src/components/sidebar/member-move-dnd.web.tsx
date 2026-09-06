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
  type SidebarMemberMoveDragState,
  type SidebarMemberMoveInput,
} from "./member-move-dnd-model";

export type { SidebarMemberMoveInput, SidebarMemberMoveDragState };

const INACTIVE_DRAG_STATE: SidebarMemberMoveDragState = {
  activeId: null,
  activeKind: null,
  activeWorkspaceKey: null,
  overWorkspaceKey: null,
};

const DragStateContext = createContext<SidebarMemberMoveDragState>(INACTIVE_DRAG_STATE);

function sidebarDndKind(entry: { data?: unknown }): "workspace" | "member" | null {
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
  const memberHits = within.filter((entry) => sidebarDndKind(entry) === "member");
  const workspaceHits = within.filter((entry) => sidebarDndKind(entry) === "workspace");
  if (activeKind === "member") {
    if (memberHits.length > 0) {
      return memberHits;
    }
    return workspaceHits;
  }
  if (activeKind === "workspace" && workspaceHits.length > 0) {
    return workspaceHits;
  }
  return closestCenter(args);
};

/** Drop-target state for workspace rows; only moves during an active member drag. */
export function useSidebarMemberMoveDragState(): SidebarMemberMoveDragState {
  return useContext(DragStateContext);
}

/**
 * One DndContext for the whole workspace list: workspace-reorder rows, every
 * member list, and the member-to-workspace move all route through it. Per-list
 * contexts would shadow each other — a member row's useSortable binds to the
 * nearest ancestor context, which would otherwise be its own workspace's list.
 */
export function SidebarMemberMoveDndProvider({
  children,
  onMoveMember,
}: PropsWithChildren<{ onMoveMember: (input: SidebarMemberMoveInput) => void }>): ReactElement {
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
      overWorkspaceKey: null,
    });
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const over = asSidebarDndItemData(event.over?.data.current);
    setDragState((current) => {
      if (current.activeKind !== "member") {
        return current;
      }
      // The row the member already belongs to is not a target — hovering it just reorders.
      const overKey = over?.workspaceKey ?? null;
      const overWorkspaceKey = overKey === current.activeWorkspaceKey ? null : overKey;
      return current.overWorkspaceKey === overWorkspaceKey
        ? current
        : { ...current, overWorkspaceKey };
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
      }
    },
    [clearDrag, onMoveMember, registry],
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
            <DragOverlay dropAnimation={null}>
              {activeLabel ? (
                <View style={styles.overlayChip}>
                  <Text style={styles.overlayLabel} numberOfLines={1}>
                    {activeLabel}
                  </Text>
                </View>
              ) : null}
            </DragOverlay>
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
  },
  overlayLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
}));
