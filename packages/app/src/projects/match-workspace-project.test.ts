import { describe, expect, test } from "vitest";

import { matchWorkspaceProject } from "./match-workspace-project";

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
