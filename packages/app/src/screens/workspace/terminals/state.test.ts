import { describe, expect, it } from "vitest";
import {
  buildTerminalCwdById,
  buildTerminalsQueryKey,
  resolveTerminalListRoot,
  canCreateWorkspaceTerminal,
  collectKnownTerminalIds,
  collectScriptTerminalIds,
  collectStandaloneTerminalIds,
  reconcilePendingScriptTerminals,
  removeTerminalFromPayload,
  upsertCreatedTerminalPayload,
  tryInstallTerminalReplacement,
  completeTerminalReplacement,
  type ListTerminalsPayload,
  type TerminalReplacementLayoutPort,
} from "@/screens/workspace/terminals/state";
import type { CreateTerminalResponse } from "@getpaseo/protocol/messages";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

function listedTerminal(id: string): ListTerminalsPayload["terminals"][number] {
  return { id, name: id, title: id };
}

function createdTerminal(id: string): NonNullable<CreateTerminalResponse["payload"]["terminal"]> {
  return { id, name: id, cwd: "/repo", title: id };
}

describe("workspace terminal state", () => {
  it("keeps an identified workspace's terminal listing stable when its project memberships change", () => {
    expect(buildTerminalsQueryKey("host", "/project-a", "workspace")).toEqual([
      "terminals",
      "host",
      null,
      "workspace",
    ]);
    expect(buildTerminalsQueryKey("host", "/project-b", "workspace")).toEqual([
      "terminals",
      "host",
      null,
      "workspace",
    ]);
    expect(buildTerminalsQueryKey("host", null, "workspace")).toEqual([
      "terminals",
      "host",
      null,
      "workspace",
    ]);
    expect(resolveTerminalListRoot("/project-a", "workspace")).toBeNull();
    expect(buildTerminalsQueryKey("host", "/project-a")).toEqual([
      "terminals",
      "host",
      "/project-a",
      null,
    ]);
    expect(resolveTerminalListRoot("/project-a")).toBe("/project-a");
  });
  it("creates a terminal whenever a launch cwd resolves, workspace directory or not", () => {
    const connected = { isRouteFocused: true, client: {}, isConnected: true };

    // A projectless workspace launches into the daemon home instead of a directory of its own.
    expect(canCreateWorkspaceTerminal({ ...connected, workspaceDirectory: "/Users/me" })).toBe(
      true,
    );
    expect(canCreateWorkspaceTerminal({ ...connected, workspaceDirectory: null })).toBe(false);
  });

  it("keeps pending script terminals until they appear or a fresher list arrives", () => {
    const pending = new Map([
      ["older-than-list", 10],
      ["now-live", 20],
      ["still-pending", 30],
    ]);

    const reconciled = reconcilePendingScriptTerminals(["now-live"], 20)(pending);

    expect(reconciled).toEqual(new Map([["still-pending", 30]]));
  });

  it("returns the same pending map when reconciliation changes nothing", () => {
    const pending = new Map([["still-pending", 30]]);

    const reconciled = reconcilePendingScriptTerminals([], 20)(pending);

    expect(reconciled).toBe(pending);
  });

  it("combines live and pending terminal ids without duplicating script terminals", () => {
    const pendingScriptTerminalIds = new Map([
      ["script-pending", 10],
      ["terminal-1", 10],
    ]);

    expect(
      collectKnownTerminalIds({
        liveTerminalIds: ["terminal-1", "terminal-2"],
        pendingScriptTerminalIds,
      }),
    ).toEqual(["terminal-1", "terminal-2", "script-pending"]);
    expect(
      collectScriptTerminalIds({
        pendingScriptTerminalIds,
        scripts: [{ terminalId: "script-live" }, { terminalId: null }],
      }),
    ).toEqual(new Set(["script-pending", "terminal-1", "script-live"]));
    expect(
      collectStandaloneTerminalIds({
        terminals: [
          listedTerminal("terminal-1"),
          listedTerminal("terminal-2"),
          listedTerminal("script-live"),
        ],
        scriptTerminalIds: new Set(["terminal-1", "script-live"]),
      }),
    ).toEqual(["terminal-2"]);
  });

  it("updates terminal cache entries for created and closed terminals", () => {
    const current: ListTerminalsPayload = {
      cwd: "/repo",
      requestId: "existing",
      terminals: [listedTerminal("terminal-1")],
    };

    expect(
      upsertCreatedTerminalPayload({
        current,
        terminal: createdTerminal("terminal-2"),
        workspaceDirectory: "/repo",
      }),
    ).toEqual({
      cwd: "/repo",
      requestId: "existing",
      terminals: [
        listedTerminal("terminal-1"),
        { id: "terminal-2", name: "terminal-2", cwd: "/repo", title: "terminal-2" },
      ],
    });
    expect(removeTerminalFromPayload("terminal-1")(current)).toEqual({
      cwd: "/repo",
      requestId: "existing",
      terminals: [],
    });
  });
});

