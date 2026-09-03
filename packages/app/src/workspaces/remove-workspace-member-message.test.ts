import { describe, expect, test } from "vitest";

import {
  buildRemoveWorkspaceMemberDialog,
  removeWorkspaceMemberErrorMessage,
} from "./remove-workspace-member-message";

const projectName = "legoless";

describe("removeWorkspaceMemberErrorMessage", () => {
  test("names what is blocking the removal and what to do about it", () => {
    expect(
      removeWorkspaceMemberErrorMessage({
        errorCode: "member_has_active_agents",
        error: "Workspace wks_1 has an active agent at /Users/legoless",
        projectName,
      }),
    ).toBe('"legoless" still has agents. Archive them, then remove the project.');

    expect(
      removeWorkspaceMemberErrorMessage({
        errorCode: "member_has_live_terminals",
        error: null,
        projectName,
      }),
    ).toBe('"legoless" still has a running terminal. Close it, then remove the project.');

    expect(
      removeWorkspaceMemberErrorMessage({ errorCode: "last_member", error: null, projectName }),
    ).toBe("A workspace keeps at least one project. Add another before removing this one.");
  });

  test("falls back to the daemon's own words, then to a plain failure", () => {
    // An unrecognised code still has to say something: the daemon message beats silence, and the
    // silent Alert.alert this replaced is what made a refusal look like a dead button.
    expect(
      removeWorkspaceMemberErrorMessage({
        errorCode: "something_new",
        error: "Disk is read-only",
        projectName,
      }),
    ).toBe("Disk is read-only");

    expect(removeWorkspaceMemberErrorMessage({ errorCode: null, error: null, projectName })).toBe(
      "Could not remove the project from this workspace.",
    );
  });
});

describe("buildRemoveWorkspaceMemberDialog", () => {
  test("names the agents the removal will archive", () => {
    expect(buildRemoveWorkspaceMemberDialog({ projectName, agentCount: 0 }).message).toBe(
      '"legoless" will no longer be part of this workspace. Its directory stays on disk.',
    );
    expect(buildRemoveWorkspaceMemberDialog({ projectName, agentCount: 1 }).message).toBe(
      '"legoless" will no longer be part of this workspace, and its agent will be archived. Its directory stays on disk.',
    );
    expect(buildRemoveWorkspaceMemberDialog({ projectName, agentCount: 5 }).message).toBe(
      '"legoless" will no longer be part of this workspace, and its 5 agents will be archived. Its directory stays on disk.',
    );
  });

  test("stays destructive so the confirm button carries the warning", () => {
    expect(buildRemoveWorkspaceMemberDialog({ projectName, agentCount: 0 })).toMatchObject({
      title: "Remove project from workspace?",
      confirmLabel: "Remove",
      destructive: true,
    });
  });
});
