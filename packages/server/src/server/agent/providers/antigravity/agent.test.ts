import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { describe, expect, it } from "vitest";
import type { AgentStreamEvent } from "../../agent-sdk-types.js";
import { AntigravityAgentClient, buildAgySpawnArgs, parseAgyModelsOutput } from "./agent.js";
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

  it("handles spinner frames and carriage returns in model output", () => {
    const output =
      "⠋ Fetching available models...\r⠙ Fetching available models...\rgemini-3.8-flash-high\tGemini 3.8 Flash (High)\n" +
      "gemini-3.7-flash-high\tGemini 3.7 Flash (High)\n";
    const models = parseAgyModelsOutput(output);
    expect(models).toHaveLength(2);
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

  it("decodes step updates and streams assistant text deltas with stable messageId", () => {
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
          messageId: "turn-1-1",
        },
        provider: "antigravity",
        turnId: "turn-1",
      },
    ]);
  });

  it("decodes thinking and reasoning deltas", () => {
    const events: AgentStreamEvent[] = [];
    const decoder = new AntigravityStreamDecoder("antigravity", (event) => events.push(event));

    decoder.write(
      JSON.stringify({
        event: "step_update",
        step_update: {
          conversation_id: "conv-1",
          step_index: 1,
          state: "RUNNING",
          step_type: "agent_response",
          thinking_delta: "Analyzing the codebase architecture...",
        },
      }) + "\n",
      "turn-1",
    );

    expect(events).toEqual([
      {
        type: "timeline",
        item: {
          type: "reasoning",
          text: "Analyzing the codebase architecture...",
        },
        provider: "antigravity",
        turnId: "turn-1",
      },
    ]);
  });

  it("decodes tool execution lifecycle: active and completed with command detail", () => {
    const events: AgentStreamEvent[] = [];
    const decoder = new AntigravityStreamDecoder("antigravity", (event) => events.push(event));

    decoder.write(
      JSON.stringify({
        event: "step_update",
        step_update: {
          conversation_id: "conv-1",
          step_index: 2,
          state: "ACTIVE",
          step_type: "tool",
          tool_name: "run_command",
          tool_info: {
            name: "run_command",
            parameters: { CommandLine: "pwd" },
          },
        },
      }) + "\n",
      "turn-1",
    );

    expect(events[0]).toEqual({
      type: "timeline",
      item: {
        type: "tool_call",
        callId: "2",
        name: "run_command",
        status: "running",
        error: null,
        detail: {
          type: "shell",
          command: "pwd",
          output: undefined,
        },
      },
      provider: "antigravity",
      turnId: "turn-1",
    });

    decoder.write(
      JSON.stringify({
        event: "step_update",
        step_update: {
          conversation_id: "conv-1",
          step_index: 2,
          state: "DONE",
          step_type: "tool",
          tool_name: "run_command",
          tool_info: {
            name: "run_command",
            parameters: { CommandLine: "pwd" },
            output: "/Users/test/workspace\n",
          },
        },
      }) + "\n",
      "turn-1",
    );

    expect(events[1]).toEqual({
      type: "timeline",
      item: {
        type: "tool_call",
        callId: "2",
        name: "run_command",
        status: "completed",
        error: null,
        detail: {
          type: "shell",
          command: "pwd",
          output: "/Users/test/workspace\n",
        },
      },
      provider: "antigravity",
      turnId: "turn-1",
    });
  });

  it("decodes tool execution failure with error message", () => {
    const events: AgentStreamEvent[] = [];
    const decoder = new AntigravityStreamDecoder("antigravity", (event) => events.push(event));

    decoder.write(
      JSON.stringify({
        event: "step_update",
        step_update: {
          conversation_id: "conv-1",
          step_index: 2,
          state: "ERROR",
          step_type: "tool",
          tool_name: "run_command",
          tool_info: {
            name: "run_command",
            parameters: { CommandLine: "rm -rf /" },
            error: {
              type: "TOOL_ERROR",
              message: "permission denied for dangerous command",
            },
          },
        },
      }) + "\n",
      "turn-1",
    );

    expect(events[0]).toEqual({
      type: "timeline",
      item: {
        type: "tool_call",
        callId: "2",
        name: "run_command",
        status: "failed",
        error: "permission denied for dangerous command",
        detail: {
          type: "shell",
          command: "rm -rf /",
          output: undefined,
        },
      },
      provider: "antigravity",
      turnId: "turn-1",
    });
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

  it("completes a turn whose only error is an API failure agy already retried", () => {
    const events: AgentStreamEvent[] = [];
    const decoder = new AntigravityStreamDecoder("antigravity", (event) => events.push(event));

    // agy logged "Run: attempt 1 failed (INTERNAL (code 500) …), retrying in 4s", finished the
    // turn, and still reported the retry notice on this and later turns' results.
    decoder.write(
      JSON.stringify({
        event: "result",
        result: {
          conversation_id: "conv-1",
          status: "ERROR",
          response: "The Golf GTI 2019 watcher is active.",
          error: "API error (attempt 1): INTERNAL (code 500): Internal error encountered.",
        },
      }) + "\n",
      "turn-1",
    );

    expect(events.map((event) => event.type)).toEqual(["timeline", "turn_completed"]);
  });

  it("still fails a retried API error when the turn delivered no response", () => {
    const events: AgentStreamEvent[] = [];
    const decoder = new AntigravityStreamDecoder("antigravity", (event) => events.push(event));

    decoder.write(
      JSON.stringify({
        event: "result",
        result: {
          conversation_id: "conv-1",
          status: "ERROR",
          response: "",
          error: "API error (attempt 5): INTERNAL (code 500): Internal error encountered.",
        },
      }) + "\n",
      "turn-1",
    );

    expect(events).toEqual([
      {
        type: "turn_failed",
        provider: "antigravity",
        error: "API error (attempt 5): INTERNAL (code 500): Internal error encountered.",
        turnId: "turn-1",
      },
    ]);
  });

  it("surfaces denied_actions as permission cards and cancels interrupted turns", () => {
    const events: AgentStreamEvent[] = [];
    const decoder = new AntigravityStreamDecoder("antigravity", (event) => events.push(event));

    decoder.write(
      JSON.stringify({
        event: "result",
        result: {
          conversation_id: "conv-1",
          status: "INTERRUPTED",
          response: "",
          error: "Interrupted by user",
          denied_actions: [{ action: "command(ls)", display_name: "Run ls" }],
        },
      }) + "\n",
      "turn-1",
    );

    expect(events).toContainEqual({
      type: "permission_requested",
      provider: "antigravity",
      turnId: "turn-1",
      request: {
        id: "agy-denied-turn-1-0",
        provider: "antigravity",
        name: "command(ls)",
        kind: "tool",
        title: "Run ls",
        description:
          "Antigravity denied this tool in headless mode. Allow switches this session to Bypass so the next turn can run it.",
        actions: [
          { id: "bypass", label: "Bypass", behavior: "allow", variant: "danger" },
          { id: "dismiss", label: "Dismiss", behavior: "deny", variant: "secondary" },
        ],
      },
    });
    expect(events).toContainEqual({
      type: "turn_canceled",
      provider: "antigravity",
      reason: "Interrupted by user",
      turnId: "turn-1",
    });
  });
});

