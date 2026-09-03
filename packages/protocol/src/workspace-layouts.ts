import { z } from "zod";

/**
 * Pane layouts are named arrangements of workspace panes, authored one per file under
 * `$PASEO_HOME/layouts/` and read by the daemon at startup. They describe geometry only —
 * rows, columns and their proportions — never pane contents; applying one rearranges the
 * tabs a workspace already has.
 *
 * The nesting mirrors Warp's launch configurations, which is also the shape the app's own
 * `SplitNode` tree already has. See docs/pane-layouts.md.
 */

/**
 * A leaf pane. `{}` is a complete, valid pane — `size` is the only thing there is to say
 * about it.
 */
const PaneLayoutLeafSchema = z
  .object({
    /** Weight relative to siblings. Omitted counts as 1, so mixing with sized siblings is defined. */
    size: z.number().positive().optional(),
  })
  .passthrough();

/**
 * Three split levels, unrolled rather than expressed with `z.lazy`.
 *
 * The depth budget is exactly three: the app's workspace-root wrapper (1) plus these levels
 * (2, 3, 4) plus the panes themselves (5) consumes `MAX_TREE_DEPTH`. A fourth level fails the
 * parse — with the offending file named — instead of persisting into a subtree the split
 * helpers would refuse to nest any further. A self-recursive schema would also be unproven
 * against the zod-aot inbound compiler, which this schema reaches through
 * `get_daemon_config_response`.
 */
/**
 * A split's child count. Two is the least that is a split at all; ten is where the app's
 * MIN_SPLIT_SIZE floor (10%) uses up the whole axis, so past it `clampNormalizedSizes` ignores
 * every weight and hands out equal shares. Allowing more would silently make `size` a no-op.
 */
export const MIN_PANE_LAYOUT_CHILDREN = 2;
export const MAX_PANE_LAYOUT_CHILDREN = 10;

const splitAt = <T extends z.ZodTypeAny>(child: T) =>
  z
    .object({
      size: z.number().positive().optional(),
      /** `row` places children side by side; `column` stacks them. */
      direction: z.enum(["row", "column"]),
      children: z.array(child).min(MIN_PANE_LAYOUT_CHILDREN).max(MAX_PANE_LAYOUT_CHILDREN),
    })
    .passthrough();

const PaneLayoutLevel3Schema = z.union([splitAt(PaneLayoutLeafSchema), PaneLayoutLeafSchema]);
const PaneLayoutLevel2Schema = z.union([splitAt(PaneLayoutLevel3Schema), PaneLayoutLeafSchema]);

export const PaneLayoutNodeSchema = z.union([
  splitAt(PaneLayoutLevel2Schema),
  PaneLayoutLeafSchema,
]);
export type PaneLayoutNode = z.infer<typeof PaneLayoutNodeSchema>;

/** One file under `$PASEO_HOME/layouts/`. The file stem is the id; the file does not carry one. */
export const PaneLayoutFileSchema = z
  .object({
    name: z.string().min(1),
    root: PaneLayoutNodeSchema,
  })
  .passthrough();
export type PaneLayoutFile = z.infer<typeof PaneLayoutFileSchema>;

/** One layout as it reaches the app, with the file stem attached as `id`. */
export const PaneLayoutSchema = PaneLayoutFileSchema.extend({ id: z.string().min(1) });
export type PaneLayout = z.infer<typeof PaneLayoutSchema>;

/** Narrows a node to its split arm. Nodes are discriminated by whether `children` is present. */
export function isPaneLayoutSplit(
  node: PaneLayoutNode,
): node is Extract<PaneLayoutNode, { direction: "row" | "column" }> {
  return "children" in node && Array.isArray(node.children);
}

/**
 * Split levels a layout may nest. The app's workspace-root wrapper (1) plus these (2, 3, 4) plus
 * the panes themselves (5) is exactly its MAX_TREE_DEPTH.
 */
export const MAX_PANE_LAYOUT_SPLIT_DEPTH = 3;

/**
 * Rejects a node carrying `children` without a usable `direction`, or nested past
 * MAX_PANE_LAYOUT_SPLIT_DEPTH.
 *
 * The schema alone cannot: a node is discriminated by the presence of `children`, and the leaf
 * arm passes unknown keys through for forward compatibility — so `{"directon": "row", children:
 * [...]}` fails the split arm, passes the leaf arm, and silently collapses the layout to a
 * single pane. Catching it in the schema would need `z.never()`, which is off the table on the
 * zod-aot compiled path, so the daemon runs this over every parsed file instead. It also gives a
 * far better message than zod's `invalid_union` would.
 *
 * Returns a dotted path to the offending node, or null when the tree is sound.
 */
export function findPaneLayoutStructuralError(
  value: unknown,
  path = "root",
  depth = 1,
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const node = value as { children?: unknown; direction?: unknown };
  if (!("children" in node)) {
    return null;
  }
  if (!Array.isArray(node.children)) {
    return `${path} has "children" that is not an array`;
  }
  // Past the depth cap the schema's innermost level parses this as a leaf and passthrough keeps
  // both keys, so without this the tree would silently flatten into a single pane.
  if (depth > MAX_PANE_LAYOUT_SPLIT_DEPTH) {
    return `${path} nests deeper than ${MAX_PANE_LAYOUT_SPLIT_DEPTH} split levels`;
  }
  if (node.direction !== "row" && node.direction !== "column") {
    return `${path} has "children" but no "direction" ("row" or "column")`;
  }
  if (
    node.children.length < MIN_PANE_LAYOUT_CHILDREN ||
    node.children.length > MAX_PANE_LAYOUT_CHILDREN
  ) {
    return `${path} has ${node.children.length} children; a split needs ${MIN_PANE_LAYOUT_CHILDREN} to ${MAX_PANE_LAYOUT_CHILDREN}`;
  }
  for (const [index, child] of node.children.entries()) {
    const nested = findPaneLayoutStructuralError(child, `${path}.children[${index}]`, depth + 1);
    if (nested) {
      return nested;
    }
  }
  return null;
}

export type ParsePaneLayoutFileResult =
  | { ok: true; data: PaneLayoutFile }
  | { ok: false; error: string };

/**
 * The whole gate for one layout file: schema, then structure.
 *
 * Both halves are needed and neither is redundant. The schema bounds types and gives the parsed
 * value its shape; the structural walk catches every malformed split the schema's leaf arm would
 * otherwise swallow through `.passthrough()` — a misspelled `direction`, a one-child split, a
 * fourth nesting level. Callers get one message either way.
 */
export function parsePaneLayoutFile(value: unknown): ParsePaneLayoutFileResult {
  const parsed = PaneLayoutFileSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? issue.path.join(".") : "root";
    return { ok: false, error: `${where}: ${issue?.message ?? "is not a valid layout"}` };
  }
  const structural = findPaneLayoutStructuralError(parsed.data.root);
  if (structural) {
    return { ok: false, error: structural };
  }
  return { ok: true, data: parsed.data };
}
