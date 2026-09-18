import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

type DraftTarget = Extract<WorkspaceTabTarget, { kind: "draft" }>;
type AgentTarget = Extract<WorkspaceTabTarget, { kind: "agent" }>;
type TerminalTarget = Extract<WorkspaceTabTarget, { kind: "terminal" }>;

/** A tab whose project the pane badge can re-point. */
export type SwitchableTabTarget = DraftTarget | AgentTarget | TerminalTarget;

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
 * relaunched as a fresh draft in the new directory, and a terminal is respawned in it, because
 * neither a running agent's cwd nor a live shell's can be moved from outside. A subagent and a
 * plugin's agent pane borrow the parent agent's directory rather than owning one, so there is
 * nothing to move.
 */
export function canSwitchTabProject(target: WorkspaceTabTarget): target is SwitchableTabTarget {
  return target.kind === "draft" || target.kind === "agent" || target.kind === "terminal";
}

/**
 * Whether switching costs the user something they have to agree to lose. A draft never has:
 * nothing has run yet. An agent has once a message has been sent, since the relaunch starts a new
 * conversation — `lastUserMessageAt` is the only signal the store carries for that. A terminal
 * always has, because its shell is replaced rather than moved.
 */
export function switchTabProjectNeedsConfirm(input: {
  target: WorkspaceTabTarget;
  lastUserMessageAt: Date | null;
}): boolean {
  // A terminal always has: the shell it is replaced by starts cold, losing scrollback and whatever
  // was running.
  if (input.target.kind === "terminal") {
    return true;
  }
  return input.target.kind === "agent" && input.lastUserMessageAt !== null;
}
