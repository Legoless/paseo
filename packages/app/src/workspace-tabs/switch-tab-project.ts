import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

type DraftTarget = Extract<WorkspaceTabTarget, { kind: "draft" }>;
type AgentTarget = Extract<WorkspaceTabTarget, { kind: "agent" }>;

/** A tab whose project the pane badge can re-point. */
export type SwitchableTabTarget = DraftTarget | AgentTarget;

/**
 * Both cwd fields move together: `setup.cwd` wins once a provider is pinned, and the bare `cwd`
 * carries the pick until one is. Leaving either behind strands the draft on a stale directory.
 */
export function repointDraftTarget(target: DraftTarget, cwd: string): DraftTarget {
  return {
    ...target,
    cwd,
    ...(target.setup ? { setup: { ...target.setup, cwd } } : {}),
  };
}

/**
 * Whether the pane's project badge can re-point this tab. A draft moves in place; an agent is
 * relaunched as a fresh draft in the new directory, because a running agent's cwd is fixed on the
 * daemon. A subagent and a plugin's agent pane borrow the parent agent's directory rather than
 * owning one, so there is nothing to move.
 */
export function canSwitchTabProject(target: WorkspaceTabTarget): target is SwitchableTabTarget {
  return target.kind === "draft" || target.kind === "agent";
}

/**
 * Whether switching costs the user something they have to agree to lose. A draft never has:
 * nothing has run yet. An agent has once a message has been sent, since the relaunch starts a new
 * conversation — `lastUserMessageAt` is the only signal the store carries for that.
 */
export function switchTabProjectNeedsConfirm(input: {
  target: WorkspaceTabTarget;
  lastUserMessageAt: Date | null;
}): boolean {
  return input.target.kind === "agent" && input.lastUserMessageAt !== null;
}
