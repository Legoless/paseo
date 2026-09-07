import { describe, expect, it } from "vitest";
import type { WorkspaceMemberDescriptor } from "@/stores/session-store";
import {
  buildWorkspaceProjectPickerOptions,
  orderWorkspaceProjectPickerOptions,
  toWorkspaceProjectComboboxOptions,
  type WorkspaceProjectPickerOption,
} from "./workspace-project-picker-order";

function option(cwd: string): WorkspaceProjectPickerOption {
  return { cwd, label: cwd, path: cwd };
}

function member(input: {
  projectId: string;
  projectDisplayName: string;
  projectCustomName?: string | null;
  workspaceDirectory: string;
}): WorkspaceMemberDescriptor {
  return {
    projectId: input.projectId,
    projectDisplayName: input.projectDisplayName,
    projectCustomName: input.projectCustomName ?? null,
    projectRootPath: input.workspaceDirectory,
    workspaceDirectory: input.workspaceDirectory,
    workspaceKind: "local_checkout",
    worktreeSlug: null,
    branch: null,
  };
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

describe("buildWorkspaceProjectPickerOptions", () => {
  it("drops members whose project has no registry record", () => {
    expect(
      buildWorkspaceProjectPickerOptions([
        member({
          projectId: "wks_orphan",
          projectDisplayName: "wks_orphan",
          workspaceDirectory: "/home/user",
        }),
        member({
          projectId: "project-a",
          projectDisplayName: "Project A",
          workspaceDirectory: "/repo/project-a",
        }),
      ]).map((entry) => entry.cwd),
    ).toEqual(["/repo/project-a"]);
  });

  it("keeps the custom project name on real members", () => {
    expect(
      buildWorkspaceProjectPickerOptions([
        member({
          projectId: "project-a",
          projectDisplayName: "acme/app",
          projectCustomName: "App",
          workspaceDirectory: "/repo/app",
        }),
      ]),
    ).toEqual([{ cwd: "/repo/app", label: "App", path: "/repo/app" }]);
  });
});
