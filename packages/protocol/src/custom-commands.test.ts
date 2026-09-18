import { describe, expect, it } from "vitest";
import {
  CustomCommandsFileSchema,
  CustomCommandWireSchema,
  parseCustomCommandsFile,
} from "./custom-commands.js";

describe("parseCustomCommandsFile", () => {
  it("applies defaults and derives ids from titles", () => {
    const result = parseCustomCommandsFile({
      commands: [
        { title: "Run tests", text: "npm test", target: "terminal", submit: false },
        {
          id: "review-pr",
          title: "Review PR",
          target: "agent",
          text: "Review the diff",
          submit: true,
          shortcut: "Cmd+Shift+R",
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`expected success, got: ${result.error}`);
    }
    expect(result.data.commands).toEqual([
      { id: "run-tests", title: "Run tests", text: "npm test", target: "terminal", submit: false },
      {
        id: "review-pr",
        title: "Review PR",
        target: "agent",
        text: "Review the diff",
        submit: true,
        shortcut: "Cmd+Shift+R",
      },
    ]);
  });

  it("defaults target to agent and submit to true", () => {
    const result = parseCustomCommandsFile({ commands: [{ title: "Lint", text: "npm run lint" }] });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`expected success, got: ${result.error}`);
    }
    expect(result.data.commands[0]).toEqual({
      id: "lint",
      title: "Lint",
      text: "npm run lint",
      target: "agent",
      submit: true,
    });
  });

  it("slugifies titles into stable ids", () => {
    const result = parseCustomCommandsFile({
      commands: [
        { title: "  Fix   the -- THING!! ", text: "go" },
        { title: "Déjà vu", text: "go" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`expected success, got: ${result.error}`);
    }
    expect(result.data.commands.map((command) => command.id)).toEqual(["fix-the-thing", "d-j-vu"]);
  });

  it("rejects a file that is not an object", () => {
    for (const value of [null, [], "commands", 42]) {
      const result = parseCustomCommandsFile(value);
      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("expected failure");
      }
      expect(result.error).toContain("root");
    }
  });

  it("rejects a command missing title or text", () => {
    const missingTitle = parseCustomCommandsFile({ commands: [{ text: "npm test" }] });
    expect(missingTitle.ok).toBe(false);
    if (missingTitle.ok) {
      throw new Error("expected failure");
    }
    expect(missingTitle.error).toContain("commands.0.title");

    const missingText = parseCustomCommandsFile({ commands: [{ title: "Run tests" }] });
    expect(missingText.ok).toBe(false);
    if (missingText.ok) {
      throw new Error("expected failure");
    }
    expect(missingText.error).toContain("commands.0.text");
  });

  it("rejects an unknown target", () => {
    const result = parseCustomCommandsFile({
      commands: [{ title: "Deploy", text: "ship", target: "browser" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }
    expect(result.error).toContain("commands.0.target");
  });

  it("rejects a title that derives an empty id", () => {
    const result = parseCustomCommandsFile({ commands: [{ title: "!!!", text: "go" }] });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }
    expect(result.error).toContain("commands.0");
  });

  it("round-trips the normalized output through the wire schema", () => {
    const result = parseCustomCommandsFile({
      commands: [{ title: "Run tests", text: "npm test" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`expected success, got: ${result.error}`);
    }
    for (const command of result.data.commands) {
      expect(CustomCommandWireSchema.safeParse(command).success).toBe(true);
    }
  });
});

describe("CustomCommandsFileSchema", () => {
  it("accepts an empty command list", () => {
    const parsed = CustomCommandsFileSchema.safeParse({ commands: [] });
    expect(parsed.success).toBe(true);
  });
});
