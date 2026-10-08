import { describe, expect, test } from "vitest";

import { matchWorkspaceProject, matchPaneWorkspaceProject } from "./match-workspace-project";

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

describe("pane project presentation", () => {
  const options = [
    { cwd: "/repos/belle", label: "Belle", path: "~/repos/belle" },
    {
      cwd: "/repos/belle/.worktrees/registered",
      label: "Registered worktree",
      path: "~/registered",
    },
  ];
  const members = [
    { workspaceDirectory: "/repos/belle", projectRootPath: "/repos/belle" },
    { workspaceDirectory: "/repos/belle/.worktrees/registered", projectRootPath: "/repos/belle" },
  ];

  test("names a worktree's repository while keeping exact workspace membership unchanged", () => {
    const cwd = "/repos/belle/.worktrees/docs";
    expect(
      matchPaneWorkspaceProject({ options, members, cwd, projectRoot: "/repos/belle/" }),
    ).toEqual(options[0]);
    expect(matchWorkspaceProject(options, cwd)).toBeNull();
  });

  test("prefers an exact member and leaves unrelated repositories unassigned", () => {
    expect(
      matchPaneWorkspaceProject({
        options,
        members,
        cwd: "/repos/belle/.worktrees/registered",
        projectRoot: "/repos/belle",
      }),
    ).toEqual(options[1]);
    expect(
      matchPaneWorkspaceProject({
        options,
        members,
        cwd: "/repos/other/.worktrees/docs",
        projectRoot: "/repos/other",
      }),
    ).toBeNull();
    expect(
      matchPaneWorkspaceProject({
        options,
        members,
        cwd: "/repos/belle/.worktrees/docs",
        projectRoot: null,
      }),
    ).toBeNull();
  });
});