describe("AntigravityAgentClient", () => {
  it("exposes the expected provider identity and capability flags", () => {
    const logger = pino({ level: "silent" });
    const client = new AntigravityAgentClient({ logger });

    expect(client.provider).toBe("antigravity");
    expect(client.capabilities.supportsStreaming).toBe(true);
    expect(client.capabilities.supportsSessionPersistence).toBe(true);
    expect(client.capabilities.supportsSessionListing).toBe(true);
    expect(client.capabilities.supportsDynamicModes).toBe(true);
    expect(client.capabilities.supportsMcpServers).toBe(true);
  });

  it("builds spawn args for effort, sandbox, extra dirs, and bypass", () => {
    expect(
      buildAgySpawnArgs({
        launchArgs: [],
        modelId: "gemini-3.8-flash-high",
        modeId: "bypass",
        conversationId: "conv-1",
        effort: "high",
        sandbox: true,
        agent: "reviewer",
        addDir: ["/tmp/extra"],
      }),
    ).toEqual([
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--model",
      "gemini-3.8-flash-high",
      "--dangerously-skip-permissions",
      "--effort",
      "high",
      "--sandbox",
      "--agent",
      "reviewer",
      "--add-dir",
      "/tmp/extra",
      "--conversation",
      "conv-1",
    ]);
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
    expect(catalog.models[0]?.thinkingOptions?.map((option) => option.id)).toEqual([
      "low",
      "medium",
      "high",
    ]);
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

  it("tracks denied_actions and switches to Bypass when the user allows", async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "agy-denied-"));
    const mockScript = path.join(tmpDir, "mock-agy.cjs");
    writeFileSync(
      mockScript,
      `
      process.stdin.setEncoding("utf8");
      process.stdout.write(JSON.stringify({
        event: "init",
        conversation_id: "conv-denied",
        init: { cwd: process.cwd(), tools: [], permission_mode: "request-review" }
      }) + "\\n");
      let buffer = "";
      process.stdin.on("data", (chunk) => {
        buffer += chunk;
        if (buffer.includes("\\n")) {
          process.stdout.write(JSON.stringify({
            event: "result",
            result: {
              conversation_id: "conv-denied",
              status: "SUCCESS",
              response: "I could not run that command.",
              denied_actions: [{ action: "command(ls)", display_name: "Run ls" }]
            }
          }) + "\\n");
        }
      });
      `,
    );

    try {
      const client = new AntigravityAgentClient({
        logger: pino({ level: "silent" }),
        runtimeSettings: {
          command: { mode: "replace", argv: [process.execPath, mockScript] },
        },
      });
      const session = await client.createSession({
        cwd: tmpDir,
        provider: "antigravity",
        modeId: "default",
      });
      await session.run("list files");
      const pending = session.getPendingPermissions();
      expect(pending).toHaveLength(1);
      expect(pending[0]?.name).toBe("command(ls)");
      await session.respondToPermission(pending[0]!.id, { behavior: "allow" });
      expect(await session.getCurrentMode()).toBe("bypass");
      expect(session.getPendingPermissions()).toEqual([]);
      await session.close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("replays transcript history for a resumed conversation", async () => {
    const homeDir = mkdtempSync(path.join(tmpdir(), "agy-home-"));
    const conversationId = "conv-history";
    const transcriptDir = path.join(
      homeDir,
      ".gemini",
      "antigravity-cli",
      "brain",
      conversationId,
      ".system_generated",
      "logs",
    );
    mkdirSync(transcriptDir, { recursive: true });
    writeFileSync(
      path.join(transcriptDir, "transcript.jsonl"),
      `${JSON.stringify({
        step_index: 0,
        type: "USER_INPUT",
        content: "<USER_REQUEST>\nHello history\n</USER_REQUEST>",
      })}\n${JSON.stringify({
        step_index: 1,
        type: "PLANNER_RESPONSE",
        content: "Hello back",
      })}\n`,
    );
    const mockScript = path.join(homeDir, "mock-agy.cjs");
    writeFileSync(mockScript, "process.stdin.resume();\n");

    try {
      const client = new AntigravityAgentClient({
        logger: pino({ level: "silent" }),
        homeDir,
        runtimeSettings: {
          command: { mode: "replace", argv: [process.execPath, mockScript] },
        },
      });
      const session = await client.resumeSession({
        provider: "antigravity",
        sessionId: conversationId,
        nativeHandle: conversationId,
      });
      const events: AgentStreamEvent[] = [];
      for await (const event of session.streamHistory()) {
        events.push(event);
      }
      expect(events).toMatchObject([
        { type: "timeline", item: { type: "user_message", text: "Hello history" } },
        { type: "timeline", item: { type: "assistant_message", text: "Hello back" } },
      ]);
      await session.close();
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("writes injected MCP servers into the workspace overlay for the session", async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "agy-mcp-session-"));
    const mockScript = path.join(tmpDir, "mock-agy.cjs");
    writeFileSync(mockScript, "process.stdin.resume();\n");
    try {
      const client = new AntigravityAgentClient({
        logger: pino({ level: "silent" }),
        runtimeSettings: {
          command: { mode: "replace", argv: [process.execPath, mockScript] },
        },
      });
      const session = await client.createSession({
        cwd: tmpDir,
        provider: "antigravity",
        mcpServers: { paseo: { type: "http", url: "http://127.0.0.1:9/mcp" } },
      });
      const written = JSON.parse(
        readFileSync(path.join(tmpDir, ".agents", "mcp_config.json"), "utf8"),
      );
      expect(written.mcpServers.paseo).toEqual({ serverUrl: "http://127.0.0.1:9/mcp" });
      await session.close();
      expect(() => readFileSync(path.join(tmpDir, ".agents", "mcp_config.json"))).toThrow();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
