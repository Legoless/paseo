import { describe, expect, it } from "vitest";
import {
  createWorkspaceCreationKey,
  WorkspaceCreationFailedError,
} from "./new-workspace-creation-key";

describe("createWorkspaceCreationKey", () => {
  it("reuses one key while sends succeed, so a double submit is one creation", async () => {
    const keys = createWorkspaceCreationKey("draft-1");
    const used: string[] = [];

    await keys.run(async (key) => used.push(key));
    await keys.run(async (key) => used.push(key));

    expect(used).toEqual(["draft-1", "draft-1"]);
  });

  it("sends an edited retry under a fresh key after a failed creation", async () => {
    // A daemon receipt: the key is bound to the first request it saw, failed or not.
    const receipts = new Map<string, string>();
    const createWorkspace = async (key: string, prompt: string) => {
      const seen = receipts.get(key);
      if (seen !== undefined && seen !== prompt) throw new Error("workspace_request_key_conflict");
      receipts.set(key, prompt);
      if (prompt === "broken") {
        throw new WorkspaceCreationFailedError("Directory not found", {
          workspace: null,
          errorCode: "directory_not_found",
        });
      }
      return key;
    };
    const keys = createWorkspaceCreationKey("draft-1", () => new Date(5_000));

    await expect(keys.run((key) => createWorkspace(key, "broken"))).rejects.toThrow(
      "Directory not found",
    );
    const created = await keys.run((key) => createWorkspace(key, "edited"));

    expect(created).not.toBe("draft-1");
    expect(created.startsWith("draft-1:")).toBe(true);
  });

  it("gives every confirmed failure its own key, even within one millisecond", async () => {
    const keys = createWorkspaceCreationKey("draft-1", () => new Date(5_000));
    const used: string[] = [];
    const fail = async (key: string) => {
      used.push(key);
      throw new WorkspaceCreationFailedError("failed", {
        workspace: null,
        errorCode: "source_required",
      });
    };

    await expect(keys.run(fail)).rejects.toThrow("failed");
    await expect(keys.run(fail)).rejects.toThrow("failed");
    await expect(keys.run(fail)).rejects.toThrow("failed");

    expect(new Set(used).size).toBe(3);
  });

  it("preserves the key after a timeout, so a retry recovers the original creation", async () => {
    const keys = createWorkspaceCreationKey("draft-1");
    await expect(
      keys.run(async () => {
        throw new Error("DAEMON_REQUEST_TIMEOUT");
      }),
    ).rejects.toThrow("DAEMON_REQUEST_TIMEOUT");

    expect(await keys.run(async (key) => key)).toBe("draft-1");
  });

  it("preserves the key when the daemon cannot confirm whether a workspace was created", async () => {
    const keys = createWorkspaceCreationKey("draft-1");
    const error = new WorkspaceCreationFailedError("workspace_request_outcome_unknown", {
      workspace: null,
      errorCode: "directory_not_found",
      creation: {
        kind: "workspace",
        idempotencyKey: "draft-1",
        revision: 1,
        phase: "failed",
        workspaceId: "workspace-1",
        agentId: null,
        error: "workspace_request_outcome_unknown",
        failedStage: "workspace",
        outcomeUnknown: true,
      },
    });
    await expect(
      keys.run(async () => {
        throw error;
      }),
    ).rejects.toBe(error);

    expect(await keys.run(async (key) => key)).toBe("draft-1");
  });
});
