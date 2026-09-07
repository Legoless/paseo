import { describe, expect, it } from "vitest";
import { resolveWorkspaceRowPressAction } from "./workspace-row-press";

describe("resolveWorkspaceRowPressAction", () => {
  it("navigates when the workspace is not open", () => {
    expect(resolveWorkspaceRowPressAction({ selected: false, hasCollapseToggle: true })).toBe(
      "navigate",
    );
  });

  it("navigates when the open row has no subtree to toggle", () => {
    expect(resolveWorkspaceRowPressAction({ selected: true, hasCollapseToggle: false })).toBe(
      "navigate",
    );
  });

  it("toggles the subtree when the open workspace is pressed again", () => {
    expect(resolveWorkspaceRowPressAction({ selected: true, hasCollapseToggle: true })).toBe(
      "toggle",
    );
  });
});
