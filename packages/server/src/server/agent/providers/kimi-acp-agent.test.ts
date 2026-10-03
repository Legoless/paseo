import { SessionConfigOption } from "@agentclientprotocol/sdk";
import { appendFile, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { type ACPPromptResponseContext, type SpawnedACPProcess } from "./acp-agent.js";
import { KimiACPAgentClient, validateKimiPromptResponse } from "./kimi-acp-agent.js";

function modelConfigOption(currentValue: string): SessionConfigOption {
  return {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue,
    options: [
      { value: "kimi-for-coding", name: "K2.7 Coding Fast" },
      { value: "kimi-k3", name: "K3" },
    ],
  };
}

function booleanThinkingConfigOption(): SessionConfigOption {
  return {
    id: "thinking",
    name: "Thinking",
    category: "thought_level",
    type: "select",
    currentValue: "off",
    options: [
      { value: "off", name: "Off" },
      { value: "on", name: "On" },
    ],
  };
}

function effortThinkingConfigOption(): SessionConfigOption {
  return {
    id: "thinking",
    name: "Thinking",
    category: "thought_level",
    type: "select",
    currentValue: "medium",
    options: [
      { value: "off", name: "Off" },
      { value: "low", name: "Low" },
      { value: "medium", name: "Medium" },
      { value: "high", name: "High" },
    ],
  };
}

function createKimiClient(spawnProcess: () => Promise<SpawnedACPProcess>): KimiACPAgentClient {
  class TestKimiACPAgentClient extends KimiACPAgentClient {
    protected override async spawnProcess(): Promise<SpawnedACPProcess> {
      return spawnProcess();
    }

    protected override async closeProbe(): Promise<void> {}
  }

  return new TestKimiACPAgentClient({
    logger: createTestLogger(),
    command: ["kimi", "acp"],
    providerId: "kimi",
    label: "Kimi Code CLI",
  });
}

describe("KimiACPAgentClient per-model thinking options", () => {
  test("probes each model so a boolean model and an effort-level model keep distinct thinking options", async () => {
    const setSessionConfigOption = vi.fn(async ({ value }: { value: string }) => ({
      configOptions:
        value === "kimi-k3"
          ? [modelConfigOption(value), effortThinkingConfigOption()]
          : [modelConfigOption(value), booleanThinkingConfigOption()],
    }));

    const client = createKimiClient(
      async () =>
        ({
          child: { kill: vi.fn(), exitCode: 0, signalCode: null, once: vi.fn() },
          connection: {
            newSession: vi.fn().mockResolvedValue({
              sessionId: "session-1",
              configOptions: [modelConfigOption("kimi-for-coding"), booleanThinkingConfigOption()],
            }),
            setSessionConfigOption,
          },
          initialize: { agentCapabilities: {} },
        }) as unknown as SpawnedACPProcess,
    );

    const catalog = await client.fetchCatalog({
      scope: "workspace",
      cwd: "/tmp/acp-kimi-thinking",
      force: false,
    });

    expect(setSessionConfigOption).toHaveBeenCalledTimes(2);
    expect(setSessionConfigOption).toHaveBeenNthCalledWith(1, {
      sessionId: "session-1",
      configId: "model",
      value: "kimi-for-coding",
    });
    expect(setSessionConfigOption).toHaveBeenNthCalledWith(2, {
      sessionId: "session-1",
      configId: "model",
      value: "kimi-k3",
    });

    const kimiForCoding = catalog.models.find((model) => model.id === "kimi-for-coding");
    const kimiK3 = catalog.models.find((model) => model.id === "kimi-k3");

    expect(kimiForCoding?.thinkingOptions).toEqual([
      expect.objectContaining({ id: "off", isDefault: true }),
      expect.objectContaining({ id: "on", isDefault: false }),
    ]);
    expect(kimiK3?.thinkingOptions).toEqual([
      expect.objectContaining({ id: "off", isDefault: false }),
      expect.objectContaining({ id: "low", isDefault: false }),
      expect.objectContaining({ id: "medium", isDefault: true }),
      expect.objectContaining({ id: "high", isDefault: false }),
    ]);
  });

  test("skips per-model probing when the provider reports a single model", async () => {
    const setSessionConfigOption = vi.fn();

    const client = createKimiClient(
      async () =>
        ({
          child: { kill: vi.fn(), exitCode: 0, signalCode: null, once: vi.fn() },
          connection: {
            newSession: vi.fn().mockResolvedValue({
              sessionId: "session-1",
              configOptions: [
                {
                  id: "model",
                  name: "Model",
                  category: "model",
                  type: "select",
                  currentValue: "kimi-for-coding",
                  options: [{ value: "kimi-for-coding", name: "K2.7 Coding Fast" }],
                },
                booleanThinkingConfigOption(),
              ],
            }),
            setSessionConfigOption,
          },
          initialize: { agentCapabilities: {} },
        }) as unknown as SpawnedACPProcess,
    );

    await client.fetchCatalog({ scope: "workspace", cwd: "/tmp/acp-kimi-single", force: false });

    expect(setSessionConfigOption).not.toHaveBeenCalled();
  });

  test("probes each model when session/new has no thought_level so a later model can still expose thinking options", async () => {
    const setSessionConfigOption = vi.fn(async ({ value }: { value: string }) => ({
      configOptions:
        value === "kimi-k3"
          ? [modelConfigOption(value), effortThinkingConfigOption()]
          : [modelConfigOption(value)],
    }));

    const client = createKimiClient(
      async () =>
        ({
          child: { kill: vi.fn(), exitCode: 0, signalCode: null, once: vi.fn() },
          connection: {
            newSession: vi.fn().mockResolvedValue({
              sessionId: "session-1",
              configOptions: [modelConfigOption("kimi-for-coding")],
            }),
            setSessionConfigOption,
          },
          initialize: { agentCapabilities: {} },
        }) as unknown as SpawnedACPProcess,
    );

    const catalog = await client.fetchCatalog({
      scope: "workspace",
      cwd: "/tmp/acp-kimi-no-thinking",
      force: false,
    });

    expect(setSessionConfigOption).toHaveBeenCalledTimes(2);

    const kimiForCoding = catalog.models.find((model) => model.id === "kimi-for-coding");
    const kimiK3 = catalog.models.find((model) => model.id === "kimi-k3");
    expect(kimiForCoding?.thinkingOptions).toBeUndefined();
    expect(kimiForCoding?.defaultThinkingOptionId).toBeUndefined();
    expect(kimiK3?.thinkingOptions).toEqual([
      expect.objectContaining({ id: "off", isDefault: false }),
      expect.objectContaining({ id: "low", isDefault: false }),
      expect.objectContaining({ id: "medium", isDefault: true }),
      expect.objectContaining({ id: "high", isDefault: false }),
    ]);
    expect(kimiK3?.defaultThinkingOptionId).toBe("medium");
  });

  test("omits thinking options when a model's probe fails instead of keeping another model's list", async () => {
    const setSessionConfigOption = vi.fn(async ({ value }: { value: string }) => {
      if (value === "kimi-k3") {
        throw new Error("probe rejected model switch");
      }
      return { configOptions: [modelConfigOption(value), booleanThinkingConfigOption()] };
    });

    const client = createKimiClient(
      async () =>
        ({
          child: { kill: vi.fn(), exitCode: 0, signalCode: null, once: vi.fn() },
          connection: {
            newSession: vi.fn().mockResolvedValue({
              sessionId: "session-1",
              configOptions: [modelConfigOption("kimi-for-coding"), booleanThinkingConfigOption()],
            }),
            setSessionConfigOption,
          },
          initialize: { agentCapabilities: {} },
        }) as unknown as SpawnedACPProcess,
    );

    const catalog = await client.fetchCatalog({
      scope: "workspace",
      cwd: "/tmp/acp-kimi-probe-error",
      force: false,
    });

    const kimiForCoding = catalog.models.find((model) => model.id === "kimi-for-coding");
    const kimiK3 = catalog.models.find((model) => model.id === "kimi-k3");
    expect(kimiForCoding?.thinkingOptions).toEqual([
      expect.objectContaining({ id: "off", isDefault: true }),
      expect.objectContaining({ id: "on", isDefault: false }),
    ]);
    expect(kimiK3?.thinkingOptions).toBeUndefined();
    expect(kimiK3?.defaultThinkingOptionId).toBeUndefined();
  });
});

const OAUTH_ERROR = {
  code: "internal",
  message: "OAuth request to https://auth.kimi.ai/api/oauth/token failed: fetch failed",
  name: "OAuthConnectionError",
  retryable: false,
  cause: { code: "internal", message: "fetch failed", name: "TypeError", retryable: false },
};

function stringifyJournalRows(rows: readonly Record<string, unknown>[]): string {
  return rows.map((row) => `${JSON.stringify(row)}\n`).join("");
}

async function withKimiJournal(
  run: (fixture: { context: ACPPromptResponseContext; journalPath: string }) => Promise<void>,
  useCustomHome = true,
): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "paseo-kimi-error-"));
  const dataHome = join(home, useCustomHome ? "custom-kimi" : ".kimi-code");
  const context: ACPPromptResponseContext = {
    response: { stopReason: "end_turn" },
    sessionId: "session_test",
    cwd: "/Users/test/Monet Core/",
    startedAt: Date.now(),
    env: { HOME: home, ...(useCustomHome ? { KIMI_CODE_HOME: dataHome } : {}) },
  };
  const journalPath = join(
    dataHome,
    "sessions",
    "wd_monet-core_4fc67357f555",
    context.sessionId,
    "agents/main/wire.jsonl",
  );
  try {
    await mkdir(dirname(journalPath), { recursive: true });
    await run({ context, journalPath });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

describe("Kimi ACP native prompt failures", () => {
  test("surfaces the structured OAuth failure that Kimi reports as end_turn", async () => {
    await withKimiJournal(async ({ context, journalPath }) => {
      await writeFile(
        journalPath,
        `${JSON.stringify({
          type: "turn.ended",
          time: context.startedAt,
          turnId: "native-turn",
          reason: "failed",
          error: OAUTH_ERROR,
        })}\n`,
      );
      await expect(validateKimiPromptResponse(context)).rejects.toMatchObject({
        name: "KimiNativeTurnError",
        message: `OAuthConnectionError: ${OAUTH_ERROR.message}`,
        code: "internal",
      });
    });
  });

  test.each(["completed", "cancelled", "blocked"])(
    "does not replay a previous failure after the current turn is %s",
    async (reason) => {
      await withKimiJournal(async ({ context, journalPath }) => {
        await writeFile(
          journalPath,
          stringifyJournalRows([
            {
              type: "turn.ended",
              time: context.startedAt,
              reason: "failed",
              error: OAUTH_ERROR,
            },
            { type: "turn.ended", time: context.startedAt, reason, error: null },
          ]),
        );
        await expect(validateKimiPromptResponse(context)).resolves.toBeUndefined();
      });
    },
  );

  test("ignores historical failures when no current terminal record exists", async () => {
    await withKimiJournal(async ({ context, journalPath }) => {
      await writeFile(
        journalPath,
        `${JSON.stringify({
          type: "turn.ended",
          time: context.startedAt - 1,
          reason: "failed",
          error: OAUTH_ERROR,
        })}\n`,
      );
      await expect(validateKimiPromptResponse(context)).resolves.toBeUndefined();
    });
  });

  test("uses the configured HOME when KIMI_CODE_HOME is absent", async () => {
    await withKimiJournal(async ({ context, journalPath }) => {
      await writeFile(
        journalPath,
        `${JSON.stringify({
          type: "turn.ended",
          time: context.startedAt,
          reason: "failed",
          error: OAUTH_ERROR,
        })}\n`,
      );
      await expect(validateKimiPromptResponse(context)).rejects.toThrow(OAUTH_ERROR.message);
    }, false);
  });

  test("waits for a partially written current terminal record to finish", async () => {
    await withKimiJournal(async ({ context, journalPath }) => {
      const terminal = JSON.stringify({
        type: "turn.ended",
        time: context.startedAt,
        reason: "failed",
        error: OAUTH_ERROR,
      });
      await writeFile(journalPath, `${terminal.slice(0, -1)}`);
      const validation = expect(validateKimiPromptResponse(context)).rejects.toThrow(
        OAUTH_ERROR.message,
      );
      await appendFile(journalPath, "}\n");
      await validation;
    });
  });

  test("waits for a new journal to persist its first failed turn", async () => {
    await withKimiJournal(async ({ context, journalPath }) => {
      const validation = expect(validateKimiPromptResponse(context)).rejects.toThrow(
        OAUTH_ERROR.message,
      );
      await expect(stat(journalPath)).rejects.toMatchObject({ code: "ENOENT" });
      await writeFile(
        journalPath,
        `${JSON.stringify({
          type: "turn.ended",
          time: context.startedAt,
          reason: "failed",
          error: OAUTH_ERROR,
        })}\n`,
      );
      await validation;
    });
  });

  test("surfaces unexpected native journal I/O failures", async () => {
    await withKimiJournal(async ({ context, journalPath }) => {
      await mkdir(journalPath);
      await expect(validateKimiPromptResponse(context)).rejects.toBeInstanceOf(Error);
    });
  });

  test("reads failures at the bounded tail of a large journal and ignores malformed rows", async () => {
    await withKimiJournal(async ({ context, journalPath }) => {
      await writeFile(
        journalPath,
        `${"unrelated journal history\n".repeat(10000)}not-json\n${JSON.stringify({
          type: "turn.ended",
          time: context.startedAt,
          reason: "failed",
          error: OAUTH_ERROR,
        })}\n`,
      );
      await expect(validateKimiPromptResponse(context)).rejects.toThrow(OAUTH_ERROR.message);
    });
  });

  test("preserves ACP cancellation and completion without a native journal", async () => {
    await withKimiJournal(async ({ context, journalPath }) => {
      await rm(journalPath, { force: true });
      await expect(validateKimiPromptResponse(context)).resolves.toBeUndefined();
      await expect(
        validateKimiPromptResponse({ ...context, response: { stopReason: "cancelled" } }),
      ).resolves.toBeUndefined();
    });
  });
});
