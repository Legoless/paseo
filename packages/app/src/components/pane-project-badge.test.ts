import { describe, expect, test } from "vitest";

import { matchWorkspaceProject, repointDraftTarget } from "./pane-project-badge";

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

describe("matchWorkspaceProject", () => {
  const options = [
    { cwd: "/repos/polypep", label: "polypep", path: "~/repos/polypep" },
    { cwd: "/repos/other", label: "other", path: "~/repos/other" },
  ];

  test("matches a member directory, ignoring trailing slashes and separator style", () => {
    expect(matchWorkspaceProject(options, "/repos/polypep")?.label).toBe("polypep");
    expect(matchWorkspaceProject(options, "/repos/polypep/")?.label).toBe("polypep");
    expect(matchWorkspaceProject(options, "\\repos\\polypep")?.label).toBe("polypep");
  });

  test("treats a directory no member owns as uncategorized", () => {
    // The home directory an unassigned agent runs in, and a subdirectory of a member: the sidebar
    // files both under Uncategorized, so neither names a project here either.
    expect(matchWorkspaceProject(options, "/Users/someone")).toBeNull();
    expect(matchWorkspaceProject(options, "/repos/polypep/packages/app")).toBeNull();
    expect(matchWorkspaceProject(options, "  ")).toBeNull();
  });

  test("has nothing to match against in a workspace with no members", () => {
    expect(matchWorkspaceProject([], "/repos/polypep")).toBeNull();
  });
});
