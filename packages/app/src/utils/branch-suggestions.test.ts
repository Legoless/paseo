import { describe, expect, it } from "vitest";
import {
  buildBranchComboOptions,
  buildBranchWorktreeOptions,
  normalizeBranchOptionName,
} from "./branch-suggestions";

describe("normalizeBranchOptionName", () => {
  it("normalizes local and origin-prefixed refs", () => {
    expect(normalizeBranchOptionName("refs/heads/main")).toBe("main");
    expect(normalizeBranchOptionName("refs/remotes/origin/main")).toBe("main");
    expect(normalizeBranchOptionName("origin/feature/test")).toBe("feature/test");
    expect(normalizeBranchOptionName("feature/test")).toBe("feature/test");
  });

  it("filters out empty values and HEAD", () => {
    expect(normalizeBranchOptionName("")).toBeNull();
    expect(normalizeBranchOptionName("   ")).toBeNull();
    expect(normalizeBranchOptionName("HEAD")).toBeNull();
    expect(normalizeBranchOptionName("origin/HEAD")).toBeNull();
  });
});

describe("buildBranchComboOptions", () => {
  it("merges branch sources and de-duplicates normalized names", () => {
    const options = buildBranchComboOptions({
      suggestedBranches: ["origin/main", "refs/remotes/origin/main", "feature/a"],
      currentBranch: "refs/heads/feature/a",
      baseRef: "origin/main",
      typedBaseBranch: "main",
      worktreeBranchLabels: ["refs/heads/release/next"],
    });

    expect(options).toEqual([
      { id: "main", label: "main" },
      { id: "feature/a", label: "feature/a" },
      { id: "release/next", label: "release/next" },
    ]);
  });
});

describe("buildBranchWorktreeOptions", () => {
  it("keeps branches distinct from worktrees and merges only the current project's directories", () => {
    expect(
      buildBranchWorktreeOptions({
        branches: [
          { id: "main", label: "main" },
          { id: "feature", label: "feature" },
        ],
        cwd: "/repo",
        projectId: "project-a",
        projectRootPath: "/repo",
        worktrees: [
          { worktreePath: "/repo", branchName: "main" },
          { worktreePath: "/trees/feature", branchName: "feature" },
        ],
        members: [
          {
            projectId: "project-a",
            projectRootPath: "/repo",
            workspaceDirectory: "/trees/feature",
            branch: "feature",
          },
          {
            projectId: "project-a",
            projectRootPath: "/repo",
            workspaceDirectory: "/trees/release",
            branch: "release",
          },
          {
            projectId: "project-b",
            projectRootPath: "/other",
            workspaceDirectory: "/other",
            branch: "main",
          },
        ],
      }),
    ).toEqual([
      { id: "branch:main", label: "main" },
      { id: "branch:feature", label: "feature" },
      {
        id: "worktree:/trees/feature",
        label: "feature",
        description: "/trees/feature",
        kind: "directory",
      },
      {
        id: "worktree:/trees/release",
        label: "release",
        description: "/trees/release",
        kind: "directory",
      },
    ]);
  });
});
