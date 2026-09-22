import { describe, expect, test, vi } from "vitest";

import {
  ACPAgentSession,
  DEFAULT_ACP_CAPABILITIES,
  type SpawnedACPProcess,
  type SessionStateResponse,
} from "./acp-agent.js";
import {
  CURSOR_FAST_FEATURE_OPTION,
  CursorACPAgentClient,
  resolveCursorThoughtLevelConfigId,
  writeCursorThinkingOption,
} from "./cursor-acp-agent.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { asInternals } from "../../test-utils/class-mocks.js";

describe("CursorACPAgentClient model discovery", () => {
  function fastConfigOption(currentValue: "false" | "true") {
    return {
      id: "fast",
      name: "Fast",
      type: "select" as const,
      currentValue,
      options: [
        { value: "false", name: "Off" },
        { value: "true", name: "Fast" },
      ],
    };
  }
  class TestCursorACPAgentClient extends CursorACPAgentClient {
    constructor(response: SessionStateResponse) {
      super({
        logger: createTestLogger(),
        command: ["cursor-agent", "acp"],
      });
      this.response = response;
    }

    private readonly response: SessionStateResponse;

    spawnCount = 0;

    protected override async spawnProcess(): Promise<SpawnedACPProcess> {
      this.spawnCount += 1;
      return {
        child: { kill: vi.fn(), exitCode: 0, signalCode: null, once: vi.fn() },
        connection: {
          newSession: vi.fn().mockResolvedValue(this.response),
          extMethod: async () => ({
            models: (this.response.models?.availableModels ?? []).map((model) => ({
              value: model.modelId,
              name: model.name,
              configOptions: [],
            })),
          }),
        },
        initialize: { agentCapabilities: {} },
      } as SpawnedACPProcess;
    }

    protected override async closeProbe(): Promise<void> {}
  }

  test("returns only ACP model ids because Cursor CLI ids cannot select ACP models", async () => {
    const client = new TestCursorACPAgentClient({
      sessionId: "session-1",
      models: {
        currentModelId: "gpt-5.4[context=272k,reasoning=medium,fast=false]",
        availableModels: [
          {
            modelId: "gpt-5.4[context=272k,reasoning=medium,fast=false]",
            name: "gpt-5.4",
            description: null,
          },
        ],
      },
      configOptions: [],
    });

    await expect(
      client.fetchCatalog({ scope: "workspace", cwd: "/tmp/cursor", force: false }),
    ).resolves.toEqual({
      models: [
        {
          provider: "acp",
          id: "gpt-5.4[context=272k,reasoning=medium,fast=false]",
          label: "gpt-5.4",
          description: undefined,
          isDefault: true,
          thinkingOptions: undefined,
          defaultThinkingOptionId: undefined,
        },
      ],
      modes: [],
    });
  });

  test("does not fall back to cursor-agent models when ACP reports zero models", async () => {
    const client = new TestCursorACPAgentClient({
      sessionId: "session-1",
      models: null,
      configOptions: [],
    });

    await expect(
      client.fetchCatalog({ scope: "workspace", cwd: "/tmp/cursor", force: false }),
    ).resolves.toEqual({
      models: [],
      modes: [],
    });
  });

  test("keeps modern Cursor models as plain ACP ids", async () => {
    const client = new TestCursorACPAgentClient({
      sessionId: "session-1",
      models: {
        currentModelId: "composer-2.5",
        availableModels: [
          {
            modelId: "composer-2.5",
            name: "Composer 2.5",
            description: null,
          },
        ],
      },
      configOptions: [fastConfigOption("false")],
    });

    await expect(
      client.fetchCatalog({ scope: "workspace", cwd: "/tmp/cursor", force: false }),
    ).resolves.toEqual({
      models: [
        {
          provider: "acp",
          id: "composer-2.5",
          label: "Composer 2.5",
          description: undefined,
          isDefault: true,
          thinkingOptions: undefined,
          defaultThinkingOptionId: undefined,
        },
      ],
      modes: [],
    });
  });

  test("advertises Fast without starting a Cursor probe", async () => {
    const client = new TestCursorACPAgentClient({
      sessionId: "session-1",
      models: null,
      configOptions: [fastConfigOption("false")],
    });
    await expect(
      client.listFeatures({
        provider: "acp",
        cwd: "/tmp/cursor",
      }),
    ).resolves.toEqual([
      {
        type: "toggle",
        id: "auto_accept",
        label: "Auto Accept",
        description: "Automatically approves ACP permission prompts.",
        tooltip: "Auto accept permission prompts",
        icon: "shield-check",
        value: false,
      },
      {
        type: "select",
        id: CURSOR_FAST_FEATURE_OPTION.id,
        label: "Fast",
        description: "Cursor fast mode",
        tooltip: "Select Cursor fast mode",
        icon: "zap",
        value: "true",
        options: [
          {
            id: "false",
            label: "Off",
            isDefault: false,
            description: undefined,
            metadata: undefined,
          },
          {
            id: "true",
            label: "Fast",
            isDefault: true,
            description: undefined,
            metadata: undefined,
          },
        ],
      },
    ]);
    expect(client.spawnCount).toBe(0);
  });

  test("keeps a selected Fast value without starting a Cursor probe", async () => {
    const client = new TestCursorACPAgentClient({
      sessionId: "session-1",
      models: null,
      configOptions: [fastConfigOption("true")],
    });

    const features = await client.listFeatures({
      provider: "acp",
      cwd: "/tmp/cursor",
      featureValues: { fast: "false" },
    });
    expect(features[1]).toMatchObject({
      id: CURSOR_FAST_FEATURE_OPTION.id,
      value: "false",
    });
    expect(client.spawnCount).toBe(0);
  });

  test("shares the Cursor catalog across workspaces", async () => {
    const client = new TestCursorACPAgentClient({
      sessionId: "session-1",
      models: null,
      configOptions: [],
    });

    await expect(
      client.getCatalogCacheKey({ scope: "workspace", cwd: "/a", force: false }),
    ).resolves.toBe("host");
    await expect(
      client.getCatalogCacheKey({ scope: "workspace", cwd: "/b", force: false }),
    ).resolves.toBe("host");
  });
});

