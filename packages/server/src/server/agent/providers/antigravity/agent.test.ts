import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { describe, expect, it } from "vitest";
import type { AgentStreamEvent } from "../../agent-sdk-types.js";
import { AntigravityAgentClient, parseAgyModelsOutput } from "./agent.js";
import { AntigravityStreamDecoder } from "./stream-decoder.js";

describe("parseAgyModelsOutput", () => {
  it("parses tab-separated agy models output", () => {
    const output = [
      "Fetching available models...",
      "gemini-3.8-flash-high\tGemini 3.8 Flash (High)",
      "gemini-3.7-flash-high\tGemini 3.7 Flash (High)",
      "claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)",
    ].join("\n");

    const models = parseAgyModelsOutput(output);
    expect(models).toHaveLength(3);
    expect(models[0]).toEqual({
      provider: "antigravity",
      id: "gemini-3.8-flash-high",
      label: "Gemini 3.8 Flash (High)",
      isDefault: true,
    });
    expect(models[1]).toEqual({
      provider: "antigravity",
      id: "gemini-3.7-flash-high",
      label: "Gemini 3.7 Flash (High)",
      isDefault: false,
    });
    expect(models[2]).toEqual({
      provider: "antigravity",
      id: "claude-sonnet-4-6",
      label: "Claude Sonnet 4.6 (Thinking)",
      isDefault: false,
    });
  });

  it("handles whitespace-separated model output", () => {
    const output = "gemini-3.1-pro-high     Gemini 3.1 Pro (High)";
    const models = parseAgyModelsOutput(output);
    expect(models).toHaveLength(1);
    expect(models[0]).toEqual({
      provider: "antigravity",
      id: "gemini-3.1-pro-high",
      label: "Gemini 3.1 Pro (High)",
      isDefault: false,
    });
  });
});

describe("AntigravityStreamDecoder", () => {
  it("decodes init event and notifies conversation ID", () => {
    const events: AgentStreamEvent[] = [];
    let capturedId = "";
    const decoder = new AntigravityStreamDecoder(
      "antigravity",
      (event) => events.push(event),
      (id) => {
        capturedId = id;
      },
    );

    decoder.write(
      JSON.stringify({
        event: "init",
        conversation_id: "conv-1234",
        init: { cwd: "/path/to/project", tools: ["run_command"] },
      }) + "\n",
    );

    expect(capturedId).toBe("conv-1234");
    expect(events).toEqual([
      {
        type: "thread_started",
        sessionId: "conv-1234",
        provider: "antigravity",
      },
    ]);
  });

  it("decodes step updates and streams assistant text deltas", () => {
    const events: AgentStreamEvent[] = [];
    const decoder = new AntigravityStreamDecoder("antigravity", (event) => events.push(event));

    decoder.write(
      JSON.stringify({
        event: "step_update",
        step_update: {
          conversation_id: "conv-1",
          step_index: 1,
          state: "DONE",
          step_type: "agent_response",
          text_delta: "Hello there!",
        },
      }) + "\n",
      "turn-1",
    );

    expect(events).toEqual([
      {
        type: "timeline",
        item: {
          type: "assistant_message",
          text: "Hello there!",
        },
        provider: "antigravity",
        turnId: "turn-1",
      },
    ]);
  });

  it("decodes result success event with usage", () => {
    const events: AgentStreamEvent[] = [];
    const decoder = new AntigravityStreamDecoder("antigravity", (event) => events.push(event));

    decoder.write(
      JSON.stringify({
        event: "result",
        result: {
          conversation_id: "conv-1",
          status: "SUCCESS",
          response: "All done!",
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            thinking_tokens: 5,
            cache_read_tokens: 0,
            total_tokens: 125,
          },
        },
      }) + "\n",
      "turn-1",
    );

    expect(events).toContainEqual({
      type: "timeline",
      item: {
        type: "assistant_message",
        text: "All done!",
      },
      provider: "antigravity",
      turnId: "turn-1",
    });

    expect(events).toContainEqual({
      type: "turn_completed",
      provider: "antigravity",
      usage: {
        inputTokens: 100,
        cachedInputTokens: 0,
        outputTokens: 20,
      },
      turnId: "turn-1",
    });
  });

  it("decodes result error event", () => {
    const events: AgentStreamEvent[] = [];
    const decoder = new AntigravityStreamDecoder("antigravity", (event) => events.push(event));

    decoder.write(
      JSON.stringify({
        event: "result",
        result: {
          conversation_id: "conv-1",
          status: "ERROR",
          response: "",
          error: "API rate limit reached",
        },
      }) + "\n",
      "turn-1",
    );

    expect(events).toEqual([
      {
        type: "turn_failed",
        provider: "antigravity",
        error: "API rate limit reached",
        turnId: "turn-1",
      },
    ]);
  });
});

