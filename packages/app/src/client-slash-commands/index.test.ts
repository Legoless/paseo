import { describe, expect, it, vi } from "vitest";
import {
  CLIENT_SLASH_COMMANDS,
  buildDraftAgentSetup,
  buildProviderSwitchDraftSetup,
  replaceOpenAgentWithDraft,
  resolveClientSlashCommand,
} from "@/client-slash-commands";
import type { Agent } from "@/stores/session-store";

function createAgent(overrides: Partial<Agent> = {}): Agent {
  const now = new Date("2026-05-15T00:00:00.000Z");
  return {
    serverId: "server-1",
    id: "agent-1",
    provider: "codex",
    status: "idle",
    createdAt: now,
    updatedAt: now,
    lastUserMessageAt: now,
    lastActivityAt: now,
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: false,
      supportsReasoningStream: false,
      supportsToolInvocations: true,
    },
    currentModeId: "mode-current",
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    runtimeInfo: {
      provider: "codex",
      sessionId: "session-1",
      model: "runtime-model",
      modeId: "runtime-mode",
      thinkingOptionId: "runtime-thinking",
    },
    title: "Agent",
    cwd: "/repo",
    model: "agent-model",
    thinkingOptionId: "think-hard",
    features: [
      { type: "toggle", id: "web-search", label: "Web search", value: true },
      {
        type: "select",
        id: "effort",
        label: "Effort",
        value: "high",
        options: [{ id: "high", label: "High" }],
      },
    ],
    parentAgentId: null,
    labels: {},
    ...overrides,
    activeTurn: overrides.activeTurn ?? null,
  };
}

describe("resolveClientSlashCommand", () => {
  it("declares the exact canonical client commands with their aliases", () => {
    expect(
      CLIENT_SLASH_COMMANDS.map((command) => [
        command.name,
        [...command.aliases],
        command.execution,
      ]),
    ).toEqual([
      ["exit", ["quit", "q"], "immediate"],
      ["clear", ["new"], "immediate"],
    ]);
  });

  it("resolves canonical names and aliases after trimming", () => {
    expect(resolveClientSlashCommand({ text: " /quit ", hasAttachments: false })).toMatchObject({
      name: "exit",
      kind: "archive-agent",
      execution: "immediate",
    });
    expect(resolveClientSlashCommand({ text: "/exit", hasAttachments: false })).toMatchObject({
      name: "exit",
      kind: "archive-agent",
    });
    expect(resolveClientSlashCommand({ text: "/q", hasAttachments: false })).toMatchObject({
      name: "exit",
      kind: "archive-agent",
    });
    expect(resolveClientSlashCommand({ text: "/clear", hasAttachments: false })).toMatchObject({
      name: "clear",
      kind: "replace-agent-with-draft",
    });
    expect(resolveClientSlashCommand({ text: "/new", hasAttachments: false })).toMatchObject({
      name: "clear",
      kind: "replace-agent-with-draft",
    });
  });

  it("leaves provider commands, arguments, ordinary messages, and attachment submits alone", () => {
    expect(resolveClientSlashCommand({ text: "/clear now", hasAttachments: false })).toBeNull();
    expect(resolveClientSlashCommand({ text: "/quit now", hasAttachments: false })).toBeNull();
    expect(
      resolveClientSlashCommand({ text: "/provider-command", hasAttachments: false }),
    ).toBeNull();
    expect(resolveClientSlashCommand({ text: "hello /quit", hasAttachments: false })).toBeNull();
    expect(resolveClientSlashCommand({ text: "/quit", hasAttachments: true })).toBeNull();
  });
});

describe("buildDraftAgentSetup", () => {
  it("builds draft setup from the active agent snapshot", () => {
    expect(buildDraftAgentSetup(createAgent())).toEqual({
      provider: "codex",
      cwd: "/repo",
      modeId: "mode-current",
      model: "agent-model",
      thinkingOptionId: "think-hard",
      featureValues: {
        "web-search": true,
        effort: "high",
      },
    });
  });

  it("falls back to runtime model setup when top-level fields are absent", () => {
    expect(
      buildDraftAgentSetup(
        createAgent({
          currentModeId: null,
          model: null,
          thinkingOptionId: null,
        }),
      ),
    ).toMatchObject({
      modeId: "runtime-mode",
      model: "runtime-model",
      thinkingOptionId: "runtime-thinking",
    });
  });
});

describe("buildProviderSwitchDraftSetup", () => {
  it("seeds a fresh draft with the new provider and model only", () => {
    expect(
      buildProviderSwitchDraftSetup({
        cwd: "/repo",
        provider: "grok",
        model: "grok-4",
      }),
    ).toEqual({
      provider: "grok",
      cwd: "/repo",
      modeId: null,
      model: "grok-4",
      thinkingOptionId: null,
      featureValues: {},
    });
  });
});

describe("replaceOpenAgentWithDraft", () => {
  it("retargets the tab then archives the previous agent", async () => {
    const order: string[] = [];
    const retargetCurrentTab = vi.fn((target) => {
      order.push("retarget");
      expect(target).toEqual({
        kind: "draft",
        draftId: "draft-1",
        setup: buildProviderSwitchDraftSetup({
          cwd: "/repo",
          provider: "grok",
          model: "grok-4",
        }),
      });
    });
    const unpinWorkspaceAgent = vi.fn(() => {
      order.push("unpin");
    });
    const hideWorkspaceAgent = vi.fn(() => {
      order.push("hide");
    });
    const archiveAgent = vi.fn(async () => {
      order.push("archive");
    });

    await replaceOpenAgentWithDraft({
      serverId: "server-1",
      agentId: "agent-1",
      workspaceId: "workspace-1",
      setup: buildProviderSwitchDraftSetup({
        cwd: "/repo",
        provider: "grok",
        model: "grok-4",
      }),
      draftId: "draft-1",
      retargetCurrentTab,
      unpinWorkspaceAgent,
      hideWorkspaceAgent,
      archiveAgent,
    });

    expect(unpinWorkspaceAgent).toHaveBeenCalledWith("server-1:workspace-1", "agent-1");
    expect(hideWorkspaceAgent).toHaveBeenCalledWith("server-1:workspace-1", "agent-1");
    expect(order).toEqual(["unpin", "hide", "retarget", "archive"]);
  });
});
