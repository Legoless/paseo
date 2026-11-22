import { describe, expect, it } from "vitest";
import type { AgentScreenMissingState } from "@/hooks/use-agent-screen-state-machine";
import {
  clearHistorySyncErrorAfterSuccessfulSync,
  reconcileMissingAgentStateWithPresentAgent,
  resolveMissingAgentLookupAction,
} from "./agent-panel-load-state";

describe("reconcileMissingAgentStateWithPresentAgent", () => {
  it("clears lookup-only states once the agent record is present", () => {
    expect(reconcileMissingAgentStateWithPresentAgent({ kind: "resolving" })).toEqual({
      kind: "idle",
    });
    expect(
      reconcileMissingAgentStateWithPresentAgent({
        kind: "not_found",
        message: "Agent not found: agent-1",
      }),
    ).toEqual({ kind: "idle" });
  });

  it("preserves history sync errors while the agent record is present", () => {
    const state: AgentScreenMissingState = {
      kind: "error",
      message: "Failed to get logs: session is archived",
    };

    expect(reconcileMissingAgentStateWithPresentAgent(state)).toBe(state);
  });
});

describe("clearHistorySyncErrorAfterSuccessfulSync", () => {
  it("clears a sync error after a later successful refresh", () => {
    expect(
      clearHistorySyncErrorAfterSuccessfulSync({
        kind: "error",
        message: "Failed to get logs: session is archived",
      }),
    ).toEqual({ kind: "idle" });
  });

  it("leaves non-error states alone", () => {
    const state: AgentScreenMissingState = { kind: "resolving" };

    expect(clearHistorySyncErrorAfterSuccessfulSync(state)).toBe(state);
  });
});

describe("resolveMissingAgentLookupAction", () => {
  it("does not refetch when the agent record is already present on an uncached missing session", () => {
    expect(
      resolveMissingAgentLookupAction({
        hasAgentId: true,
        isArchived: false,
        hasPresentAgent: true,
        canFetch: true,
        visibilityCatchUpStatus: "session_missing",
        missingAgentStateKind: "idle",
      }),
    ).toBe("noop");
  });

  it("reconciles non-idle lookup state once the agent record is present", () => {
    expect(
      resolveMissingAgentLookupAction({
        hasAgentId: true,
        isArchived: false,
        hasPresentAgent: true,
        canFetch: true,
        visibilityCatchUpStatus: "session_missing",
        missingAgentStateKind: "resolving",
      }),
    ).toBe("reconcile_present");
  });

  it("fetches missing agent metadata when session_missing or ready arrives before the agent record", () => {
    expect(
      resolveMissingAgentLookupAction({
        hasAgentId: true,
        isArchived: false,
        hasPresentAgent: false,
        canFetch: true,
        visibilityCatchUpStatus: "session_missing",
        missingAgentStateKind: "idle",
      }),
    ).toBe("fetch");
    expect(
      resolveMissingAgentLookupAction({
        hasAgentId: true,
        isArchived: false,
        hasPresentAgent: false,
        canFetch: true,
        visibilityCatchUpStatus: "ready",
        missingAgentStateKind: "idle",
      }),
    ).toBe("fetch");
  });

  it("waits while catch-up is pending, errored, archived, or lookup is already settled", () => {
    expect(
      resolveMissingAgentLookupAction({
        hasAgentId: true,
        isArchived: false,
        hasPresentAgent: false,
        canFetch: true,
        visibilityCatchUpStatus: "pending",
        missingAgentStateKind: "idle",
      }),
    ).toBe("noop");
    expect(
      resolveMissingAgentLookupAction({
        hasAgentId: true,
        isArchived: true,
        hasPresentAgent: false,
        canFetch: true,
        visibilityCatchUpStatus: "session_missing",
        missingAgentStateKind: "idle",
      }),
    ).toBe("noop");
    expect(
      resolveMissingAgentLookupAction({
        hasAgentId: true,
        isArchived: false,
        hasPresentAgent: false,
        canFetch: true,
        visibilityCatchUpStatus: "session_missing",
        missingAgentStateKind: "resolving",
      }),
    ).toBe("noop");
  });
});
