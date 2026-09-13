import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadCustomCommands, readCustomCommandsFile } from "./custom-commands.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "custom-commands-test-"));
  tempDirs.push(home);
  return home;
}

describe("loadCustomCommands", () => {
  test("returns empty when commands.json does not exist", () => {
    expect(loadCustomCommands(makeHome())).toEqual({ commands: [], errors: [] });
  });

  test("reports invalid JSON as one formatted error line", () => {
    const home = makeHome();
    writeFileSync(join(home, "commands.json"), "{ not json");
    expect(loadCustomCommands(home).commands).toEqual([]);
    const [error] = loadCustomCommands(home).errors;
    expect(error).toMatch(/^commands\.json: /);
  });

  test("reports a schema violation with the offending command path", () => {
    const home = makeHome();
    writeFileSync(
      join(home, "commands.json"),
      JSON.stringify({ commands: [{ text: "npm test" }] }),
    );
    const result = loadCustomCommands(home);
    expect(result.commands).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("commands.0.title");
  });

  test("loads a valid file with defaults applied and ids derived", () => {
    const home = makeHome();
    writeFileSync(
      join(home, "commands.json"),
      JSON.stringify({
        commands: [
          { title: "Review PR", text: "Review the diff", shortcut: "Cmd+Shift+R" },
          { id: "tests", title: "Run tests", text: "npm test", target: "terminal", submit: false },
        ],
      }),
    );
    expect(loadCustomCommands(home)).toEqual({
      commands: [
        {
          id: "review-pr",
          title: "Review PR",
          text: "Review the diff",
          target: "agent",
          submit: true,
          shortcut: "Cmd+Shift+R",
        },
        {
          id: "tests",
          title: "Run tests",
          text: "npm test",
          target: "terminal",
          submit: false,
        },
      ],
      errors: [],
    });
  });
});

describe("readCustomCommandsFile", () => {
  test("treats a missing parent directory as missing", () => {
    const filePath = join(makeHome(), ".paseo-neo", "commands.json");
    expect(readCustomCommandsFile(filePath)).toEqual({ status: "missing" });
  });

  test("returns the formatted error for an invalid file", () => {
    const dir = join(makeHome(), ".paseo-neo");
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, "commands.json");
    writeFileSync(filePath, JSON.stringify({ commands: [{ title: "X", target: "browser" }] }));
    const result = readCustomCommandsFile(filePath);
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") {
      throw new Error("expected invalid");
    }
    expect(result.error).toContain("commands.json:");
    expect(result.error).toContain("commands.0");
  });
});
