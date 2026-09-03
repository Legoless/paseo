# Pane layouts

A pane layout is a named arrangement of a workspace's panes. Seven ship with the app — Single pane,
Two columns, Two rows, and grids at 2 × 2, 2 × 5, 2 × 7 and 3 × 7 — and you write your own as JSON
files the daemon reads at startup. Apply one from **Pane layout** in any workspace menu —
the sidebar kebab, the sidebar row's context menu, or the header menu next to the workspace title.

Layouts describe geometry only. Applying one never starts or stops an agent, terminal, or tab.

## Where the files live

```
$PASEO_HOME/layouts/<stem>.json
```

One file per layout. The file stem is the layout's id, so renaming a file makes a new layout and
editing one keeps its identity. The file itself carries no id.

Not `config.json`: that schema is strict and the daemon refuses to boot when it fails to parse, so a
typo in a pane tree would take down every running agent. A bad layout file is skipped instead, and
the menu shows why.

## Rows and columns

```json
{
  "name": "Main and side",
  "root": {
    "direction": "row",
    "children": [{ "size": 7 }, { "size": 3 }]
  }
}
```

A node is either a **leaf** — `{}` is a complete, valid pane — or a **split**, which carries
`direction` and `children`. `"row"` places children side by side, left to right. `"column"` stacks
them top to bottom. Every split states its own direction; it is never inferred from nesting depth.

The store speaks `horizontal`/`vertical` internally and the builder maps to it in one line. The file
format uses `row`/`column` because half of readers hear "horizontal divider" and read `horizontal`
backwards.

### Sizes

`size` is an optional positive weight relative to its siblings, never pixels. Omit them all for equal
shares. `[{"size": 2}, {"size": 1}]` and `[{"size": 0.7}, {"size": 0.3}]` mean the same thing, and a
sibling with no `size` counts as `1`.

Weights pass through `clampNormalizedSizes`, so a pane can never end up below `MIN_SPLIT_SIZE` (10%).
Without that floor a weight of 100 beside 1 would render a pane narrower than the resize handles can
produce.

### Limits

A split takes 2 to 10 children and may nest 3 levels deep.

Ten is where the `MIN_SPLIT_SIZE` floor uses up the whole axis: past it `clampNormalizedSizes` drops
every weight and hands out equal shares, so `size` would silently stop working. Three levels is the
whole depth budget — the app's workspace-root wrapper (1) plus three config levels (2, 3, 4) plus the
panes (5) is exactly `MAX_TREE_DEPTH`.

A grid is two levels: a `column` of bands, each a `row` of panes. That is how the built-in grids are
built, and why "3 × 7" means three rows of seven.

## Examples

Two columns at 2:1, the narrow one split into rows:

```json
{
  "name": "Review",
  "root": {
    "direction": "row",
    "children": [{ "size": 2 }, { "size": 1, "direction": "column", "children": [{}, {}] }]
  }
}
```

Two split levels, five panes:

```json
{
  "name": "Cockpit",
  "root": {
    "direction": "column",
    "children": [
      { "size": 2, "direction": "row", "children": [{ "size": 3 }, { "size": 2 }] },
      { "size": 1, "direction": "row", "children": [{}, {}, {}] }
    ]
  }
}
```

## Authoring loop

Edit a file, run `paseo daemon reload`, then open the menu. The daemon rescans the directory and
broadcasts the new list to every connected client. There is no file watcher.

A file that fails to read, fails `JSON.parse`, fails the schema, or fails the structural check is
skipped and named in the menu, e.g. `review.json: root.children[1] has "children" but no "direction"
("row" or "column")`. Its siblings still load.

That structural check exists because the schema cannot do the job alone. A node is discriminated by
whether `children` is present, and the leaf arm passes unknown keys through for forward
compatibility — so a misspelled `direction` fails the split arm, passes the leaf arm, and would
silently collapse the layout to one pane. `parsePaneLayoutFile` in
`packages/protocol/src/workspace-layouts.ts` runs both halves and is the only gate callers need.

## What applying does

Existing content panes are read in visual order and dealt into the layout's panes by index, wrapping
when the layout has fewer. Every open tab comes along.

The first N new panes reuse the first N existing pane ids, so a layout with the same pane count as
the current one changes proportions and remounts nothing. Tabs that do move panes remount: terminals
re-attach and replay scrollback (the PTY keeps running), agent panels rebuild, and editor scroll
position is lost. That is inherent to changing the geometry.

Panes past the old count start empty and get a launcher tab. The Explorer sidebar never participates
— it docks outside the workspace splits — and keeps its tabs and hidden state.

There are no pane splits on compact or wide-native form factors, so the menu row is absent there.

## Transport

Layouts ride the existing daemon config payload (`MutableDaemonConfig.paneLayouts`, plus
`paneLayoutErrors`), reaching the app through `get_daemon_config_response` and the
`daemon_config_changed` broadcast that `useDaemonConfig` already subscribes to. They are daemon-owned
and read-only, which is why neither field appears in `MutableDaemonConfigPatchSchema`.

`server_info.features.paneLayouts` gates the menu: against an older daemon the directory is ignored
entirely, which is indistinguishable from having authored nothing, so the submenu says to update the
host instead.
