// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import { seedSessionWorkspaces } from "@/test/seed-session";
import {
  useMemberHasDiffStat,
  useVisibleMemberDiffStat,
  useWorkspaceHasDiffStat,
} from "./workspace-diff-stat";

const SERVER_ID = "diff-stat-pill";
const WORKSPACE_ID = "workspace";

const workspace: WorkspaceDescriptor = {
  id: WORKSPACE_ID,
  projectId: "project",
  projectDisplayName: "Project",
  projectRootPath: "/repo",
  workspaceDirectory: "/repo",
  projectKind: "git",
  workspaceKind: "local_checkout",
  name: "main",
  status: "done",
  statusEnteredAt: null,
  archivingAt: null,
  diffStat: null,
  scripts: [],
  members: [
    {
      projectId: "project",
      projectDisplayName: "Project",
      projectCustomName: null,
      projectRootPath: "/repo",
      workspaceDirectory: "/repo",
      workspaceKind: "local_checkout",
      worktreeSlug: null,
      branch: null,
    },
  ],
};

function setDiffStat(diffStat: WorkspaceDescriptor["diffStat"]): void {
  useSessionStore.getState().setWorkspaces(SERVER_ID, (workspaces) => {
    const next = new Map(workspaces);
    next.set(WORKSPACE_ID, { ...workspace, diffStat });
    return next;
  });
}

describe("useWorkspaceHasDiffStat", () => {
  beforeEach(() => {
    useSessionStore.getState().initializeSession(SERVER_ID, null as unknown as DaemonClient);
    seedSessionWorkspaces(SERVER_ID, new Map([[WORKSPACE_ID, workspace]]));
  });

  afterEach(() => {
    useSessionStore.getState().clearSession(SERVER_ID);
  });

  it("does not re-render its owner when only the visible counts change", () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useWorkspaceHasDiffStat(SERVER_ID, WORKSPACE_ID);
    });

    expect(result.current).toBe(false);
    expect(renderCount).toBe(1);

    act(() => setDiffStat({ additions: 2, deletions: 0 }));
    expect(result.current).toBe(true);
    expect(renderCount).toBe(2);

    act(() => setDiffStat({ additions: 5, deletions: 3 }));
    expect(result.current).toBe(true);
    expect(renderCount).toBe(2);

    act(() => setDiffStat(null));
    expect(result.current).toBe(false);
    expect(renderCount).toBe(3);
  });
});

describe("member-specific diff stat hooks", () => {
  const multiMemberWorkspace: WorkspaceDescriptor = {
    ...workspace,
    diffStat: { additions: 50, deletions: 10 },
    members: [
      {
        projectId: "proj-a",
        projectDisplayName: "Project A",
        projectCustomName: null,
        projectRootPath: "/repo/a",
        workspaceDirectory: "/repo/a",
        workspaceKind: "local_checkout",
        worktreeSlug: null,
        branch: null,
        diffStat: { additions: 42, deletions: 2 },
      },
      {
        projectId: "proj-b",
        projectDisplayName: "Project B",
        projectCustomName: null,
        projectRootPath: "/repo/b",
        workspaceDirectory: "/repo/b",
        workspaceKind: "local_checkout",
        worktreeSlug: null,
        branch: null,
        diffStat: null,
      },
    ],
  };

  beforeEach(() => {
    useSessionStore.getState().initializeSession(SERVER_ID, null as unknown as DaemonClient);
    seedSessionWorkspaces(SERVER_ID, new Map([[WORKSPACE_ID, multiMemberWorkspace]]));
  });

  afterEach(() => {
    useSessionStore.getState().clearSession(SERVER_ID);
  });

  it("resolves member-specific diff stat per agent cwd in a multi-member workspace", () => {
    const { result: resultA } = renderHook(() =>
      useVisibleMemberDiffStat(SERVER_ID, WORKSPACE_ID, "/repo/a"),
    );
    expect(resultA.current).toEqual({ additions: 42, deletions: 2 });

    const { result: resultB } = renderHook(() =>
      useVisibleMemberDiffStat(SERVER_ID, WORKSPACE_ID, "/repo/b"),
    );
    expect(resultB.current).toBeNull();

    const { result: hasDiffA } = renderHook(() =>
      useMemberHasDiffStat(SERVER_ID, WORKSPACE_ID, "/repo/a"),
    );
    expect(hasDiffA.current).toBe(true);

    const { result: hasDiffB } = renderHook(() =>
      useMemberHasDiffStat(SERVER_ID, WORKSPACE_ID, "/repo/b"),
    );
    expect(hasDiffB.current).toBe(false);
  });

  it("handles normalized path comparisons with trailing slashes and backslashes", () => {
    const { result } = renderHook(() =>
      useVisibleMemberDiffStat(SERVER_ID, WORKSPACE_ID, "/repo/a/"),
    );
    expect(result.current).toEqual({ additions: 42, deletions: 2 });
  });

  it("returns null for uncategorized cwds in a multi-member workspace", () => {
    const { result } = renderHook(() =>
      useVisibleMemberDiffStat(SERVER_ID, WORKSPACE_ID, "/other/path"),
    );
    expect(result.current).toBeNull();
  });

  it("falls back to workspace diffStat when workspace has a single member", () => {
    seedSessionWorkspaces(
      SERVER_ID,
      new Map([
        [
          WORKSPACE_ID,
          {
            ...workspace,
            diffStat: { additions: 5, deletions: 1 },
            members: [workspace.members[0]!],
          },
        ],
      ]),
    );

    const { result } = renderHook(() =>
      useVisibleMemberDiffStat(SERVER_ID, WORKSPACE_ID, "/some/cwd"),
    );
    expect(result.current).toEqual({ additions: 5, deletions: 1 });
  });
});