describe("AntigravityAgentClient", () => {
  it("exposes the expected provider identity and capability flags", () => {
    const logger = pino({ level: "silent" });
    const client = new AntigravityAgentClient({ logger });

    expect(client.provider).toBe("antigravity");
    expect(client.capabilities.supportsStreaming).toBe(true);
    expect(client.capabilities.supportsSessionPersistence).toBe(true);
    expect(client.capabilities.supportsDynamicModes).toBe(true);
  });

  it("returns fallback catalog models when agy models cannot be executed", async () => {
    const logger = pino({ level: "silent" });
    const client = new AntigravityAgentClient({
      logger,
      runtimeSettings: {
        command: {
          mode: "replace",
          argv: ["non_existent_binary_xyz_123"],
        },
      },
    });

    const catalog = await client.fetchCatalog({ scope: "global" });
    expect(catalog.models.length).toBeGreaterThan(0);
    expect(catalog.models.some((m) => m.id === "gemini-3.8-flash-high" && m.isDefault)).toBe(true);
    expect(catalog.modes.some((m) => m.id === "accept-edits")).toBe(true);
    expect(catalog.modes.some((m) => m.id === "bypass")).toBe(true);
  });

  it("creates a session and manages modes and models", async () => {
    const logger = pino({ level: "silent" });
    const client = new AntigravityAgentClient({ logger });
    const session = await client.createSession({
      cwd: "/tmp",
      provider: "antigravity",
      modeId: "accept-edits",
      model: "gemini-3.8-flash-high",
    });

    expect(session.provider).toBe("antigravity");
    expect(await session.getCurrentMode()).toBe("accept-edits");
    const modes = await session.getAvailableModes();
    expect(modes.map((m) => m.id)).toEqual(["plan", "default", "accept-edits", "bypass"]);

    await session.setMode("plan");
    expect(await session.getCurrentMode()).toBe("plan");

    await session.setModel("gemini-3.7-flash-high");
    const info = await session.getRuntimeInfo();
    expect(info.model).toBe("gemini-3.7-flash-high");

    await session.close();
  });

  it("handles persistence description and session resumption", async () => {
    const logger = pino({ level: "silent" });
    const client = new AntigravityAgentClient({ logger });
    const session = await client.resumeSession(
      {
        provider: "antigravity",
        sessionId: "conv-saved-456",
        nativeHandle: "conv-saved-456",
      },
      {
        cwd: "/tmp",
        provider: "antigravity",
      },
    );

    expect(session.id).toBe("conv-saved-456");
    expect(session.describePersistence()).toEqual({
      provider: "antigravity",
      sessionId: "conv-saved-456",
      nativeHandle: "conv-saved-456",
    });

    await session.close();
  });

  it("produces provider diagnostics report", async () => {
    const logger = pino({ level: "silent" });
    const client = new AntigravityAgentClient({ logger });
    const diagnostic = await client.getDiagnostic();
    expect(diagnostic.diagnostic).toContain("Antigravity");
    expect(diagnostic.diagnostic).toContain("Configured command: agy");
  });

  it("executes a turn end-to-end through a mock agy CLI process", async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "agy-mock-"));
    const mockScript = path.join(tmpDir, "mock-agy.cjs");
    writeFileSync(
      mockScript,
      `
      process.stdin.setEncoding("utf8");
      process.stdout.write(JSON.stringify({
        event: "init",
        conversation_id: "conv-test-999",
        init: { cwd: process.cwd(), tools: [] }
      }) + "\\n");

      let buffer = "";
      process.stdin.on("data", (chunk) => {
        buffer += chunk;
        if (buffer.includes("\\n")) {
          process.stdout.write(JSON.stringify({
            event: "step_update",
            step_update: {
              conversation_id: "conv-test-999",
              step_index: 1,
              state: "DONE",
              step_type: "agent_response",
              text_delta: "Mock response from Antigravity"
            }
          }) + "\\n");
          process.stdout.write(JSON.stringify({
            event: "result",
            result: {
              conversation_id: "conv-test-999",
              status: "SUCCESS",
              response: "Mock response from Antigravity",
              usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
            }
          }) + "\\n");
        }
      });
      `,
    );

    try {
      const logger = pino({ level: "silent" });
      const client = new AntigravityAgentClient({
        logger,
        runtimeSettings: {
          command: {
            mode: "replace",
            argv: [process.execPath, mockScript],
          },
        },
      });

      const session = await client.createSession({
        cwd: tmpDir,
        provider: "antigravity",
        modeId: "accept-edits",
        model: "gemini-3.8-flash-high",
      });

      const events: AgentStreamEvent[] = [];
      session.subscribe((event) => events.push(event));

      const result = await session.run("Hello test");
      expect(result.sessionId).toBe("conv-test-999");
      expect(result.finalText).toBe("Mock response from Antigravity");
      expect(session.id).toBe("conv-test-999");

      const timelineEvent = events.find((e) => e.type === "timeline");
      expect(timelineEvent).toMatchObject({
        type: "timeline",
        item: {
          type: "assistant_message",
          text: "Mock response from Antigravity",
        },
      });

      const completedEvent = events.find((e) => e.type === "turn_completed");
      expect(completedEvent).toBeDefined();

      await session.close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