describe("Cursor thought-level writes", () => {
  test.each([
    ["true", "thinking"],
    ["false", "thinking"],
    ["low", "effort"],
    ["medium", "effort"],
    ["high", "effort"],
    ["xhigh", "effort"],
  ] as const)("maps %s to Cursor config %s", (thinkingOptionId, configId) => {
    expect(resolveCursorThoughtLevelConfigId(thinkingOptionId)).toBe(configId);
  });

  test("rejects unknown thinking ids instead of writing session/new's reasoning option", () => {
    expect(() => resolveCursorThoughtLevelConfigId("reasoning")).toThrow(
      "cursor does not expose ACP thought-level selection",
    );
  });

  test("writes Extra High to effort when the live session still advertises reasoning", async () => {
    const session = new ACPAgentSession(
      {
        provider: "acp",
        cwd: "/tmp/cursor",
      },
      {
        provider: "acp",
        logger: createTestLogger(),
        defaultCommand: ["cursor-agent", "acp"],
        defaultModes: [],
        capabilities: DEFAULT_ACP_CAPABILITIES,
        thinkingOptionWriter: writeCursorThinkingOption,
      },
    );
    const setSessionConfigOption = vi.fn(async () => ({
      configOptions: [
        {
          id: "effort",
          name: "Effort",
          category: "thought_level",
          type: "select" as const,
          currentValue: "xhigh",
          options: [
            { value: "low", name: "Low" },
            { value: "medium", name: "Medium" },
            { value: "high", name: "High" },
            { value: "xhigh", name: "Extra High" },
          ],
        },
      ],
    }));
    const internals = asInternals<{
      sessionId: string;
      connection: { setSessionConfigOption: typeof setSessionConfigOption };
      configOptions: Array<{
        id: string;
        name: string;
        category: "thought_level";
        type: "select";
        currentValue: string;
        options: Array<{ value: string; name: string }>;
      }>;
    }>(session);
    internals.sessionId = "session-1";
    internals.connection = { setSessionConfigOption };
    internals.configOptions = [
      {
        id: "reasoning",
        name: "Reasoning",
        category: "thought_level",
        type: "select",
        currentValue: "high",
        options: [
          { value: "low", name: "Low" },
          { value: "medium", name: "Medium" },
          { value: "high", name: "High" },
          { value: "xhigh", name: "Extra High" },
        ],
      },
    ];

    await session.setThinkingOption("xhigh");

    expect(setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: "session-1",
      configId: "effort",
      value: "xhigh",
    });
    await expect(session.getRuntimeInfo()).resolves.toMatchObject({ thinkingOptionId: "xhigh" });
  });

  test("keeps the session when the stored thinking level is not a Cursor effort", async () => {
    const logger = createTestLogger();
    const childLogger = { trace: vi.fn(), warn: vi.fn() };
    vi.spyOn(logger, "child").mockReturnValue(asInternals<typeof logger>(childLogger));
    const session = new ACPAgentSession(
      {
        provider: "cursor",
        cwd: "/tmp/cursor",
        thinkingOptionId: "max",
      },
      {
        provider: "cursor",
        logger,
        defaultCommand: ["cursor-agent", "acp"],
        defaultModes: [],
        capabilities: DEFAULT_ACP_CAPABILITIES,
        thinkingOptionWriter: writeCursorThinkingOption,
      },
    );
    const setSessionConfigOption = vi.fn();
    const internals = asInternals<{
      sessionId: string;
      connection: { setSessionConfigOption: typeof setSessionConfigOption };
      thinkingOptionId: string | null;
      applyConfiguredOverrides: () => Promise<void>;
    }>(session);
    internals.sessionId = "session-1";
    internals.connection = { setSessionConfigOption };
    internals.thinkingOptionId = "high";

    await expect(internals.applyConfiguredOverrides()).resolves.toBeUndefined();
    expect(setSessionConfigOption).not.toHaveBeenCalled();
    expect(childLogger.warn).toHaveBeenCalledWith(
      { value: "max" },
      "cursor does not expose ACP thought-level selection; keeping the current level",
    );
  });
});
