import { describe, expect, it } from "vitest";
import { buildWorkspaceExplorerStateKey } from "./use-file-explorer-actions";

describe("buildWorkspaceExplorerStateKey", () => {
  it("keys workspace state by workspace id and root so project members stay separate", () => {
    expect(
      buildWorkspaceExplorerStateKey({ workspaceId: "ws-1", workspaceRoot: "/repo-one" }),
    ).toBe("workspace:ws-1:/repo-one");
    expect(
      buildWorkspaceExplorerStateKey({ workspaceId: "ws-1", workspaceRoot: "/repo-two" }),
    ).toBe("workspace:ws-1:/repo-two");
  });

  it("keeps the bare workspace key when the root is unknown", () => {
    expect(buildWorkspaceExplorerStateKey({ workspaceId: "ws-1", workspaceRoot: null })).toBe(
      "workspace:ws-1",
    );
    expect(buildWorkspaceExplorerStateKey({ workspaceId: "ws-1", workspaceRoot: "  " })).toBe(
      "workspace:ws-1",
    );
  });

  it("falls back to the root key without a workspace id", () => {
    expect(buildWorkspaceExplorerStateKey({ workspaceRoot: "/repo" })).toBe("root:/repo");
    expect(buildWorkspaceExplorerStateKey({})).toBeNull();
  });
});
