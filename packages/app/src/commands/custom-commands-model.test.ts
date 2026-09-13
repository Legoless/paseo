import { describe, expect, it } from "vitest";
import type { CustomCommand } from "@getpaseo/protocol/custom-commands";
import { mergeCustomCommands } from "@/stores/custom-commands-store";
import { parseBindingChord, type ParsedShortcutBinding } from "@/keyboard/keyboard-shortcuts";
import {
  buildCommandBindings,
  findCommandComboConflicts,
  shortcutKeysForCommandBinding,
} from "./custom-commands-model";

function command(overrides: Partial<CustomCommand>): CustomCommand {
  return {
    id: "cmd",
    title: "Command",
    text: "echo hi",
    target: "agent",
    submit: true,
    ...overrides,
  };
}

function builtIn(
  id: string,
  combo: string,
  when?: ParsedShortcutBinding["when"],
): ParsedShortcutBinding {
  return {
    id,
    action: "theme.cycle",
    combo,
    parsedChord: parseBindingChord(combo),
    ...(when ? { when } : {}),
  };
}

describe("mergeCustomCommands", () => {
  it("puts project commands first and appends global ones", () => {
    const merged = mergeCustomCommands({
      project: [command({ id: "a" })],
      global: [command({ id: "b" }), command({ id: "c" })],
    });
    expect(merged.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("dedupes by id with the project command winning", () => {
    const merged = mergeCustomCommands({
      project: [command({ id: "shared", title: "Project version", text: "project" })],
      global: [command({ id: "shared", title: "Global version", text: "global" })],
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.text).toBe("project");
  });

  it("returns empty when both sources are empty", () => {
    expect(mergeCustomCommands({ project: [], global: [] })).toEqual([]);
  });
});

describe("buildCommandBindings", () => {
  it("synthesizes bindings with the user-command id prefix and payload", () => {
    const [binding] = buildCommandBindings([command({ id: "run-tests", shortcut: "Cmd+Shift+R" })]);
    expect(binding).toMatchObject({
      id: "user-command.run-tests",
      action: "userCommand.run",
      combo: "Cmd+Shift+R",
      payload: { type: "user-command", commandId: "run-tests" },
    });
    expect(binding?.parsedChord).toHaveLength(1);
  });

  it("produces an empty, never-matching combo when the command has no shortcut", () => {
    const [binding] = buildCommandBindings([command({ id: "no-keys" })]);
    expect(binding?.combo).toBe("");
    expect(binding?.parsedChord).toEqual([]);
  });

  it("degrades an unparseable file-authored combo to no shortcut", () => {
    const [binding] = buildCommandBindings([
      command({ id: "broken", shortcut: "Cmd+NotARealKey" }),
    ]);
    expect(binding?.combo).toBe("");
    expect(binding?.parsedChord).toEqual([]);
  });

  it("carries no help entry", () => {
    const [binding] = buildCommandBindings([command({ id: "x", shortcut: "Cmd+9" })]);
    expect(binding?.help).toBeUndefined();
  });
});

describe("findCommandComboConflicts", () => {
  const platform = { isMac: true, isDesktop: true };

  it("marks a command whose combo a built-in owns", () => {
    const commandBindings = buildCommandBindings([
      command({ id: "run-tests", shortcut: "Cmd+Shift+R" }),
    ]);
    const conflicts = findCommandComboConflicts({
      commandBindings,
      platform,
      defaults: [builtIn("built-in-reload", "Cmd+Shift+R")],
    });
    expect(conflicts.has("user-command.run-tests")).toBe(true);
  });

  it("ignores commands without a shortcut and unmatched combos", () => {
    const commandBindings = buildCommandBindings([
      command({ id: "no-keys" }),
      command({ id: "other", shortcut: "Cmd+Shift+T" }),
    ]);
    const conflicts = findCommandComboConflicts({
      commandBindings,
      platform,
      defaults: [builtIn("built-in-reload", "Cmd+Shift+R")],
    });
    expect(conflicts.size).toBe(0);
  });

  it("skips built-ins that do not apply to this platform", () => {
    const commandBindings = buildCommandBindings([
      command({ id: "run-tests", shortcut: "Cmd+Shift+R" }),
    ]);
    const conflicts = findCommandComboConflicts({
      commandBindings,
      platform,
      defaults: [builtIn("non-mac-only", "Cmd+Shift+R", { mac: false })],
    });
    expect(conflicts.size).toBe(0);
  });
});

describe("shortcutKeysForCommandBinding", () => {
  it("returns null when the binding has no keys", () => {
    const [binding] = buildCommandBindings([command({ id: "no-keys" })]);
    expect(binding && shortcutKeysForCommandBinding(binding)).toBeNull();
  });

  it("renders the effective combo", () => {
    const [binding] = buildCommandBindings([command({ id: "x", shortcut: "Cmd+Shift+R" })]);
    expect(binding && shortcutKeysForCommandBinding(binding)).toEqual([["mod", "shift", "R"]]);
  });
});
