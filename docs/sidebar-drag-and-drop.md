# Sidebar drag and drop

The global sidebar drags three kinds of row. What each one may land on:

| Drag      | Reorder                | Move                                                                 |
| --------- | ---------------------- | -------------------------------------------------------------------- |
| Workspace | among workspaces       | never                                                                |
| Project   | within its workspace   | onto another workspace's row or any of its rows                      |
| Agent     | within its own project | onto the same project's rows under another workspace, and only there |

An agent stays in its project. A project's directory is fixed on the daemon and an agent's cwd
with it, so the only cross-workspace drop that means anything is the same directory mounted
twice. `routeSidebarDragEnd` in `packages/app/src/components/sidebar/member-move-dnd-model.ts`
is the whole decision, and the daemon repeats the check rather than trusting it.

## One DndContext, or none of it works

Every row in the list binds to `SidebarMemberMoveDndProvider`. dnd-kit's `InternalContext` is a
plain React context, so `useSortable` resolves to the nearest `DndContext` ancestor: a per-list
context makes rows in other lists invisible to the drag, and a cross-list drop can never resolve
a target. That is why `DraggableList` takes `externalDndContext` and registers through
`external-dnd-registry.ts` instead of owning a context per list. A nested `DndContext` anywhere
under the provider silently reduces that list to reorder-only.

Collision detection is hit-test first (`pointerWithin`), then a kind-specific narrowing. An
agent prefers an agent row and falls back to the project header behind it, with no center
fallback — a release over blank canvas must not re-parent anything. A workspace falls back to
the nearest _workspace_, because the nearest droppable of any kind is usually a member row,
which routes to nothing and silently discards the drop.

## Keys carry their parent

`memberKey` is `` `${serverId}:${workspaceId}#${directory}` ``
(`packages/app/src/projects/workspace-groups.ts`). Two consequences you have to handle by hand:

- The same project in two workspaces has two member keys that differ only in the workspace. That
  is what makes an agent's move target addressable.
- Moving a project between workspaces **renames** its key, so the remembered agent order under
  it is orphaned. `rekeyAgentOrder` carries it over; without that the project's agents come back
  in name order and the old entry leaks for the life of the install.

## Order is merged, never overwritten

Persisted order lists (`sidebar-order-store.ts`) hold keys for rows a filter currently hides.
Write a reorder back with `mergeWithRemainder`, which rewrites only the slots the visible keys
occupy. Overwriting with the visible keys drops the hidden rows; appending the hidden keys after
the visible ones demotes every filtered-out row to the bottom on any drag.

The daemon appends a moved membership and the baseline sort is by project name, so a
cross-workspace project drop needs `memberOrderAfterMove` to record where the user aimed.
Nothing else remembers it.

## Native has no cross-list drag

`react-native-draggable-flatlist` cannot drop into another list, so `member-move-dnd.tsx` is a
passthrough and both moves live in a row's menu. Reorder works at all three levels through
`NestableDraggableFlatList`. Keep the menu path working: it is the only way to move anything on
a phone.

## Known gaps

- **Keyboard drag does not work at any level.** dnd-kit's `KeyboardSensor` refuses unless
  `event.target` is the activator node itself, so the activator has to be focusable. The rows
  strip dnd-kit's `tabIndex`/`role`/`aria-roledescription` deliberately — keeping them puts a
  second tab stop on every row, since the activator wraps the row's own `Pressable`. Fixing this
  properly means a dedicated drag handle element, which is a design decision, not a patch.
- **No insertion feedback on web.** `externalDndContext` mode suppresses the row transform, so
  nothing shifts and no gap opens; the drag shows a floating chip and a faded source row.
- Pinned workspaces are their own list and cannot be dragged into or out of the main one.
