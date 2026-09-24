import { Command } from "commander";
import { resolveHookActivity, type AgentHookActivityState } from "@getpaseo/server/agent-hooks";

interface HookEnvironment {
  PASEO_TERMINAL_ID?: string;
  PASEO_ACTIVITY_TOKEN?: string;
  PASEO_TERMINAL_ACTIVITY_URL?: string;
}

interface HookInput {
  [Symbol.asyncIterator](): AsyncIterator<string | Buffer>;
  isTTY?: boolean;
}

interface HooksRuntime {
  env: HookEnvironment;
  input: HookInput;
  fetch: typeof fetch;
}

export function createHooksCommand(): Command {
  return new Command("hooks")
    .description("Record agent hook activity")
    .argument("<agent>", "Agent hook source")
    .argument("<event>", "Agent hook event")
    .action((agent: string, event: string) => runHooksCommand(agent, event));
}

export async function runHooksCommand(
  agent: string,
  event: string,
  runtime: HooksRuntime = {
    env: process.env,
    input: process.stdin,
    fetch,
  },
): Promise<void> {
  const target = resolveTarget(runtime.env);
  if (!target) return;

  // Read stdin once: the provider maps the payload and the post carries its session id.
  // Never write to stdout; agents inject a hook's stdout into the model's context.
  const raw = runtime.input.isTTY ? null : await readInput(runtime.input);
  const state = await resolveHookActivity({
    provider: agent,
    event,
    input: {
      isTTY: runtime.input.isTTY,
      read: async () => raw,
    },
  });
  if (!state) return;

  await postActivity(target, state, readSessionId(raw), runtime.fetch);
}

function readSessionId(raw: string | null): string | undefined {
  if (!raw) return undefined;
  try {
    const payload = JSON.parse(raw) as { session_id?: unknown } | null;
    return typeof payload?.session_id === "string" && payload.session_id
      ? payload.session_id
      : undefined;
  } catch {
    return undefined;
  }
}

function resolveTarget(env: HookEnvironment) {
  const terminalId = env.PASEO_TERMINAL_ID;
  const token = env.PASEO_ACTIVITY_TOKEN;
  const url = env.PASEO_TERMINAL_ACTIVITY_URL;

  if (!terminalId || !token || !url) return null;
  return { terminalId, token, url };
}

async function readInput(input: HookInput): Promise<string | null> {
  const iterator = input[Symbol.asyncIterator]();
  const chunks: string[] = [];

  while (true) {
    const next = await withTimeout(iterator.next(), 100);
    if (!next) {
      await iterator.return?.();
      return null;
    }
    if (next.done) return chunks.join("");
    chunks.push(String(next.value));
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function postActivity(
  target: { terminalId: string; token: string; url: string },
  state: AgentHookActivityState,
  sessionId: string | undefined,
  send: typeof fetch,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);

  try {
    await send(target.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        terminalId: target.terminalId,
        token: target.token,
        state,
        sessionId,
      }),
      signal: controller.signal,
    });
  } catch {
    return;
  } finally {
    clearTimeout(timeout);
  }
}
