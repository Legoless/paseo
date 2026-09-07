import { describe, expect, it } from "vitest";
import {
  orderWorkspaceProjectPickerOptions,
  toWorkspaceProjectComboboxOptions,
  type WorkspaceProjectPickerOption,
} from "./workspace-project-picker-order";

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

describe("toWorkspaceProjectComboboxOptions", () => {
  it("maps picker options to searchable combobox options", () => {
    expect(
      toWorkspaceProjectComboboxOptions([
        { cwd: "/repo/a", label: "A", path: "~/repo/a" },
        { cwd: "/repo/b", label: "B", path: "~/repo/b" },
      ]),
    ).toEqual([
      { id: "/repo/a", label: "A", description: "~/repo/a", kind: "directory" },
      { id: "/repo/b", label: "B", description: "~/repo/b", kind: "directory" },
    ]);
  });
});
