import { describe, expect, it } from "vitest";
import { resolveWorkspaceRenameOutcome } from "./workspace-inline-rename";

describe("resolveWorkspaceRenameOutcome", () => {
  it("does nothing when Enter is pressed on an untouched derived name", () => {
    expect(
      resolveWorkspaceRenameOutcome({ value: "New workspace", title: null, name: "New workspace" }),
    ).toEqual({ kind: "unchanged" });
  });

  it("does nothing when Enter is pressed on an untouched user title", () => {
    expect(resolveWorkspaceRenameOutcome({ value: "Spike", title: "Spike", name: "main" })).toEqual(
      {
        kind: "unchanged",
      },
    );
  });

  it("renames to what the user typed", () => {
    expect(
      resolveWorkspaceRenameOutcome({ value: "  Spike  ", title: null, name: "New workspace" }),
    ).toEqual({ kind: "rename", title: "Spike" });
  });

  // Clearing asks for the derived name back, which is "New workspace" for a
  // workspace holding no projects.
  it("resets to the derived name when the field is cleared", () => {
    expect(resolveWorkspaceRenameOutcome({ value: "   ", title: "Spike", name: "main" })).toEqual({
      kind: "reset",
    });
  });

  it("does not send a reset when the name is already derived", () => {
    expect(
      resolveWorkspaceRenameOutcome({ value: "", title: null, name: "New workspace" }),
    ).toEqual({ kind: "unchanged" });
  });
});
