import { describe, expect, it } from "vitest";
import { resolveCommandPaneTarget } from "./run-custom-command";

describe("resolveCommandPaneTarget", () => {
  it("sends an agent command to the pane's agent, the way a git action uses that pane", () => {
    expect(
      resolveCommandPaneTarget({
        serverId: "server-1",
        commandTarget: "agent",
        paneTab: { tabId: "tab-1", target: { kind: "agent", agentId: "agent-1" } },
      }),
    ).toEqual({
      kind: "chat",
      tabId: "tab-1",
      draftKey: "agent:server-1:agent-1",
      agentId: "agent-1",
    });
  });

  it("types a terminal command into the pane's terminal", () => {
    expect(
      resolveCommandPaneTarget({
        serverId: "server-1",
        commandTarget: "terminal",
        paneTab: { tabId: "tab-1", target: { kind: "terminal", terminalId: "term-1" } },
      }),
    ).toEqual({ kind: "terminal", tabId: "tab-1", terminalId: "term-1" });
  });

  it("does not use a terminal pane for an agent command", () => {
    expect(
      resolveCommandPaneTarget({
        serverId: "server-1",
        commandTarget: "agent",
        paneTab: { tabId: "tab-1", target: { kind: "terminal", terminalId: "term-1" } },
      }),
    ).toBeNull();
  });
});
