import { describe, expect, test } from "vitest";

import { repointDraftTarget } from "./pane-project-badge";

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
