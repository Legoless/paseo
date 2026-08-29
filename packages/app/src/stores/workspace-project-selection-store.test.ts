// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  useSessionStore,
  type WorkspaceDescriptor,
  type WorkspaceMemberDescriptor,
} from "@/stores/session-store";
import {
  resolveSelectedWorkspaceMember,
  useSelectedWorkspaceProject,
  useWorkspaceProjectSelectionStore,
} from "./workspace-project-selection-store";

const SERVER_ID = "test-server";
const WORKSPACE_ID = "workspace-1";

function createMember(
  input: Partial<WorkspaceMemberDescriptor> &
    Pick<WorkspaceMemberDescriptor, "projectId" | "workspaceDirectory">,
): WorkspaceMemberDescriptor {
  return {
    projectId: input.projectId,
    projectDisplayName: input.projectDisplayName ?? input.projectId,
    projectCustomName: input.projectCustomName ?? null,
    projectRootPath: input.projectRootPath ?? input.workspaceDirectory,
    workspaceDirectory: input.workspaceDirectory,
    workspaceKind: input.workspaceKind ?? "local_checkout",
    worktreeSlug: input.worktreeSlug ?? null,
    branch: input.branch ?? null,
  };
}

const PRIMARY_MEMBER = createMember({
  projectId: "project-1",
  projectDisplayName: "Project 1",
  workspaceDirectory: "/repo-one",
});
const SECOND_MEMBER = createMember({
  projectId: "project-2",
  projectDisplayName: "Project 2",
  workspaceDirectory: "/repo-two",
});

function createWorkspace(members: WorkspaceMemberDescriptor[]): WorkspaceDescriptor {
  return {
    id: WORKSPACE_ID,
    projectId: PRIMARY_MEMBER.projectId,
    projectDisplayName: PRIMARY_MEMBER.projectDisplayName,
    projectRootPath: PRIMARY_MEMBER.projectRootPath,
    workspaceDirectory: PRIMARY_MEMBER.workspaceDirectory,
    projectKind: "git",
    workspaceKind: "local_checkout",
    name: "main",
    status: "done",
    archivingAt: null,
    statusEnteredAt: null,
    diffStat: null,
    scripts: [],
    members,
  };
}

function seedWorkspace(members: WorkspaceMemberDescriptor[]): void {
  const store = useSessionStore.getState();
  store.setWorkspaces(SERVER_ID, new Map([[WORKSPACE_ID, createWorkspace(members)]]));
}

afterEach(() => {
  useWorkspaceProjectSelectionStore.setState({ selectedCwdByWorkspaceKey: {} });
  useSessionStore.getState().initializeSession(SERVER_ID, null as unknown as DaemonClient);
});

describe("resolveSelectedWorkspaceMember", () => {
  it("defaults to the primary member when nothing is stored", () => {
    expect(
      resolveSelectedWorkspaceMember({
        members: [PRIMARY_MEMBER, SECOND_MEMBER],
        selectedCwd: null,
      }),
    ).toBe(PRIMARY_MEMBER);
  });

  it("returns the member matching the stored cwd", () => {
    expect(
      resolveSelectedWorkspaceMember({
        members: [PRIMARY_MEMBER, SECOND_MEMBER],
        selectedCwd: SECOND_MEMBER.workspaceDirectory,
      }),
    ).toBe(SECOND_MEMBER);
  });

  it("falls back to the primary member when the stored cwd is no longer a member", () => {
    expect(
      resolveSelectedWorkspaceMember({
        members: [PRIMARY_MEMBER],
        selectedCwd: SECOND_MEMBER.workspaceDirectory,
      }),
    ).toBe(PRIMARY_MEMBER);
  });

  it("returns null when the workspace has no members", () => {
    expect(resolveSelectedWorkspaceMember({ members: [], selectedCwd: null })).toBeNull();
  });
});

describe("useSelectedWorkspaceProject", () => {
  it("returns the primary member by default and follows setSelected", () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null as unknown as DaemonClient);
    seedWorkspace([PRIMARY_MEMBER, SECOND_MEMBER]);

    const { result } = renderHook(() => useSelectedWorkspaceProject(SERVER_ID, WORKSPACE_ID));

    expect(result.current.cwd).toBe(PRIMARY_MEMBER.workspaceDirectory);
    expect(result.current.member).toEqual(PRIMARY_MEMBER);
    expect(result.current.members).toHaveLength(2);

    act(() => {
      result.current.setSelected(SECOND_MEMBER.workspaceDirectory);
    });

    expect(result.current.cwd).toBe(SECOND_MEMBER.workspaceDirectory);
    expect(result.current.member).toEqual(SECOND_MEMBER);
  });

  it("falls back to the primary member after the selected member is removed", () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null as unknown as DaemonClient);
    seedWorkspace([PRIMARY_MEMBER, SECOND_MEMBER]);

    const { result } = renderHook(() => useSelectedWorkspaceProject(SERVER_ID, WORKSPACE_ID));
    act(() => {
      result.current.setSelected(SECOND_MEMBER.workspaceDirectory);
    });
    expect(result.current.cwd).toBe(SECOND_MEMBER.workspaceDirectory);

    act(() => {
      seedWorkspace([PRIMARY_MEMBER]);
    });

    expect(result.current.cwd).toBe(PRIMARY_MEMBER.workspaceDirectory);
    expect(result.current.member).toEqual(PRIMARY_MEMBER);
  });

  it("scopes the selection per workspace key", () => {
    useSessionStore.getState().initializeSession(SERVER_ID, null as unknown as DaemonClient);
    seedWorkspace([PRIMARY_MEMBER, SECOND_MEMBER]);

    const { result } = renderHook(() => useSelectedWorkspaceProject(SERVER_ID, WORKSPACE_ID));
    act(() => {
      result.current.setSelected(SECOND_MEMBER.workspaceDirectory);
    });

    expect(
      useWorkspaceProjectSelectionStore.getState().selectedCwdByWorkspaceKey[
        `${SERVER_ID}:${WORKSPACE_ID}`
      ],
    ).toBe(SECOND_MEMBER.workspaceDirectory);

    const { result: otherResult } = renderHook(() =>
      useSelectedWorkspaceProject(SERVER_ID, "other-workspace"),
    );
    expect(otherResult.current.cwd).toBeNull();
  });
});
