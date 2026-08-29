import { describe, expect, it } from "vitest";
import type { WorkspaceDescriptorPayload } from "@getpaseo/protocol/messages";
import { addWorkspaceMemberCompletion, workspaceMemberErrorMessage } from "./add-workspace-member";

function createClient(response: {
  workspace?: WorkspaceDescriptorPayload;
  error?: string | null;
  errorCode?: string;
}) {
  return {
    addWorkspaceMember: async () => ({
      requestId: "req-1",
      workspace: response.workspace ?? null,
      error: response.error ?? null,
      ...(response.errorCode ? { errorCode: response.errorCode } : {}),
    }),
    removeWorkspaceMember: async () => ({
      requestId: "req-1",
      workspace: null,
      error: null,
    }),
  };
}

describe("workspaceMemberErrorMessage", () => {
  it("maps duplicate_member to the already-in-workspace copy", () => {
    expect(workspaceMemberErrorMessage({ errorCode: "duplicate_member", error: "daemon" })).toBe(
      "This project is already in the workspace",
    );
  });

  it("maps directory_not_found to the existing not-found copy", () => {
    expect(workspaceMemberErrorMessage({ errorCode: "directory_not_found", error: "daemon" })).toBe(
      "Directory not found",
    );
  });

  it("shows the daemon message for other error codes", () => {
    expect(
      workspaceMemberErrorMessage({
        errorCode: "member_has_active_agents",
        error: "Archive the agents first",
      }),
    ).toBe("Archive the agents first");
  });

  it("falls back to the generic copy when the daemon sent nothing", () => {
    expect(workspaceMemberErrorMessage({ errorCode: null, error: null })).toBe(
      "Unable to add project to workspace",
    );
  });
});

describe("addWorkspaceMemberCompletion", () => {
  it("fails when there is no client", async () => {
    const result = await addWorkspaceMemberCompletion({
      client: null,
      workspaceId: "ws-1",
      path: "/repo",
    });
    expect(result).toEqual({ ok: false, message: "Host is unavailable" });
  });

  it("adds the directory as a workspace member", async () => {
    const calls: Array<{ workspaceId: string; source: unknown }> = [];
    const client = {
      addWorkspaceMember: async (workspaceId: string, source: unknown) => {
        calls.push({ workspaceId, source });
        return {
          requestId: "req-1",
          workspace: { id: "ws-1" } as unknown as WorkspaceDescriptorPayload,
          error: null,
        };
      },
      removeWorkspaceMember: async () => ({
        requestId: "req-1",
        workspace: null,
        error: null,
      }),
    };

    const result = await addWorkspaceMemberCompletion({
      client,
      workspaceId: "ws-1",
      path: "/repo-two",
    });

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([
      { workspaceId: "ws-1", source: { kind: "directory", path: "/repo-two" } },
    ]);
  });

  it("surfaces the mapped error message on failure", async () => {
    const result = await addWorkspaceMemberCompletion({
      client: createClient({ error: "duplicate", errorCode: "duplicate_member" }),
      workspaceId: "ws-1",
      path: "/repo",
    });
    expect(result).toEqual({ ok: false, message: "This project is already in the workspace" });
  });
});
