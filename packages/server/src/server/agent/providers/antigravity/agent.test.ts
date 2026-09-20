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
});
