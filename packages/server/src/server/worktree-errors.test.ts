import { describe, expect, test } from "vitest";

import { toWorktreeWireError } from "./worktree-errors.js";

describe("toWorktreeWireError", () => {
  test("keeps a plain object's message instead of [object Object]", () => {
    expect(toWorktreeWireError({ code: -32603, message: "ACP session/new failed" })).toEqual({
      code: "unknown",
      message: "ACP session/new failed",
    });
  });

  test("keeps Error messages", () => {
    expect(toWorktreeWireError(new Error("directory not found"))).toEqual({
      code: "unknown",
      message: "directory not found",
    });
  });
});
