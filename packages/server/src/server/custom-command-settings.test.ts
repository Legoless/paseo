import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CustomCommand } from "@getpaseo/protocol/custom-commands";
import { DaemonConfigStore } from "./daemon-config-store.js";
import { loadCustomCommands } from "./custom-commands.js";

const command: CustomCommand = {
  id: "test",
  title: "Run tests",
  text: "npm test",
  target: "terminal",
  submit: false,
};
const homes: string[] = [];
function setup() {
  const home = mkdtempSync(path.join(tmpdir(), "paseo-command-settings-"));
  homes.push(home);
  const store = new DaemonConfigStore(home, {
    relay: { enabled: false },
    mcp: { injectIntoAgents: false },
    browserTools: { enabled: false },
    providers: {},
    metadataGeneration: { providers: [] },
    autoArchiveAfterMerge: false,
    enableTerminalAgentHooks: false,
    appendSystemPrompt: "",
  });
  return { home, store, file: path.join(home, "commands.json") };
}
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("custom command settings", () => {
  it("persists additions, edits and deleting the last command, notifying live consumers", () => {
    const { home, store } = setup();
    const configBefore = readFileSync(path.join(home, "config.json"), "utf8");
    const changes: unknown[] = [];
    store.onChange((config) => changes.push(config.customCommands));
    expect(store.setCustomCommands([command], []).customCommands).toEqual([command]);
    const renamed = {
      ...command,
      title: "Renamed",
      text: "npm run check",
      shortcut: "Cmd+Shift+R",
    };
    store.setCustomCommands([renamed], [command]);
    expect(loadCustomCommands(home)).toEqual({ commands: [renamed], errors: [] });
    store.setCustomCommands([], [renamed]);
    expect(loadCustomCommands(home)).toEqual({ commands: [], errors: [] });
    expect(changes).toEqual([[command], [renamed], []]);
    expect(readFileSync(path.join(home, "config.json"), "utf8")).toBe(configBefore);
  });

  it("rejects stale edits and refreshes consumers with the current file", () => {
    const { home, store, file } = setup();
    writeFileSync(file, JSON.stringify({ commands: [command] }));
    expect(() => store.setCustomCommands([], [])).toThrow("Commands changed");
    expect(loadCustomCommands(home).commands).toEqual([command]);
    expect(store.get().customCommands).toEqual([command]);
  });

  it("preserves malformed files and rejects duplicate ids and blank text", () => {
    const { store, file } = setup();
    expect(() => store.setCustomCommands([command, command], [])).toThrow("unique id");
    expect(() => store.setCustomCommands([{ ...command, text: "  " }], [])).toThrow("name, text");
    expect(existsSync(file)).toBe(false);
    writeFileSync(file, "{broken");
    expect(() => store.setCustomCommands([command], [])).toThrow("commands.json");
    expect(readFileSync(file, "utf8")).toBe("{broken");
  });

  it("restores exact file contents and live state when applying fails", () => {
    const { store, file } = setup();
    store.setCustomCommands([command], []);
    const raw = '{ "commands": ' + JSON.stringify([command]) + " }\n";
    writeFileSync(file, raw);
    store.onApply(() => {
      throw new Error("apply failed");
    });
    expect(() => store.setCustomCommands([], [command])).toThrow("apply failed");
    expect(readFileSync(file, "utf8")).toBe(raw);
    expect(store.get().customCommands).toEqual([command]);
  });

  it("removes a newly created file when applying fails", () => {
    const { store, file } = setup();
    store.onApply(() => {
      throw new Error("apply failed");
    });
    expect(() => store.setCustomCommands([command], [])).toThrow("apply failed");
    expect(existsSync(file)).toBe(false);
    expect(store.get().customCommands).toBeUndefined();
  });
});
