import { describe, expect, it } from "vitest";
import type { ProviderSubagentDescriptorPayload } from "@getpaseo/protocol/messages";
import type { Agent } from "@/stores/session-store";
import {
  collectRunningPaseoChildParentIds,
  collectRunningProviderChildParentIds,
} from "./use-running-child-agent-ids";

function child(input: {
  id: string;
  parentAgentId: string;
  turnPhase: "open" | "idle";
  archivedAt?: Date | null;
}): Agent {
  return {
    id: input.id,
    parentAgentId: input.parentAgentId,
    archivedAt: input.archivedAt ?? null,
    turn: { phase: input.turnPhase },
  } as unknown as Agent;
}

function providerSubagent(input: {
  parentAgentId: string;
  status: ProviderSubagentDescriptorPayload["status"];
}): ProviderSubagentDescriptorPayload {
  return {
    id: `sub-${input.parentAgentId}`,
    parentAgentId: input.parentAgentId,
    provider: "claude",
    title: null,
    description: null,
    status: input.status,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    toolCallId: null,
  };
}

function sessionWith(agents: Agent[]) {
  return {
    agents: new Map(agents.map((agent) => [(agent as unknown as { id: string }).id, agent])),
  };
}

describe("collectRunningPaseoChildParentIds", () => {
  it("marks the parent of a child with an open turn", () => {
    const parents = collectRunningPaseoChildParentIds({
      srv: sessionWith([
        child({ id: "child-a", parentAgentId: "parent-a", turnPhase: "open" }),
        child({ id: "child-b", parentAgentId: "parent-b", turnPhase: "idle" }),
      ]),
    });
    expect([...parents]).toEqual(["parent-a"]);
  });

  it("ignores archived children and servers outside the filter", () => {
    const parents = collectRunningPaseoChildParentIds(
      {
        srv: sessionWith([
          child({
            id: "archived-child",
            parentAgentId: "archived-parent",
            turnPhase: "open",
            archivedAt: new Date(),
          }),
          child({ id: "live-child", parentAgentId: "live-parent", turnPhase: "open" }),
        ]),
        other: sessionWith([
          child({ id: "other-child", parentAgentId: "other-parent", turnPhase: "open" }),
        ]),
      },
      ["srv"],
    );
    expect([...parents]).toEqual(["live-parent"]);
  });
});

describe("collectRunningProviderChildParentIds", () => {
  it("marks the parent of a running provider subagent", () => {
    const parents = collectRunningProviderChildParentIds(
      new Map([
        [
          "srv\0parent-a\0sub-1",
          providerSubagent({ parentAgentId: "parent-a", status: "running" }),
        ],
        [
          "srv\0parent-b\0sub-2",
          providerSubagent({ parentAgentId: "parent-b", status: "completed" }),
        ],
      ]),
      new Set(),
    );
    expect([...parents]).toEqual(["parent-a"]);
  });

  it("ignores hidden subagents and servers outside the filter", () => {
    const parents = collectRunningProviderChildParentIds(
      new Map([
        [
          "srv\0hidden-parent\0sub-1",
          providerSubagent({ parentAgentId: "hidden-parent", status: "running" }),
        ],
        [
          "srv\0live-parent\0sub-2",
          providerSubagent({ parentAgentId: "live-parent", status: "running" }),
        ],
        [
          "other\0other-parent\0sub-3",
          providerSubagent({ parentAgentId: "other-parent", status: "running" }),
        ],
      ]),
      new Set(["srv\0hidden-parent\0sub-1"]),
      ["srv"],
    );
    expect([...parents]).toEqual(["live-parent"]);
  });
});
