import { readFileSync } from "node:fs";
import { AGENT_HOOK_PROVIDERS } from "@getpaseo/server/agent-hooks";
import { describe, expect, it } from "vitest";
import { runHooksCommand } from "./hooks.js";

const hookEnv = {
  PASEO_TERMINAL_ID: "terminal-1",
  PASEO_ACTIVITY_TOKEN: "token-1",
  PASEO_TERMINAL_ACTIVITY_URL: "http://127.0.0.1:6767/api/terminal-activity",
};

function inputFrom(value: string) {
  return {
    async *[Symbol.asyncIterator]() {
      yield value;
    },
  };
}

function ttyInput() {
  return {
    isTTY: true,
    async *[Symbol.asyncIterator]() {},
  };
}

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

interface RecordingFetch {
  send: typeof fetch;
  calls: FetchCall[];
}

const claudeProvider = AGENT_HOOK_PROVIDERS.claude;
const codexProvider = AGENT_HOOK_PROVIDERS.codex;
const opencodeProvider = AGENT_HOOK_PROVIDERS.opencode;

function createFetch(): RecordingFetch {
  const calls: FetchCall[] = [];
  const send = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return { ok: true } as Response;
  }) as typeof fetch;
  return { send, calls };
}

async function runHook(agent: string, event: string, input = ttyInput()) {
  const fetch = createFetch();
  await runHooksCommand(agent, event, {
    env: hookEnv,
    input,
    fetch: fetch.send,
  });
  return fetch;
}

function expectPostedState(fetch: RecordingFetch, state: string, sessionId?: string) {
  expect(fetch.calls).toEqual([
    {
      url: hookEnv.PASEO_TERMINAL_ACTIVITY_URL,
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalId: hookEnv.PASEO_TERMINAL_ID,
          token: hookEnv.PASEO_ACTIVITY_TOKEN,
          state,
          sessionId,
        }),
        signal: expect.any(AbortSignal),
      },
    },
  ]);
}

describe("runHooksCommand", () => {
  it("keeps provider names out of the generic command", () => {
    const source = readFileSync(new URL("./hooks.ts", import.meta.url), "utf8").toLowerCase();

    for (const providerId of Object.keys(AGENT_HOOK_PROVIDERS)) {
      expect(source).not.toContain(providerId);
    }
  });

  it.each([
    ["UserPromptSubmit", "running"],
    ["Stop", "idle"],
    ["StopFailure", "idle"],
  ])("maps Claude %s to %s", async (event, state) => {
    const send = await runHook(claudeProvider.id, event);

    expectPostedState(send, state);
  });

  it("ignores Claude SessionEnd", async () => {
    const send = await runHook(claudeProvider.id, "SessionEnd", inputFrom("{}"));

    expect(send.calls).toEqual([]);
  });

  it("keeps a Claude turn running while a background task runs", async () => {
    const running = await runHook(
      claudeProvider.id,
      "Stop",
      inputFrom(JSON.stringify({ background_tasks: [{ type: "shell", status: "running" }] })),
    );
    const finished = await runHook(
      claudeProvider.id,
      "Stop",
      inputFrom(JSON.stringify({ background_tasks: [{ type: "shell", status: "completed" }] })),
    );

    expectPostedState(running, "running");
    expectPostedState(finished, "idle");
  });

  it.each([
    ["rate_limit", "quota"],
    ["billing_error", "quota"],
    ["server_error", "idle"],
  ])("maps Claude StopFailure %s to %s", async (error, state) => {
    const send = await runHook(
      claudeProvider.id,
      "StopFailure",
      inputFrom(JSON.stringify({ error })),
    );

    expectPostedState(send, state);
  });

  it("posts the agent session id from the hook payload", async () => {
    const claude = await runHook(
      claudeProvider.id,
      "UserPromptSubmit",
      inputFrom(JSON.stringify({ session_id: "claude-session", prompt: "hi" })),
    );
    const codex = await runHook(
      codexProvider.id,
      "Stop",
      inputFrom(JSON.stringify({ session_id: "codex-session" })),
    );

    expectPostedState(claude, "running", "claude-session");
    expectPostedState(codex, "idle", "codex-session");
  });

  it.each([
    ["UserPromptSubmit", "running"],
    ["PreToolUse", "running"],
    ["PostToolUse", "running"],
    ["PermissionRequest", "needs-input"],
    ["Stop", "idle"],
  ])("maps Codex %s to %s", async (event, state) => {
    const send = await runHook(codexProvider.id, event);

    expectPostedState(send, state);
  });

  it.each([
    ["session.status.busy", "running"],
    ["session.status.retry", "running"],
    ["session.status.idle", "idle"],
    ["permission.asked", "needs-input"],
    ["permission.replied", "running"],
  ])("maps OpenCode %s to %s", async (event, state) => {
    const send = await runHook(opencodeProvider.id, event);

    expectPostedState(send, state);
  });

  it.each([
    "permission_prompt",
    "elicitation_dialog",
    "elicitation_url_dialog",
    "worker_permission_prompt",
    "agent_needs_input",
  ])("maps Claude %s notifications to needs-input", async (notificationType) => {
    const send = await runHook(
      claudeProvider.id,
      "Notification",
      inputFrom(JSON.stringify({ notification_type: notificationType })),
    );

    expectPostedState(send, "needs-input");
  });

  it.each(["idle_prompt", "auth_success", "elicitation_response", "agent_completed"])(
    "ignores Claude %s notifications",
    async (notificationType) => {
      const send = await runHook(
        claudeProvider.id,
        "Notification",
        inputFrom(JSON.stringify({ notification_type: notificationType })),
      );

      expect(send.calls).toEqual([]);
    },
  );

  it("does nothing when terminal activity env is missing", async () => {
    const fetch = createFetch();

    await runHooksCommand(claudeProvider.id, claudeProvider.events[0].event, {
      env: {},
      input: ttyInput(),
      fetch: fetch.send,
    });

    expect(fetch.calls).toEqual([]);
  });

  it("does nothing for unknown agents and events", async () => {
    const unknownAgent = await runHook("unknown-provider", claudeProvider.events[0].event);
    const unknownEvent = await runHook(claudeProvider.id, "UnknownEvent");

    expect(unknownAgent.calls).toEqual([]);
    expect(unknownEvent.calls).toEqual([]);
  });

  it("does not throw when the daemon post fails", async () => {
    const send = (async () => {
      throw new Error("daemon down");
    }) as typeof fetch;

    await expect(
      runHooksCommand(claudeProvider.id, claudeProvider.events[0].event, {
        env: hookEnv,
        input: ttyInput(),
        fetch: send,
      }),
    ).resolves.toBeUndefined();
  });
});
