export type WorkspaceRenameOutcome =
  | { kind: "unchanged" }
  | { kind: "reset" }
  | { kind: "rename"; title: string };

/**
 * What committing the sidebar's inline name editor should do.
 *
 * Enter on an untouched field is the common case — a workspace is created and
 * named in one keystroke — so it must cost nothing. Clearing the field asks for
 * the derived name back rather than for an empty one, which for a workspace with
 * no projects is "New workspace".
 */
export function resolveWorkspaceRenameOutcome(input: {
  value: string;
  /** The user-set title, or null when the name is derived. */
  title: string | null;
  /** The name shown today, derived or otherwise. */
  name: string;
}): WorkspaceRenameOutcome {
  const trimmed = input.value.trim();
  if (trimmed.length === 0) {
    // Already derived: there is no override to clear.
    return input.title === null ? { kind: "unchanged" } : { kind: "reset" };
  }
  if (trimmed === (input.title ?? input.name)) return { kind: "unchanged" };
  return { kind: "rename", title: trimmed };
}
