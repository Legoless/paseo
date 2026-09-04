import { describe, expect, it } from "vitest";
import { resolveProjectlessWorkspaceHost } from "./use-create-projectless-workspace";

describe("resolveProjectlessWorkspaceHost", () => {
  it("uses the active workspace's host, even when several are configured", () => {
    expect(
      resolveProjectlessWorkspaceHost({
        activeServerId: "host-b",
        serverIds: ["host-a", "host-b"],
      }),
    ).toBe("host-b");
  });

  it("uses the only configured host when nothing is active", () => {
    expect(resolveProjectlessWorkspaceHost({ activeServerId: null, serverIds: ["host-a"] })).toBe(
      "host-a",
    );
  });

  it("refuses to guess between hosts when nothing is active", () => {
    expect(
      resolveProjectlessWorkspaceHost({ activeServerId: null, serverIds: ["host-a", "host-b"] }),
    ).toBeNull();
  });

  it("answers null when there is no host at all", () => {
    expect(resolveProjectlessWorkspaceHost({ activeServerId: null, serverIds: [] })).toBeNull();
  });
});
