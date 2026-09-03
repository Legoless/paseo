import { describe, expect, test } from "vitest";

import {
  canSwitchTabProject,
  repointDraftTarget,
  switchTabProjectNeedsConfirm,
} from "./switch-tab-project";

describe("repointDraftTarget", () => {
  test("moves the bare cwd on a draft that has no setup yet", () => {
    expect(
      repointDraftTarget({ kind: "draft", draftId: "d1", cwd: "/repo-one" }, "/repo-two"),
    ).toEqual({ kind: "draft", draftId: "d1", cwd: "/repo-two" });
  });

  test("moves setup.cwd and the bare cwd together, keeping every other setup field", () => {
    const setup = {
      provider: "claude" as const,
      cwd: "/repo-one",
      modeId: "plan",
      model: "opus",
      thinkingOptionId: "high",
      featureValues: { fast: true },
    };

    expect(
      repointDraftTarget({ kind: "draft", draftId: "d1", cwd: "/repo-one", setup }, "/repo-two"),
    ).toEqual({
      kind: "draft",
      draftId: "d1",
      cwd: "/repo-two",
      setup: { ...setup, cwd: "/repo-two" },
    });
  });
});

describe("canSwitchTabProject", () => {
  test("moves a draft and an agent, both of which own a directory", () => {
    expect(canSwitchTabProject({ kind: "draft", draftId: "d1" })).toBe(true);
    expect(canSwitchTabProject({ kind: "agent", agentId: "a1" })).toBe(true);
  });

  test("leaves alone every tab that borrows its directory or has none", () => {
    // A subagent and a plugin agent pane resolve their cwd from the parent agent, and a file or a
    // diff is a project being looked at rather than one that can be reassigned.
    expect(
      canSwitchTabProject({ kind: "provider_subagent", parentAgentId: "a1", subagentId: "s1" }),
    ).toBe(false);
    expect(canSwitchTabProject({ kind: "terminal", terminalId: "t1" })).toBe(false);
    expect(canSwitchTabProject({ kind: "new_tab" })).toBe(false);
    expect(canSwitchTabProject({ kind: "changes_tree" })).toBe(false);
  });
});

describe("switchTabProjectNeedsConfirm", () => {
  test("asks before discarding a conversation the user has started", () => {
    expect(
      switchTabProjectNeedsConfirm({
        target: { kind: "agent", agentId: "a1" },
        lastUserMessageAt: new Date(0),
      }),
    ).toBe(true);
  });

  test("stays out of the way when there is nothing to lose", () => {
    expect(
      switchTabProjectNeedsConfirm({
        target: { kind: "agent", agentId: "a1" },
        lastUserMessageAt: null,
      }),
    ).toBe(false);
    expect(
      switchTabProjectNeedsConfirm({
        target: { kind: "draft", draftId: "d1" },
        lastUserMessageAt: null,
      }),
    ).toBe(false);
  });
});
