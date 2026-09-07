import { describe, expect, it } from "vitest";
import {
  orderWorkspaceProjectPickerOptions,
  type WorkspaceProjectPickerOption,
} from "./workspace-project-picker";

function option(cwd: string): WorkspaceProjectPickerOption {
  return { cwd, label: cwd, path: cwd };
}

describe("orderWorkspaceProjectPickerOptions", () => {
  it("follows the stored member order", () => {
    const options = [option("/a"), option("/b"), option("/c")];
    expect(
      orderWorkspaceProjectPickerOptions(options, ["ws#/c", "ws#/a", "ws#/b"]).map(
        (entry) => entry.cwd,
      ),
    ).toEqual(["/c", "/a", "/b"]);
  });

  it("keeps unstored members in baseline order ahead of the stored ones", () => {
    const options = [option("/a"), option("/b"), option("/c")];
    expect(
      orderWorkspaceProjectPickerOptions(options, ["ws#/c"]).map((entry) => entry.cwd),
    ).toEqual(["/a", "/b", "/c"]);
  });

  it("returns the baseline when the stored order matches nothing", () => {
    const options = [option("/a"), option("/b")];
    expect(orderWorkspaceProjectPickerOptions(options, ["ws#/z"])).toBe(options);
  });
});
