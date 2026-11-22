import type { AgentScreenMissingState } from "@/hooks/use-agent-screen-state-machine";
import type { ViewedTimelineStatus } from "@/timeline/viewed-timeline-sync";

export function reconcileMissingAgentStateWithPresentAgent(
  state: AgentScreenMissingState,
): AgentScreenMissingState {
  if (state.kind === "resolving" || state.kind === "not_found") {
    return { kind: "idle" };
  }
  return state;
}

export function clearHistorySyncErrorAfterSuccessfulSync(
  state: AgentScreenMissingState,
): AgentScreenMissingState {
  if (state.kind === "error") {
    return { kind: "idle" };
  }
  return state;
}

export type MissingAgentLookupAction = "noop" | "reconcile_present" | "fetch";

export function resolveMissingAgentLookupAction(input: {
  hasAgentId: boolean;
  isArchived: boolean;
  hasPresentAgent: boolean;
  canFetch: boolean;
  visibilityCatchUpStatus: ViewedTimelineStatus;
  missingAgentStateKind: AgentScreenMissingState["kind"];
}): MissingAgentLookupAction {
  if (!input.hasAgentId || input.isArchived) {
    return "noop";
  }
  if (input.hasPresentAgent) {
    return input.missingAgentStateKind === "resolving" ||
      input.missingAgentStateKind === "not_found" ||
      input.missingAgentStateKind === "error"
      ? "reconcile_present"
      : "noop";
  }
  if (
    !input.canFetch ||
    (input.visibilityCatchUpStatus !== "ready" &&
      input.visibilityCatchUpStatus !== "session_missing")
  ) {
    return "noop";
  }
  if (
    input.missingAgentStateKind === "resolving" ||
    input.missingAgentStateKind === "not_found" ||
    input.missingAgentStateKind === "error"
  ) {
    return "noop";
  }
  return "fetch";
}
