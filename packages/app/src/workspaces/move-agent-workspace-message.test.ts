import { describe, expect, it } from "vitest";
import { moveAgentWorkspaceErrorMessage } from "./move-agent-workspace-message";

const base = { agentTitle: "Fix the parser", targetTitle: "Release" };

describe("moveAgentWorkspaceErrorMessage", () => {
  it("names the project the target lost when the membership is gone", () => {
    expect(
      moveAgentWorkspaceErrorMessage({ ...base, errorCode: "member_not_found", error: null }),
    ).toBe('"Release" no longer has the project "Fix the parser" runs in.');
  });

  it("explains a same-workspace drop", () => {
    expect(
      moveAgentWorkspaceErrorMessage({ ...base, errorCode: "same_workspace", error: null }),
    ).toBe('"Fix the parser" is already in "Release".');
  });

  it("covers the two refusals only a drag can reach", () => {
    // Neither is reachable from the menu, so nothing else would exercise these strings.
    expect(moveAgentWorkspaceErrorMessage({ ...base, errorCode: "cross_host", error: null })).toBe(
      "Agents can only move between workspaces on the same host.",
    );
    expect(
      moveAgentWorkspaceErrorMessage({ ...base, errorCode: "unsupported_host", error: null }),
    ).toBe("This host is too old to move an agent between workspaces. Update it and try again.");
  });

  it("collapses a missing agent and a missing workspace onto their own messages", () => {
    expect(
      moveAgentWorkspaceErrorMessage({ ...base, errorCode: "agent_not_found", error: null }),
    ).toBe('"Fix the parser" is no longer available.');
    expect(
      moveAgentWorkspaceErrorMessage({ ...base, errorCode: "archived_workspace", error: null }),
    ).toBe("That workspace is no longer available.");
    expect(
      moveAgentWorkspaceErrorMessage({ ...base, errorCode: "workspace_not_found", error: null }),
    ).toBe("That workspace is no longer available.");
  });

  it("passes an unrecognized daemon message through, and names the agent when there is none", () => {
    expect(
      moveAgentWorkspaceErrorMessage({ ...base, errorCode: "weird", error: "Disk is full" }),
    ).toBe("Disk is full");
    expect(moveAgentWorkspaceErrorMessage({ ...base, errorCode: null, error: null })).toBe(
      'Could not move "Fix the parser".',
    );
  });
});
