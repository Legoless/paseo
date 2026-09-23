import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import {
  CLIENT_SLASH_COMMANDS,
  buildDraftAgentSetup,
  buildProviderSwitchDraftSetup,
  replaceOpenAgentWithDraft,
  resolveClientSlashCommand,
  switchAgentProviderToDraft,
} from "@/client-slash-commands";
import {
  buildDraftWorkspaceAttachmentScopeKey,
  resetWorkspaceAttachmentsStore,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import type { Agent } from "@/stores/session-store";

type ChatHistoryAttachment = Extract<AgentAttachment, { type: "text" }>;

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
    turn: overrides.turn ?? { phase: "idle", cancellationRequestId: null },
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

  it("carries an agent profile's mode, thinking option and features", () => {
    expect(
      buildProviderSwitchDraftSetup({
        cwd: "/repo",
        provider: "codex",
        model: "gpt-6-astra",
        modeId: "full-access",
        thinkingOptionId: "ultra",
        featureValues: { auto_accept: true },
      }),
    ).toEqual({
      provider: "codex",
      cwd: "/repo",
      modeId: "full-access",
      model: "gpt-6-astra",
      thinkingOptionId: "ultra",
      featureValues: { auto_accept: true },
    });
  });

  it("leaves a field the profile does not name to the new provider's default", () => {
    expect(
      buildProviderSwitchDraftSetup({
        cwd: "/repo",
        provider: "claude",
        model: "",
        modeId: "",
        thinkingOptionId: "",
      }),
    ).toEqual({
      provider: "claude",
      cwd: "/repo",
      modeId: null,
      model: null,
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

  it("does not throw when archiveAgent rejects", async () => {
    const retargetCurrentTab = vi.fn();
    const unpinWorkspaceAgent = vi.fn();
    const hideWorkspaceAgent = vi.fn();
    const archiveAgent = vi.fn(async () => {
      throw new Error("archive timeout");
    });

    await expect(
      replaceOpenAgentWithDraft({
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
      }),
    ).resolves.toBeUndefined();

    expect(retargetCurrentTab).toHaveBeenCalled();
  });
});

describe("switchAgentProviderToDraft", () => {
  const historyAttachment: ChatHistoryAttachment = {
    type: "text",
    mimeType: "text/plain",
    contextKind: "chat_history",
    title: "Chat history",
    text: "<chat-history-summary>prior turns</chat-history-summary>",
  };

  function createSwitchInput(
    overrides: Partial<Parameters<typeof switchAgentProviderToDraft>[0]> = {},
  ): Parameters<typeof switchAgentProviderToDraft>[0] {
    return {
      serverId: "server-1",
      agentId: "agent-1",
      workspaceId: "workspace-1",
      setup: buildProviderSwitchDraftSetup({
        cwd: "/repo",
        provider: "codex",
        model: "gpt-5.4",
      }),
      draftId: "draft-1",
      chatHistoryClient: null,
      retargetCurrentTab: vi.fn(),
      unpinWorkspaceAgent: vi.fn(),
      hideWorkspaceAgent: vi.fn(),
      archiveAgent: vi.fn(async () => {}),
      ...overrides,
    };
  }

  /** Resolves only when the test releases it, so ordering cannot pass by luck. */
  function createDeferredForkContextClient(itemCount = 7) {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    return {
      release,
      client: {
        buildAgentForkContext: vi.fn(async () => {
          await released;
          return {
            requestId: "request-1",
            agentId: "agent-1",
            attachment: itemCount === 0 ? null : historyAttachment,
            itemCount,
            boundaryCursor: null,
            boundaryMessageId: null,
            error: null,
          };
        }),
      },
    };
  }

  function readDraftAttachments(draftId: string) {
    return useWorkspaceAttachmentsStore.getState().attachmentsByScope[
      buildDraftWorkspaceAttachmentScopeKey(draftId)
    ];
  }

  beforeEach(() => {
    resetWorkspaceAttachmentsStore();
  });

  it("shows the replacement draft immediately, then carries the history, then archives", async () => {
    const order: string[] = [];
    const { release, client } = createDeferredForkContextClient();
    const retargetCurrentTab = vi.fn(() => {
      order.push("retarget");
    });
    const archiveAgent = vi.fn(async () => {
      order.push("archive");
    });

    const switched = switchAgentProviderToDraft(
      createSwitchInput({ chatHistoryClient: client, retargetCurrentTab, archiveAgent }),
    );
    // The fork-context RPC is still in flight: the user already sees the new
    // draft, and the source agent is still alive to be read from.
    await Promise.resolve();
    expect(order).toEqual(["retarget"]);
    expect(archiveAgent).not.toHaveBeenCalled();

    release();
    expect(await switched).toBe("carried");

    // Archiving closes the runtime and discards the retained timeline, so the
    // history has to be in hand before it runs.
    expect(order).toEqual(["retarget", "archive"]);
    expect(client.buildAgentForkContext).toHaveBeenCalledWith("agent-1", undefined);
    expect(readDraftAttachments("draft-1")).toEqual([
      {
        kind: "chat_history",
        id: "chat_history:draft-1",
        attachment: historyAttachment,
        source: {
          serverId: "server-1",
          agentId: "agent-1",
          boundaryMessageId: null,
          boundaryCursor: null,
          itemCount: 7,
        },
      },
    ]);
  });

  it("reports the failure to the caller and still completes the switch", async () => {
    const archiveAgent = vi.fn(async () => {});
    const chatHistoryClient = {
      buildAgentForkContext: vi.fn(async () => {
        throw new Error("host disconnected");
      }),
    };

    const outcome = await switchAgentProviderToDraft(
      createSwitchInput({ chatHistoryClient, archiveAgent }),
    );

    // Being stranded on the provider you are leaving is worse than arriving
    // without the history, so the switch completes and the caller is told.
    expect(outcome).toBe("failed");
    expect(archiveAgent).toHaveBeenCalledOnce();
    expect(readDraftAttachments("draft-1")).toBeUndefined();
  });

  it("leaves the draft clean when the source agent had no conversation yet", async () => {
    const archiveAgent = vi.fn(async () => {});
    const { release, client } = createDeferredForkContextClient(0);
    release();

    const outcome = await switchAgentProviderToDraft(
      createSwitchInput({ chatHistoryClient: client, archiveAgent }),
    );

    // Switching provider before ever prompting must not prepend the daemon's
    // "No chat history to display." to the first real prompt.
    expect(outcome).toBe("skipped");
    expect(archiveAgent).toHaveBeenCalledOnce();
    expect(readDraftAttachments("draft-1")).toBeUndefined();
  });

  it("switches with a clean draft when the host cannot build fork context", async () => {
    const archiveAgent = vi.fn(async () => {});

    const outcome = await switchAgentProviderToDraft(createSwitchInput({ archiveAgent }));

    expect(outcome).toBe("skipped");
    expect(archiveAgent).toHaveBeenCalledOnce();
    expect(readDraftAttachments("draft-1")).toBeUndefined();
  });
});
