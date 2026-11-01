import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type SessionConfigOption,
} from "@agentclientprotocol/sdk";
import { type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { appendFile, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import * as providerLaunchConfig from "../provider-launch-config.js";
import * as spawnUtils from "../../../utils/spawn.js";
import type { AgentStreamEvent } from "../agent-sdk-types.js";
import { type ACPPromptResponseContext, type SpawnedACPProcess } from "./acp-agent.js";
import {
  KimiACPAgentClient,
  kimiNativeTurnStillOpen,
  validateKimiPromptResponse,
} from "./kimi-acp-agent.js";

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
      { value: "off", name: "Thinking Off" },
      { value: "on", name: "Thinking On" },
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
      { value: "off", name: "Thinking Off" },
      { value: "low", name: "Thinking Low" },
      { value: "medium", name: "Thinking Medium" },
      { value: "high", name: "Thinking High" },
      { value: "max", name: "Thinking Max" },
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
      expect.objectContaining({ id: "off", label: "Off", isDefault: true }),
      expect.objectContaining({ id: "on", label: "On", isDefault: false }),
    ]);
    expect(kimiK3?.thinkingOptions).toEqual([
      expect.objectContaining({ id: "off", label: "Off", isDefault: false }),
      expect.objectContaining({ id: "low", label: "Low", isDefault: false }),
      expect.objectContaining({ id: "medium", label: "Medium", isDefault: true }),
      expect.objectContaining({ id: "high", label: "High", isDefault: false }),
      expect.objectContaining({ id: "max", label: "Max", isDefault: false }),
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
      expect.objectContaining({ id: "off", label: "Off", isDefault: false }),
      expect.objectContaining({ id: "low", label: "Low", isDefault: false }),
      expect.objectContaining({ id: "medium", label: "Medium", isDefault: true }),
      expect.objectContaining({ id: "high", label: "High", isDefault: false }),
      expect.objectContaining({ id: "max", label: "Max", isDefault: false }),
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

  test("surfaces a failed turn after message replay pushes its detailed error outside the journal tail", async () => {
    await withKimiJournal(async ({ context, journalPath }) => {
      const message = `OAuthConnectionError: ${OAUTH_ERROR.message}`;
      await writeFile(
        journalPath,
        stringifyJournalRows([
          {
            type: "turn.ended",
            time: context.startedAt,
            turnId: 7,
            reason: "failed",
            error: OAUTH_ERROR,
          },
          {
            type: "agent.message.appended",
            time: context.startedAt,
            content: "replayed assistant message".repeat(4000),
          },
          {
            type: "agent.turn.ended",
            time: context.startedAt,
            turnId: 7,
            outcome: "failed",
            errorMessage: message,
          },
        ]),
      );

      await expect(validateKimiPromptResponse(context)).rejects.toMatchObject({
        name: "KimiNativeTurnError",
        message,
      });
    });
  });

  test.each(["done", "aborted"])(
    "does not replay a previous failure after the current compact summary is %s",
    async (outcome) => {
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
            { type: "agent.turn.ended", time: context.startedAt, turnId: 7, outcome },
          ]),
        );

        await expect(validateKimiPromptResponse(context)).resolves.toBeUndefined();
      });
    },
  );

  test("ignores historical compact failures replayed after the current turn", async () => {
    await withKimiJournal(async ({ context, journalPath }) => {
      await writeFile(
        journalPath,
        stringifyJournalRows([
          { type: "turn.ended", time: context.startedAt, reason: "completed" },
          {
            type: "agent.turn.ended",
            time: context.startedAt - 1,
            turnId: 6,
            outcome: "failed",
            errorMessage: OAUTH_ERROR.message,
          },
        ]),
      );

      await expect(validateKimiPromptResponse(context)).resolves.toBeUndefined();
    });
  });

  test("preserves quota classification from a compact failed summary", async () => {
    const message = "Authentication required: 403 You've reached your 5-hour usage limit.";
    await withKimiJournal(async ({ context, journalPath }) => {
      await writeFile(
        journalPath,
        stringifyJournalRows([
          {
            type: "agent.turn.ended",
            time: context.startedAt,
            turnId: 7,
            outcome: "failed",
            errorMessage: message,
          },
        ]),
      );

      await expect(validateKimiPromptResponse(context)).rejects.toMatchObject({
        name: "KimiNativeTurnError",
        message,
        code: "quota",
      });
    });
  });

  test("reports a compact failure even when its error message is missing", async () => {
    await withKimiJournal(async ({ context, journalPath }) => {
      await writeFile(
        journalPath,
        stringifyJournalRows([
          { type: "agent.turn.ended", time: context.startedAt, turnId: 7, outcome: "failed" },
        ]),
      );

      await expect(validateKimiPromptResponse(context)).rejects.toThrow(
        "Kimi failed to complete the turn",
      );
    });
  });

  test("waits for a partially written compact failure summary", async () => {
    await withKimiJournal(async ({ context, journalPath }) => {
      const summary = JSON.stringify({
        type: "agent.turn.ended",
        time: context.startedAt,
        turnId: 7,
        outcome: "failed",
        errorMessage: OAUTH_ERROR.message,
      });
      await writeFile(journalPath, summary.slice(0, -1));
      const validation = expect(validateKimiPromptResponse(context)).rejects.toThrow(
        OAUTH_ERROR.message,
      );
      await appendFile(journalPath, "}\n");
      await validation;
    });
  });

  test("reclassifies a usage-limit 403 as quota instead of Kimi's misleading auth name", async () => {
    const quotaError = {
      code: "internal",
      message:
        "403 You've reached your 5-hour usage limit. Your quota will reset when the current 5-hour window ends.",
      name: "Authentication required",
    };
    await withKimiJournal(async ({ context, journalPath }) => {
      await writeFile(
        journalPath,
        `${JSON.stringify({
          type: "turn.ended",
          time: context.startedAt,
          turnId: "native-turn",
          reason: "failed",
          error: quotaError,
        })}\n`,
      );
      await expect(validateKimiPromptResponse(context)).rejects.toMatchObject({
        name: "KimiNativeTurnError",
        message: quotaError.message,
        code: "quota",
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

  test("rejects an empty end_turn while an older native turn is still open", async () => {
    await withKimiJournal(async ({ context, journalPath }) => {
      await writeFile(
        journalPath,
        stringifyJournalRows([
          { type: "agent.turn.started", time: context.startedAt - 1_000 },
          { type: "llm.request", time: context.startedAt + 10 },
          { type: "context.append_loop_event", time: context.startedAt + 20 },
        ]),
      );

      await expect(validateKimiPromptResponse(context)).rejects.toMatchObject({
        name: "KimiNativeTurnError",
        message: "Kimi left this prompt queued behind a turn that is still running. Send it again.",
        code: "kimi_turn_busy",
      });
    });
  });

  test.each(["agent.turn.ended", "turn.ended"] as const)(
    "accepts end_turn when %s for this prompt is already closed",
    async (type) => {
      await withKimiJournal(async ({ context, journalPath }) => {
        await writeFile(
          journalPath,
          stringifyJournalRows([
            { type: "llm.request", time: context.startedAt - 30 },
            type === "agent.turn.ended"
              ? { type, time: context.startedAt, outcome: "done" }
              : { type, time: context.startedAt, reason: "completed", error: null },
          ]),
        );

        await expect(validateKimiPromptResponse(context)).resolves.toBeUndefined();
      });
    },
  );

  test("accepts end_turn when this prompt has a native marker and an older turn was open", async () => {
    await withKimiJournal(async ({ context, journalPath }) => {
      await writeFile(
        journalPath,
        stringifyJournalRows([
          { type: "llm.request", time: context.startedAt - 30 },
          { type: "turn.prompt", time: context.startedAt },
        ]),
      );

      await expect(validateKimiPromptResponse(context)).resolves.toBeUndefined();
    });
  });

  test("does not treat cancellation as a prompt queued behind an open turn", async () => {
    await withKimiJournal(async ({ context, journalPath }) => {
      await writeFile(
        journalPath,
        stringifyJournalRows([
          { type: "llm.request", time: context.startedAt - 30 },
          { type: "agent.turn.ended", time: context.startedAt, outcome: "aborted" },
        ]),
      );

      await expect(
        validateKimiPromptResponse({ ...context, response: { stopReason: "cancelled" } }),
      ).resolves.toBeUndefined();
    });
  });

  test("accepts end_turn when the open turn finishes flushing", async () => {
    await withKimiJournal(async ({ context, journalPath }) => {
      await writeFile(
        journalPath,
        stringifyJournalRows([{ type: "llm.request", time: context.startedAt - 20 }]),
      );
      const validation = expect(validateKimiPromptResponse(context)).resolves.toBeUndefined();
      await appendFile(
        journalPath,
        `${JSON.stringify({
          type: "agent.turn.ended",
          time: context.startedAt,
          outcome: "done",
        })}\n`,
      );
      await validation;
    });
  });

  test("reports a native turn still open until a close record lands", async () => {
    await withKimiJournal(async ({ context, journalPath }) => {
      await writeFile(
        journalPath,
        stringifyJournalRows([{ type: "context.append_loop_event", time: context.startedAt }]),
      );
      await expect(kimiNativeTurnStillOpen(context)).resolves.toBe(true);

      await appendFile(
        journalPath,
        `${JSON.stringify({ type: "prompt.completed", time: context.startedAt + 1 })}\n`,
      );
      await expect(kimiNativeTurnStillOpen(context)).resolves.toBe(false);
    });
  });

  test("ignores usage records after a native turn has closed", async () => {
    await withKimiJournal(async ({ context, journalPath }) => {
      await writeFile(
        journalPath,
        stringifyJournalRows([
          { type: "llm.request", time: context.startedAt },
          { type: "agent.turn.ended", time: context.startedAt, outcome: "done" },
          { type: "usage.record", time: context.startedAt + 1 },
        ]),
      );

      await expect(kimiNativeTurnStillOpen(context)).resolves.toBe(false);
    });
  });

  test("treats a missing journal as no open native turn", async () => {
    await withKimiJournal(async ({ context, journalPath }) => {
      await rm(journalPath, { force: true });
      await expect(kimiNativeTurnStillOpen(context)).resolves.toBe(false);
      await expect(kimiNativeTurnStillOpen({ ...context, sessionId: "../session" })).resolves.toBe(
        false,
      );
    });
  });

  test("expands the journal tail window when a >64KB trailing record pushes turn boundaries out of 64KB", async () => {
    await withKimiJournal(async ({ context, journalPath }) => {
      const hugePayload = "x".repeat(90 * 1024);
      await writeFile(
        journalPath,
        stringifyJournalRows([
          {
            type: "turn.ended",
            time: context.startedAt,
            reason: "failed",
            error: OAUTH_ERROR,
          },
          {
            type: "agent.message.appended",
            time: context.startedAt + 1,
            payload: hugePayload,
          },
          {
            type: "usage.record",
            time: context.startedAt + 2,
          },
        ]),
      );
      await expect(validateKimiPromptResponse(context)).rejects.toThrow(OAUTH_ERROR.message);

      await writeFile(
        journalPath,
        stringifyJournalRows([
          {
            type: "context.append_loop_event",
            time: context.startedAt,
            payload: hugePayload,
          },
          {
            type: "usage.record",
            time: context.startedAt + 1,
          },
        ]),
      );
      await expect(kimiNativeTurnStillOpen(context)).resolves.toBe(true);
    });
  });

  test("treats manual and auto full compaction as active until complete without leaving a phantom open turn", async () => {
    await withKimiJournal(async ({ context, journalPath }) => {
      await writeFile(
        journalPath,
        stringifyJournalRows([
          { type: "turn.ended", time: context.startedAt - 50, reason: "completed", error: null },
          { type: "full_compaction.begin", source: "manual", time: context.startedAt },
          { type: "llm.request", time: context.startedAt + 5 },
        ]),
      );
      await expect(kimiNativeTurnStillOpen(context)).resolves.toBe(true);

      await appendFile(
        journalPath,
        stringifyJournalRows([
          { type: "context.apply_compaction", time: context.startedAt + 10 },
          { type: "full_compaction.complete", time: context.startedAt + 15 },
        ]),
      );
      await expect(kimiNativeTurnStillOpen(context)).resolves.toBe(false);
      await expect(validateKimiPromptResponse(context)).resolves.toBeUndefined();

      await writeFile(
        journalPath,
        stringifyJournalRows([
          { type: "agent.turn.started", time: context.startedAt },
          { type: "full_compaction.begin", source: "auto", time: context.startedAt + 5 },
          { type: "llm.request", time: context.startedAt + 10 },
          { type: "full_compaction.complete", time: context.startedAt + 15 },
        ]),
      );
      await expect(kimiNativeTurnStillOpen(context)).resolves.toBe(true);
    });
  });
});

describe("KimiACPAgentClient background work and autonomous turns", () => {
  const tempHomes: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    while (tempHomes.length > 0) {
      const home = tempHomes.pop();
      if (home) {
        await rm(home, { recursive: true, force: true });
      }
    }
  });

  function createMockKimiChild() {
    const clientToAgent = new PassThrough();
    const agentToClient = new PassThrough();
    const stderr = new PassThrough();
    const child = Object.assign(new EventEmitter(), {
      stdin: clientToAgent,
      stdout: agentToClient,
      stderr,
      pid: undefined,
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      killed: false,
      kill: vi.fn(),
    });
    child.kill.mockImplementation(() => {
      child.killed = true;
      child.exitCode = 0;
      queueMicrotask(() => child.emit("exit", 0, null));
      return true;
    });
    return { child, clientToAgent, agentToClient };
  }

  function lastBackgroundWorkCount(events: AgentStreamEvent[]): number | undefined {
    const last = events.findLast((event) => event.type === "background_work_changed");
    return last?.type === "background_work_changed" ? last.count : undefined;
  }

  function countTurnCompleted(events: AgentStreamEvent[]): number {
    return events.filter((event) => event.type === "turn_completed").length;
  }

  function hasRunningToolCall(events: AgentStreamEvent[], callId: string): boolean {
    return events.some(
      (event) =>
        event.type === "timeline" &&
        event.item.type === "tool_call" &&
        event.item.callId === callId &&
        event.item.status === "running",
    );
  }

  async function createInProcessKimiFixture() {
    const home = await mkdtemp(join(tmpdir(), "paseo-kimi-monitor-"));
    tempHomes.push(home);
    const dataHome = join(home, "custom-kimi");
    const cwd = "/Users/test/Monet Core/";
    const sessionId = "session_test";
    const journalPath = join(
      dataHome,
      "sessions",
      "wd_monet-core_4fc67357f555",
      sessionId,
      "agents/main/wire.jsonl",
    );
    await mkdir(dirname(journalPath), { recursive: true });

    let promptHook: ((params: { sessionId: string }) => Promise<void>) | null = null;
    let activeChild:
      | (EventEmitter & {
          exitCode: number | null;
          signalCode: NodeJS.Signals | null;
        })
      | null = null;

    vi.spyOn(providerLaunchConfig, "resolveProviderLaunch").mockResolvedValue({
      command: "kimi",
      args: [],
    });
    vi.spyOn(providerLaunchConfig, "checkProviderLaunchAvailable").mockResolvedValue({
      available: true,
      resolvedPath: "/usr/local/bin/kimi",
    });

    vi.spyOn(spawnUtils, "spawnProcess").mockImplementation(() => {
      const { child, clientToAgent, agentToClient } = createMockKimiChild();
      activeChild = child;

      const stream = ndJsonStream(Writable.toWeb(agentToClient), Readable.toWeb(clientToAgent));
      let connection!: AgentSideConnection;
      connection = new AgentSideConnection(
        (): Agent => ({
          initialize: async () => ({
            protocolVersion: PROTOCOL_VERSION,
            agentCapabilities: {
              loadSession: true,
              sessionCapabilities: {},
            },
          }),
          authenticate: async () => ({}),
          newSession: async () => ({
            sessionId,
            configOptions: [],
          }),
          loadSession: async () => ({
            configOptions: [],
          }),
          setSessionMode: async () => ({}),
          setSessionConfigOption: async () => ({ configOptions: [] }),
          prompt: async (params) => {
            await promptHook?.({ sessionId: params.sessionId });
            await connection.sessionUpdate({
              sessionId: params.sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "Started background work." },
              },
            });
            return { stopReason: "end_turn" };
          },
          cancel: async () => {},
        }),
        stream,
      );

      return child as unknown as ChildProcessWithoutNullStreams;
    });

    const client = new KimiACPAgentClient({
      logger: createTestLogger(),
      command: ["kimi", "acp"],
      env: { HOME: home, KIMI_CODE_HOME: dataHome },
      providerId: "kimi",
      label: "Kimi Code CLI",
      journalPollIntervalMs: 15,
      backgroundZeroSettleMs: 25,
    });

    return {
      client,
      cwd,
      journalPath,
      emitChildExit: (code: number | null, signal: NodeJS.Signals | null = null) => {
        if (!activeChild) return;
        activeChild.exitCode = code;
        activeChild.signalCode = signal;
        activeChild.emit("exit", code, signal);
      },
      onPrompt: (handler: (params: { sessionId: string }) => Promise<void>) => {
        promptHook = handler;
      },
    };
  }

  test("keeps background tasks running across turn_completed and streams silent autonomous wakeup turns without dropping to zero", async () => {
    const { client, cwd, journalPath, onPrompt } = await createInProcessKimiFixture();
    expect(client.exclusiveSessionPersistence).toBe(true);
    const session = await client.createSession({ provider: "acp", cwd });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    try {
      onPrompt(async () => {
        const now = Date.now();
        await appendFile(
          journalPath,
          stringifyJournalRows([
            { type: "agent.turn.started", turnId: 0, time: now },
            {
              type: "turn.prompt",
              agentId: "main",
              turnId: 0,
              origin: { kind: "user" },
              time: now + 1,
            },
            {
              type: "context.append_loop_event",
              agentId: "main",
              event: {
                type: "content.part",
                uuid: "fg-msg",
                turnId: "0",
                part: { type: "text", text: "Started background work." },
              },
              time: now + 2,
            },
            {
              type: "task.started",
              agentId: "main",
              info: { taskId: "bash-1", status: "running", kind: "process" },
              time: now + 3,
            },
            { type: "agent.turn.ended", turnId: 0, outcome: "done", time: now + 4 },
            {
              type: "turn.ended",
              agentId: "main",
              turnId: 0,
              reason: "completed",
              time: now + 5,
            },
          ]),
        );
      });

      await session.run("run build in background");

      const firstTurnCompletedIndex = events.findIndex((event) => event.type === "turn_completed");
      const firstBgIndex = events.findIndex(
        (event) => event.type === "background_work_changed" && event.count === 1,
      );
      expect(firstBgIndex).toBeGreaterThanOrEqual(0);
      expect(firstBgIndex).toBeLessThan(firstTurnCompletedIndex);

      // Foreground text must come only from ACP stdout, never duplicated from wire.jsonl.
      const foregroundAssistantChunks = events.filter(
        (event) => event.type === "timeline" && event.item.type === "assistant_message",
      );
      expect(foregroundAssistantChunks).toHaveLength(1);

      // Background task 1 terminates and 7ms later Kimi starts an autonomous wakeup turn
      // that runs a shell tool, updates todos, spawns bash-2, and ends silently on ACP stdout.
      const wakeupAt = Date.now();
      await appendFile(
        journalPath,
        stringifyJournalRows([
          {
            type: "task.terminated",
            agentId: "main",
            info: { taskId: "bash-1", status: "completed" },
            time: wakeupAt,
          },
          { type: "agent.turn.started", turnId: 1, time: wakeupAt + 7 },
          {
            type: "turn.prompt",
            agentId: "main",
            turnId: 1,
            origin: { kind: "task" },
            time: wakeupAt + 8,
          },
          {
            type: "context.append_loop_event",
            agentId: "main",
            event: {
              type: "content.part",
              uuid: "auto-think-1",
              turnId: "1",
              part: { type: "think", think: "Checking build result." },
            },
            time: wakeupAt + 9,
          },
          {
            type: "context.append_loop_event",
            agentId: "main",
            event: {
              type: "tool.call",
              turnId: "1",
              toolCallId: "tool_auto_1",
              name: "Shell",
              args: { command: "npm run verify" },
            },
            time: wakeupAt + 10,
          },
          {
            type: "context.append_loop_event",
            agentId: "main",
            event: {
              type: "tool.result",
              turnId: "1",
              toolCallId: "tool_auto_1",
              result: { output: "verify ok", isError: false },
            },
            time: wakeupAt + 11,
          },
          {
            type: "context.append_loop_event",
            agentId: "main",
            event: {
              type: "tool.call",
              turnId: "1",
              toolCallId: "tool_todo_1",
              name: "TodoList",
              args: { todos: [{ title: "Ship fix", status: "completed" }] },
            },
            time: wakeupAt + 12,
          },
          {
            type: "context.append_loop_event",
            agentId: "main",
            event: {
              type: "content.part",
              uuid: "auto-msg-1",
              turnId: "1",
              part: { type: "text", text: "Started second verification task." },
            },
            time: wakeupAt + 13,
          },
          {
            type: "task.started",
            agentId: "main",
            info: { taskId: "bash-2", status: "running", kind: "agent" },
            time: wakeupAt + 14,
          },
          { type: "agent.turn.ended", turnId: 1, outcome: "done", time: wakeupAt + 15 },
          {
            type: "turn.ended",
            agentId: "main",
            turnId: 1,
            reason: "completed",
            time: wakeupAt + 16,
          },
        ]),
      );

      await vi.waitFor(() => {
        expect(countTurnCompleted(events)).toBe(2);
      });

      const turnStarts = events.filter((event) => event.type === "turn_started");
      expect(turnStarts).toHaveLength(2);
      const autonomousTurnId = turnStarts[1]?.turnId;
      expect(autonomousTurnId).toBeTruthy();

      // Any transient drop to 0 during the wakeup happens only AFTER autonomous turn_started,
      // and count returns to 1 BEFORE autonomous turn_completed.
      const autoStartIndex = events.findIndex(
        (event) => event.type === "turn_started" && event.turnId === autonomousTurnId,
      );
      const autoEndIndex = events.findIndex(
        (event) => event.type === "turn_completed" && event.turnId === autonomousTurnId,
      );
      const zeroBeforeAutoStart = events
        .slice(0, autoStartIndex)
        .some((event) => event.type === "background_work_changed" && event.count === 0);
      expect(zeroBeforeAutoStart).toBe(false);

      const lastBgBeforeAutoEnd = events
        .slice(0, autoEndIndex)
        .findLast((event) => event.type === "background_work_changed");
      expect(lastBgBeforeAutoEnd).toMatchObject({
        type: "background_work_changed",
        count: 1,
      });

      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "timeline",
            turnId: autonomousTurnId,
            item: { type: "reasoning", text: "Checking build result." },
          }),
          expect.objectContaining({
            type: "timeline",
            turnId: autonomousTurnId,
            item: expect.objectContaining({
              type: "tool_call",
              callId: "tool_auto_1",
              status: "completed",
              detail: { type: "shell", command: "npm run verify", output: "verify ok" },
            }),
          }),
          expect.objectContaining({
            type: "timeline",
            turnId: autonomousTurnId,
            item: { type: "todo", items: [{ text: "Ship fix", completed: true }] },
          }),
          expect.objectContaining({
            type: "timeline",
            turnId: autonomousTurnId,
            item: {
              type: "assistant_message",
              text: "Started second verification task.",
              messageId: "auto-msg-1",
            },
          }),
        ]),
      );

      // Once bash-2 terminates with no further turn, backgroundWorkCount settles to 0.
      await appendFile(
        journalPath,
        stringifyJournalRows([
          {
            type: "task.terminated",
            agentId: "main",
            info: { taskId: "bash-2", status: "completed" },
            time: wakeupAt + 50,
          },
        ]),
      );

      await vi.waitFor(() => {
        expect(lastBackgroundWorkCount(events)).toBe(0);
      });
    } finally {
      await session.close();
    }
  });

  test("delivers monitor events buffered before subscribe and tracks full compaction without opening a stuck autonomous turn", async () => {
    const { client, cwd, journalPath } = await createInProcessKimiFixture();
    const session = await client.createSession({ provider: "acp", cwd });

    try {
      const now = Date.now();
      await appendFile(
        journalPath,
        stringifyJournalRows([
          {
            type: "task.started",
            agentId: "main",
            info: { taskId: "early-task", status: "running", kind: "process" },
            time: now,
          },
        ]),
      );
      // Let the native session monitor poll while `session` still has zero subscribers,
      // matching AgentManager's `listCommands()` / `persistSnapshot()` window before subscribe.
      await new Promise((resolve) => setTimeout(resolve, 45));

      const events: AgentStreamEvent[] = [];
      session.subscribe((event) => events.push(event));

      expect(events[0]).toMatchObject({ type: "thread_started", sessionId: "session_test" });
      expect(events[1]).toMatchObject({ type: "background_work_changed", count: 1 });

      await appendFile(
        journalPath,
        stringifyJournalRows([
          {
            type: "task.terminated",
            agentId: "main",
            info: { taskId: "early-task", status: "completed" },
            time: now + 50,
          },
          {
            type: "goal.create",
            agentId: "main",
            goalId: "paused-goal",
            status: "paused",
            time: now + 55,
          },
        ]),
      );

      await vi.waitFor(() => {
        expect(lastBackgroundWorkCount(events)).toBe(0);
      });

      await appendFile(
        journalPath,
        stringifyJournalRows([
          { type: "full_compaction.begin", source: "manual", agentId: "main", time: now + 100 },
          { type: "llm.request", agentId: "main", time: now + 105 },
          { type: "usage.record", agentId: "main", time: now + 110 },
          { type: "context.apply_compaction", agentId: "main", time: now + 115 },
        ]),
      );

      await vi.waitFor(() => {
        expect(lastBackgroundWorkCount(events)).toBe(1);
      });
      expect(events.filter((event) => event.type === "turn_started")).toEqual([]);

      await appendFile(
        journalPath,
        stringifyJournalRows([
          { type: "full_compaction.complete", agentId: "main", time: now + 120 },
        ]),
      );

      await vi.waitFor(() => {
        expect(lastBackgroundWorkCount(events)).toBe(0);
      });
    } finally {
      await session.close();
    }
  });

  test("tracks active /goal loops as background work until paused or cleared", async () => {
    const { client, cwd, journalPath } = await createInProcessKimiFixture();
    const session = await client.createSession({ provider: "acp", cwd });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    try {
      const now = Date.now();
      await appendFile(
        journalPath,
        stringifyJournalRows([
          { type: "goal.create", agentId: "main", goalId: "goal-1", time: now },
          { type: "goal.update", agentId: "main", turnsUsed: 1, time: now + 1 },
        ]),
      );

      await vi.waitFor(() => {
        expect(lastBackgroundWorkCount(events)).toBe(1);
      });

      await appendFile(
        journalPath,
        stringifyJournalRows([
          { type: "goal.update", agentId: "main", status: "paused", time: now + 20 },
        ]),
      );

      await vi.waitFor(() => {
        expect(lastBackgroundWorkCount(events)).toBe(0);
      });
    } finally {
      await session.close();
    }
  });

  test("ignores orphaned tasks before session resume and clears live background work or autonomous turns on unexpected exit", async () => {
    const { client, cwd, journalPath, emitChildExit } = await createInProcessKimiFixture();
    await writeFile(
      journalPath,
      stringifyJournalRows([
        {
          type: "task.started",
          agentId: "main",
          info: { taskId: "stale-task", status: "running", kind: "process" },
          time: Date.now() - 10_000,
        },
      ]),
    );

    const session = await client.resumeSession({
      provider: "acp",
      sessionId: "session_test",
      nativeHandle: "session_test",
      metadata: { cwd },
    });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    try {
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(events.filter((event) => event.type === "background_work_changed")).toEqual([]);

      const now = Date.now();
      await appendFile(
        journalPath,
        stringifyJournalRows([
          {
            type: "task.started",
            agentId: "main",
            info: { taskId: "live-task", status: "running", kind: "process" },
            time: now,
          },
          { type: "agent.turn.started", turnId: 4, time: now + 1 },
          {
            type: "context.append_loop_event",
            agentId: "main",
            event: {
              type: "tool.call",
              turnId: "4",
              toolCallId: "tool_live_1",
              name: "Shell",
              args: { command: "sleep 30" },
            },
            time: now + 2,
          },
        ]),
      );

      await vi.waitFor(() => {
        expect(hasRunningToolCall(events, "tool_live_1")).toBe(true);
      });

      emitChildExit(1);

      expect(
        events
          .filter((event) => event.type === "background_work_changed")
          .map((event) => event.count),
      ).toEqual([1, 0]);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "timeline",
            item: expect.objectContaining({
              type: "tool_call",
              callId: "tool_live_1",
              status: "canceled",
            }),
          }),
          expect.objectContaining({
            type: "turn_failed",
            error: "ACP agent exited unexpectedly (1)",
          }),
        ]),
      );
    } finally {
      await session.close();
    }
  });
});