describe("terminal project directories", () => {
  it("keeps the project tray attached after a directory-scoped terminal refresh", () => {
    expect(
      buildTerminalCwdById({
        cwd: "/repo",
        terminals: [listedTerminal("terminal")],
        requestId: "refresh",
      }),
    ).toEqual(new Map([["terminal", "/repo"]]));
  });

  it("uses each terminal directory for workspace-wide responses", () => {
    expect(
      buildTerminalCwdById({
        terminals: [
          { ...listedTerminal("first"), cwd: "/first" },
          { ...listedTerminal("second"), cwd: "/second" },
        ],
        requestId: "refresh",
      }),
    ).toEqual(
      new Map([
        ["first", "/first"],
        ["second", "/second"],
      ]),
    );
  });
});

class TerminalReplacementLayout implements TerminalReplacementLayoutPort {
  targets = new Map<string, WorkspaceTabTarget>();
  replacements: string[] = [];
  refuseReplacement = false;

  getTabTarget(workspaceKey: string, tabId: string): WorkspaceTabTarget | null {
    return this.targets.get(`${workspaceKey}:${tabId}`) ?? null;
  }

  replaceTab(workspaceKey: string, tabId: string, target: WorkspaceTabTarget): string | null {
    const key = `${workspaceKey}:${tabId}`;
    if (this.refuseReplacement || !this.targets.has(key)) return null;
    this.replacements.push(key);
    this.targets.set(key, target);
    return tabId;
  }
}

const replacement = {
  workspaceKey: "host:source",
  tabId: "tab",
  expectedTerminalId: "original",
  createdTerminalId: "replacement",
};

describe("terminal replacement during a pending creation", () => {
  it("stops the original shell after the new shell is installed in its tab", async () => {
    const layout = new TerminalReplacementLayout();
    layout.targets.set("host:source:tab", { kind: "terminal", terminalId: "original" });
    const stopped: string[] = [];

    expect(tryInstallTerminalReplacement(layout, replacement)).toBe(true);
    expect(
      await completeTerminalReplacement(layout, replacement, async (id) => {
        stopped.push(id);
      }),
    ).toBe(true);
    expect(layout.getTabTarget("host:source", "tab")).toEqual({
      kind: "terminal",
      terminalId: "replacement",
    });
    expect(stopped).toEqual(["original"]);
  });

  it.each([
    {
      name: "moved to another workspace",
      remaining: new Map<string, WorkspaceTabTarget>([
        ["host:destination:tab", { kind: "terminal", terminalId: "original" }],
      ]),
    },
    { name: "closed", remaining: new Map<string, WorkspaceTabTarget>() },
    {
      name: "retargeted",
      remaining: new Map<string, WorkspaceTabTarget>([
        ["host:source:tab", { kind: "terminal", terminalId: "another-shell" }],
      ]),
    },
  ])("cleans the new shell when the source tab was $name", async ({ remaining }) => {
    const layout = new TerminalReplacementLayout();
    layout.targets = new Map(remaining);
    const stopped: string[] = [];

    expect(tryInstallTerminalReplacement(layout, replacement)).toBe(false);
    expect(
      await completeTerminalReplacement(layout, replacement, async (id) => {
        stopped.push(id);
      }),
    ).toBe(false);
    expect(layout.targets).toEqual(remaining);
    expect(layout.replacements).toEqual([]);
    expect(stopped).toEqual(["replacement"]);
  });

  it("preserves the original shell when installation returns no tab", async () => {
    const layout = new TerminalReplacementLayout();
    layout.targets.set("host:source:tab", { kind: "terminal", terminalId: "original" });
    layout.refuseReplacement = true;
    const stopped: string[] = [];

    expect(tryInstallTerminalReplacement(layout, replacement)).toBe(false);
    expect(
      await completeTerminalReplacement(layout, replacement, async (id) => {
        stopped.push(id);
      }),
    ).toBe(false);
    expect(layout.getTabTarget("host:source", "tab")).toEqual({
      kind: "terminal",
      terminalId: "original",
    });
    expect(stopped).toEqual(["replacement"]);
  });

  it("checks the installed target again before stopping the original shell", async () => {
    const layout = new TerminalReplacementLayout();
    layout.targets.set("host:source:tab", { kind: "terminal", terminalId: "original" });
    expect(tryInstallTerminalReplacement(layout, replacement)).toBe(true);
    layout.targets.set("host:source:tab", { kind: "terminal", terminalId: "another-shell" });
    const stopped: string[] = [];

    expect(
      await completeTerminalReplacement(layout, replacement, async (id) => {
        stopped.push(id);
      }),
    ).toBe(false);
    expect(layout.getTabTarget("host:source", "tab")).toEqual({
      kind: "terminal",
      terminalId: "another-shell",
    });
    expect(stopped).toEqual(["replacement"]);
  });
});
