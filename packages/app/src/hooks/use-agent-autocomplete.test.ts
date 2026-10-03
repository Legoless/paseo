import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import { buildCommandAutocompleteOptions } from "./use-agent-autocomplete";

const t = ((key: string) => key) as unknown as TFunction;

function commandLabels(showClientCommands: boolean): string[] {
  return buildCommandAutocompleteOptions({
    isVisible: true,
    mode: "command",
    commands: [{ name: "review", description: "Review changes", argumentHint: "" }],
    pluginCommands: [],
    showClientCommands,
    commandFilterQuery: "",
    activeSlashCommand: { start: 0, end: 1, query: "", position: "start" },
    activeFileMention: null,
    fileSuggestions: [],
    t,
  }).map((option) => option.label);
}

describe("buildCommandAutocompleteOptions", () => {
  it("lists /clear and /exit beside provider commands where the composer can run them", () => {
    expect(commandLabels(true)).toEqual(expect.arrayContaining(["/clear", "/exit", "/review"]));
  });

  it("hides built-in commands from a composer that cannot run them", () => {
    const labels = commandLabels(false);
    expect(labels).toContain("/review");
    expect(labels).not.toContain("/clear");
    expect(labels).not.toContain("/exit");
  });
});
