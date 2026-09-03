# Explorer sidebar and side pane

The Explorer sidebar and the side pane share panel implementations, but they have different shell
contracts.

| Surface          | Purpose                      | Lifecycle                                                |
| ---------------- | ---------------------------- | -------------------------------------------------------- |
| Explorer sidebar | Files and Changes navigation | Cmd+E toggles Explorer for the focused pane's active tab |
| Side pane        | Ordinary workspace content   | Created and closed like any workspace pane               |

## Panel host contract

Every desktop panel registers its supported `PaneHost` values and presentation. Launchers derive
fixed-target labels and icons from that registration, filter by host, and never substitute one
panel type for another. Tab moves reject unsupported destinations, and placement resolves only to
a compatible pane.

Files and Changes are the Explorer defaults and its singleton navigation views. Other compatible
tabs, including agents, terminals, files, and diffs, can move between Explorer and main panes.
Keep panel implementations independent of either shell. `WorkspacePanelHost` owns mounting and
retention, while each shell owns its tabs, focus, dragging, resizing, and shortcuts.

## Explorer sidebar

`packages/app/src/workspace-tabs/explorer-sidebar.ts` owns show, hide, toggle, and view selection.
On desktop, the shell renders inside the focused workspace pane. Every pane has an Explorer toggle
at the top-right of its content surface. Explorer visibility is remembered per content tab of the
focused pane; tabs that have never been toggled default closed. The dock uses its own persisted
width and resize handle, and leaves the workspace header, tab rail, and sibling panes unchanged.
The tray's top-left carries the pane project badge, then the checkout label; Explorer stays at the
top-right. The badge names the project whose member directory equals the pane's — the sidebar's
Uncategorized rule from `packages/app/src/projects/workspace-groups.ts`, so a pane and its sidebar
row never disagree. An agent that belongs to no project runs in the daemon home directory, and the
pane shows no badge rather than naming a directory that is nobody's project; add that directory as
a project and the same agent gets one. The checkout label shows only where the directory is a git
repository. A draft owns its working directory, so on a draft tab the badge is instead a picker —
**No project**, the workspace members, and **Browse…**, which opens the add-project flow against
this workspace — and it stays even while uncategorized, because there it assigns the project rather
than reporting it. Project-scoped git actions sit immediately left of Explorer.
The global sidebar and workspace header do not own project work chrome on desktop pane layouts.
Open in editor uses the same pane project directory, so it opens that checkout or worktree rather
than the workspace primary. The tray's workspace-actions menu configures the visible controls:
development branch label, Open in editor, and git actions. The selection persists per device and
applies to every pane.
The tray is a fixed-height row above pane content. Controls becoming ready never cover or shift the
agent or terminal surface.
While Explorer is closed, its toggle sits at the main tray's top-right. Opening Explorer moves the
same control to the far-right of the Files/Changes rail, so the pointer can close it in place.

By default, the dock and project tray follow only the active agent, terminal, or draft tab. When the
active tab supplies no project, use the workspace primary. **Layout → Workspace panes → Explorer
project** can switch to **Pane tab group**, which lets a supporting tab inherit another
project-bound tab in the pane. The Explorer project picker remains on layouts without desktop pane
splits, where there is one shared Explorer destination.

`packages/app/src/workspace-tabs/open-supporting-view.ts` owns semantic Changes and pull-request
opens. Compact and wide native layouts select the matching Explorer tab. Desktop Changes opens
follow the shared diff preference. Desktop pull requests use their Main panel, On the side, or
Explorer sidebar setting. Callers request the content and never choose the shell.
The composer Changes pill is a two-stage desktop action: it first reveals Explorer on Changes, then
routes later presses to the working diff through the shared diff preference.

The persisted layout still contains the Explorer pane so tabs survive reloads. The renderer removes
that pane from the workspace split tree and mounts its shell inside the focused pane. Visibility
persists per content tab in `explorerSidebarOpenByTab`. The pane's `hidden` flag remains for
back-compat and placement fallback; the selector reads the per-tab map. Legacy layouts without the
map seed the previously focused content tab as open when the Explorer pane was visible. Persisted
identifiers retain the literal `"explorer"` pane id and `explorerPaneIdByWorkspace` key for
compatibility.

The tab rail has no inline add or close controls. Its context menu opens a New Tab launcher and
toggles the singleton Files and Changes views. Individual tab menus close instances or move
compatible tabs to main. Explorer tabs can be reordered, but the dock cannot be split. Selecting
an Explorer tab does not change workspace focus.

Cmd+E toggles Explorer for the focused pane's active tab without changing its selected view.
Switching content tabs switches to that tab's remembered open or closed state; tabs that never
toggled default closed. Compact layouts use the combined full-screen Explorer overlay for Changes,
Files, and pull requests, and close it after a file opens.
Wide native layouts without pane splits use the same combined content in a resizable inline dock;
opening a file leaves that dock visible. Both presentations keep their selection in the panel store
and reuse the layout store's per-workspace Explorer width. They do not create a second Explorer
lifecycle.

## Side pane

`packages/app/src/workspace-tabs/open-beside.ts` owns content opened beside the user's work. The
layout store remembers one ordinary pane per workspace. The first side open creates a full-height
right split around the workspace root; later side opens reuse it.

Closing the pane or moving away its final tab removes it normally and clears the remembered id. A
later side open creates a new pane. There is no hidden side-pane lifecycle.

Placement intent still controls existing tabs:

| Mode      | New target                  | Existing target                   |
| --------- | --------------------------- | --------------------------------- |
| `pane`    | opens in the requested pane | moves to the requested pane       |
| `prefer`  | opens in the requested pane | stays where the user placed it    |
| `focused` | opens in the focused pane   | focuses it where it already lives |
| `ambient` | opens in a compatible pane  | focuses it where it already lives |

Explicit **Open to Side** uses `pane`. Implicit opens use `prefer`, so a preference affects only a
new target and never yanks an existing tab out of a user-selected pane.

## Routing preferences

Desktop **Settings → Layout → Open location** has independent Main panel or On the side choices for
Explorer Files, diffs, chat files, files opened from diffs, and subagents. They default to Main
panel. Mobile ignores them.

Pull requests have a three-way open location: Main panel, On the side, or Explorer sidebar. Explorer
sidebar is the default. Compact layouts always open pull requests in Explorer regardless of this
desktop preference.

Panels request an implicit open through the narrow `openPreferredTarget(target, source)` pane
contract. Entry points outside panels use `openPreferredWorkspaceTarget`. Do not branch on a
specific shell inside a panel.
