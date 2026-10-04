import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import { getAutocompleteFallbackIndex } from "@/components/ui/autocomplete-utils";
import { buildCommandAutocompleteOptions } from "./use-agent-autocomplete";

const t = ((key: string) => key) as unknown as TFunction;

function commandOptions(input: {
  showClientCommands: boolean;
  clientCommandTarget?: "agent" | "draft";
}) {
  return buildCommandAutocompleteOptions({
    isVisible: true,
    mode: "command",
    commands: [{ name: "review", description: "Review changes", argumentHint: "" }],
    pluginCommands: [],
    showClientCommands: input.showClientCommands,
    clientCommandTarget: input.clientCommandTarget,
    commandFilterQuery: "",
    activeSlashCommand: { start: 0, end: 1, query: "", position: "start" },
    activeFileMention: null,
    fileSuggestions: [],
    t,
  });
}

function commandLabels(showClientCommands: boolean): string[] {
  return commandOptions({ showClientCommands }).map((option) => option.label);
}

function clientCommandDescriptions(clientCommandTarget?: "agent" | "draft") {
  return Object.fromEntries(
    commandOptions({ showClientCommands: true, clientCommandTarget }).flatMap((option) =>
      option.type === "client_command" ? [[option.label, option.description]] : [],
    ),
  );
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

  it.each(["clear", "Clear"])(
    "selects exact /%s ahead of a subsequence provider match above the input",
    (query) => {
      const options = buildCommandAutocompleteOptions({
        isVisible: true,
        mode: "command",
        commands: [
          { name: "template-creator", description: "Create a template", argumentHint: "" },
          { name: "clone-template-creator", description: "Clone a template", argumentHint: "" },
        ],
        pluginCommands: [],
        showClientCommands: true,
        commandFilterQuery: query,
        activeSlashCommand: { start: 0, end: query.length + 1, query, position: "start" },
        activeFileMention: null,
        fileSuggestions: [],
        t,
      });

      expect(options.map((option) => option.label)).toEqual(["/clone-template-creator", "/clear"]);
      expect(options[getAutocompleteFallbackIndex(options.length)]).toMatchObject({
        label: "/clear",
        type: "client_command",
      });
    },
  );

  it("describes /clear and /exit as agent actions by default", () => {
    expect(clientCommandDescriptions()).toEqual({
      "/clear": "composer.clientCommands.freshDraft",
      "/exit": "composer.clientCommands.archiveAgent",
    });
  });

  it("describes /clear and /exit as draft actions in a draft, which has no agent to close", () => {
    expect(clientCommandDescriptions("draft")).toEqual({
      "/clear": "composer.clientCommands.clearDraft",
      "/exit": "composer.clientCommands.closeDraft",
    });
  });
});
