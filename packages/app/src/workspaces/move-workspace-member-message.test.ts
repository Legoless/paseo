import { describe, expect, it } from "vitest";
import { moveWorkspaceMemberErrorMessage } from "./move-workspace-member-message";

const base = { projectName: "paseo", targetTitle: "Release" };

describe("moveWorkspaceMemberErrorMessage", () => {
  it("names both sides of a duplicate refusal", () => {
    expect(
      moveWorkspaceMemberErrorMessage({ ...base, errorCode: "duplicate_member", error: null }),
    ).toBe('"paseo" is already part of "Release".');
  });

  it("explains a source that no longer holds the project", () => {
    expect(
      moveWorkspaceMemberErrorMessage({ ...base, errorCode: "member_not_found", error: null }),
    ).toBe('"paseo" is no longer part of the source workspace.');
  });

  it("covers the cross-host refusal, which only a drag can reach", () => {
    // The move menu lists one host's workspaces, so nothing else exercises this string.
    expect(moveWorkspaceMemberErrorMessage({ ...base, errorCode: "cross_host", error: null })).toBe(
      "Projects can only move between workspaces on the same host.",
    );
  });

  it("collapses a missing and an archived workspace onto one message", () => {
    expect(
      moveWorkspaceMemberErrorMessage({ ...base, errorCode: "workspace_not_found", error: null }),
    ).toBe("That workspace is no longer available.");
    expect(
      moveWorkspaceMemberErrorMessage({ ...base, errorCode: "archived_workspace", error: null }),
    ).toBe("That workspace is no longer available.");
  });

  it("passes an unrecognized daemon message through, and names the project when there is none", () => {
    expect(
      moveWorkspaceMemberErrorMessage({ ...base, errorCode: "weird", error: "Disk is full" }),
    ).toBe("Disk is full");
    expect(moveWorkspaceMemberErrorMessage({ ...base, errorCode: null, error: null })).toBe(
      'Could not move "paseo".',
    );
  });
});
