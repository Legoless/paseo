/**
 * A titleless agent has nothing to show yet, so the tab shimmers until the title
 * lands. Anything the daemon does hold is the user's to read back verbatim —
 * including "New Agent", which the rename modal accepts like any other name.
 */
export function resolveWorkspaceAgentTabLabel(title: string | null | undefined): string | null {
  if (typeof title !== "string") {
    return null;
  }
  const normalized = title.trim();
  return normalized ? normalized : null;
}
