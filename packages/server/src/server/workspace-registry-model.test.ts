import { describe, expect, test } from "vitest";
import { isAbsolute } from "node:path";

import {
  checkoutFromPersistedWorkspacePlacement,
  deriveWorkspaceKind,
  generateWorkspaceId,
  generateProjectId,
  initialWorkspacePlacement,
  reconcileWorkspacePlacement,
  isProjectlessWorkspace,
  workspaceMembers,
} from "./workspace-registry-model.js";
import { createPersistedWorkspaceRecord } from "./workspace-registry.js";

describe("opaque registry ids", () => {
  test("generates opaque project ids", () => {
    expect(generateProjectId()).toMatch(/^prj_[0-9a-f]{16}$/);
  });

  test("generates opaque workspace ids that are not filesystem paths", () => {
    const workspaceId = generateWorkspaceId();

    expect(workspaceId).toMatch(/^wks_[0-9a-f]+$/);
    expect(isAbsolute(workspaceId)).toBe(false);
  });
});

describe("workspace kind", () => {
  test("classifies plain git worktrees as workspaces of kind worktree", () => {
    expect(
      deriveWorkspaceKind({
        cwd: "/tmp/repo-feature",
        isGit: true,
        currentBranch: "feature/plain",
        remoteUrl: "https://github.com/acme/repo.git",
        worktreeRoot: "/tmp/repo-feature",
        isPaseoOwnedWorktree: false,
        mainRepoRoot: "/tmp/repo",
      }),
    ).toBe("worktree");
  });
});

describe("workspace placement", () => {
  test("defines checkout and created-worktree placement completely", () => {
    expect(
      initialWorkspacePlacement({
        source: "checkout",
        cwd: "/repo",
        checkout: {
          cwd: "/repo",
          isGit: true,
          currentBranch: " main ",
          remoteUrl: null,
          worktreeRoot: "/repo",
          isPaseoOwnedWorktree: false,
          mainRepoRoot: null,
        },
      }),
    ).toEqual({
      cwd: "/repo",
      kind: "local_checkout",
      displayName: "main",
      branch: "main",
      worktreeRoot: "/repo",
      baseBranch: null,
      isPaseoOwnedWorktree: false,
      mainRepoRoot: null,
    });
    expect(
      initialWorkspacePlacement({
        source: "created_worktree",
        cwd: "/repo-feature/app",
        worktreeRoot: "/repo-feature",
        branch: "feature/placement",
        baseBranch: "main",
        mainRepoRoot: "/repo",
      }),
    ).toEqual({
      cwd: "/repo-feature/app",
      kind: "worktree",
      displayName: "feature/placement",
      branch: "feature/placement",
      worktreeRoot: "/repo-feature",
      baseBranch: "main",
      isPaseoOwnedWorktree: true,
      mainRepoRoot: "/repo",
    });
  });

  test("updates live placement while preserving its durable name and base branch", () => {
    const workspace = createPersistedWorkspaceRecord({
      workspaceId: "workspace-one",
      displayName: "Keep this name",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
      members: [
        {
          projectId: "project-one",
          cwd: "/repo-feature",
          kind: "worktree",
          displayName: "Keep this name",
          branch: "old-branch",
          worktreeRoot: "/old-root",
          baseBranch: "release",
          isPaseoOwnedWorktree: true,
          mainRepoRoot: "/repo",
        },
      ],
    });

    const update = reconcileWorkspacePlacement({
      member: workspace.members[0],
      checkout: {
        cwd: workspace.members[0].cwd,
        isGit: true,
        currentBranch: "renamed-branch",
        remoteUrl: null,
        worktreeRoot: "/repo-feature",
        isPaseoOwnedWorktree: false,
        mainRepoRoot: "/repo",
      },
    });

    expect(update?.fields).toEqual({
      branch: "renamed-branch",
      worktreeRoot: "/repo-feature",
      isPaseoOwnedWorktree: false,
    });
    expect(update?.member).toMatchObject({
      displayName: "Keep this name",
      baseBranch: "release",
      branch: "renamed-branch",
    });
  });

  test("projects persisted placement to the wire checkout", () => {
    const workspace = createPersistedWorkspaceRecord({
      workspaceId: "workspace-one",
      displayName: "feature",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
      members: [
        {
          projectId: "project-one",
          cwd: "/repo-feature/app",
          kind: "worktree",
          displayName: "feature",
          branch: "feature",
          worktreeRoot: "/repo-feature",
          isPaseoOwnedWorktree: true,
          mainRepoRoot: "/repo",
          baseBranch: null,
        },
      ],
    });

    expect(checkoutFromPersistedWorkspacePlacement({ member: workspace.members[0] })).toEqual({
      cwd: "/repo-feature/app",
      isGit: true,
      currentBranch: "feature",
      remoteUrl: null,
      worktreeRoot: "/repo-feature",
      isPaseoOwnedWorktree: true,
      mainRepoRoot: "/repo",
    });
  });
});

describe("workspace members", () => {
  const primaryMember = {
    projectId: "project-one",
    cwd: "/repo",
    kind: "local_checkout" as const,
    displayName: "main",
    branch: "main",
    worktreeRoot: "/repo",
    baseBranch: null,
    isPaseoOwnedWorktree: false,
    mainRepoRoot: null,
  };
  const secondaryMember = {
    projectId: "project-two",
    cwd: "/other",
    kind: "directory" as const,
    displayName: "other",
    branch: null,
    worktreeRoot: null,
    baseBranch: null,
    isPaseoOwnedWorktree: false,
    mainRepoRoot: null,
  };

  test("preserves each member independently of the container name", () => {
    const record = createPersistedWorkspaceRecord({
      workspaceId: "workspace-one",
      displayName: "Independent container",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
      members: [primaryMember, secondaryMember],
    });
    expect(workspaceMembers(record)).toEqual([primaryMember, secondaryMember]);
    expect(isProjectlessWorkspace(record)).toBe(false);
    expect(record).not.toHaveProperty("projectId");
    expect(record).not.toHaveProperty("cwd");
  });

  test("an empty container needs no placement", () => {
    const record = createPersistedWorkspaceRecord({
      workspaceId: "workspace-empty",
      displayName: "Empty",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
      members: [],
    });
    expect(workspaceMembers(record)).toEqual([]);
    expect(isProjectlessWorkspace(record)).toBe(true);
    expect(record).not.toHaveProperty("projectId");
    expect(record).not.toHaveProperty("cwd");
  });
});
