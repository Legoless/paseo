import { createHash } from "node:crypto";
import {
  negotiateProviderCapabilities,
  requireProviderCapabilities,
  type ProviderCatalog,
  type ProviderConnection,
  type ProviderEvent,
  type ProviderInput,
  type ProviderLaunch,
  type ProviderRegistration,
} from "@getpaseo/plugin/server/provider";
import {
  fallbackCatalog,
  getCatalog,
  getStatus,
  isTransientProbeError,
  launchCacheKey,
} from "./internal/catalog.js";
import { Session } from "./internal/session.js";
import { AntigravityError } from "./internal/wire.js";

const SESSION_OPEN_CATALOG_WAIT_MS = 5_000;

const capabilities = [
  "prompt.message",
  "prompt.image",
  "prompt.steer",
  "session.configure",
  "session.persistence",
] as const;

export function createAntigravityProvider(options?: {
  openCatalogTimeoutMs?: number;
  probeTimeoutMs?: number;
}): ProviderRegistration {
  return {
    id: "antigravity",
    label: "Antigravity",
    icon: "icon.svg",
    command: ["agy"],
    description: "Antigravity CLI on your host",
    async status({ launch }) {
      if (!launch)
        return {
          available: false,
          diagnostic: "agy not found on PATH. Install Antigravity, then run `agy` and sign in.",
        };
      return getStatus(launch, { timeoutMs: options?.probeTimeoutMs });
    },
    async getCatalogCacheKey({ launch }) {
      if (!launch) return undefined;
      return createHash("sha256").update(launchCacheKey(launch)).digest("hex");
    },
    async connect(request) {
      if (!request.versions.includes(1))
        throw new AntigravityError("Provider protocol version 1 is required");
      if (!request.launch)
        throw new AntigravityError("The daemon must supply the Antigravity launch");
      const negotiated = negotiateProviderCapabilities(request.capabilities, capabilities);
      return createConnection(request.launch, negotiated, options);
    },
  };
}

function createConnection(
  launch: ProviderLaunch,
  negotiated: readonly string[],
  options?: { openCatalogTimeoutMs?: number; probeTimeoutMs?: number },
): ProviderConnection {
  const openCatalogTimeoutMs = options?.openCatalogTimeoutMs ?? SESSION_OPEN_CATALOG_WAIT_MS;
  const sessions = new Map<string, Session>();
  const listeners = new Set<(event: ProviderEvent) => void>();
  const queues = new Map<string, Promise<void>>();
  let discovered: ProviderCatalog | null = null;
  let discovering: Promise<ProviderCatalog> | null = null;
  let closed = false;

  function emit(event: ProviderEvent): void {
    if (closed) return;
    for (const listener of listeners) listener(event);
  }
  function catalog(): ProviderCatalog {
    return discovered ?? fallbackCatalog();
  }
  function startCatalogDiscovery(cwd?: string, refresh = false): Promise<ProviderCatalog> {
    if (!refresh && discovering) return discovering;
    const pending = getCatalog(launch, cwd, {
      refresh,
      timeoutMs: options?.probeTimeoutMs,
    })
      .then((resolved) => {
        discovered = resolved;
        if (!closed) {
          for (const opened of sessions.values()) opened.refreshCatalog();
        }
        return resolved;
      })
      .finally(() => {
        if (discovering === pending) discovering = null;
      });
    discovering = pending;
    return pending;
  }
  async function ensureCatalog(cwd?: string): Promise<ProviderCatalog> {
    if (discovered !== null) return discovered;
    const pending = startCatalogDiscovery(cwd);
    void pending.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), openCatalogTimeoutMs);
      timer.unref?.();
    });
    try {
      const resolved = await Promise.race([pending, timedOut]);
      return resolved ?? fallbackCatalog();
    } catch (error) {
      if (isTransientProbeError(error)) return fallbackCatalog();
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  function session(id: string): Session {
    const found = sessions.get(id);
    if (!found) throw new AntigravityError(`Unknown Antigravity session: ${id}`);
    return found;
  }
  async function dispatch(input: ProviderInput): Promise<void> {
    switch (input.type) {
      case "catalog":
        await startCatalogDiscovery(input.cwd, discovered !== null);
        emit({
          type: "catalog",
          requestId: input.requestId,
          catalog: catalog(),
        });
        return;
      case "session.open": {
        if (sessions.has(input.sessionId))
          throw new AntigravityError(`Session already exists: ${input.sessionId}`);
        await ensureCatalog(input.config.cwd);
        const opened = new Session({
          id: input.sessionId,
          config: input.config,
          persistence: input.persistence,
          history: input.history,
          catalog,
          launch,
          emit,
        });
        sessions.set(input.sessionId, opened);
        try {
          await opened.open(input.requestId, negotiated);
        } catch (error) {
          sessions.delete(input.sessionId);
          await opened.close();
          throw error;
        }
        return;
      }
      case "session.prompt":
        await session(input.sessionId).prompt(input.prompt);
        return;
      case "session.configure":
        session(input.sessionId).configure(input.changes);
        break;
      case "session.interrupt":
        await session(input.sessionId).interrupt();
        break;
      case "session.close": {
        await session(input.sessionId).close();
        sessions.delete(input.sessionId);
        emit({ type: "session.closed", sessionId: input.sessionId });
        break;
      }
      default:
        throw new AntigravityError(`Unsupported Antigravity operation: ${input.type}`);
    }
    emit({ type: "request.completed", requestId: input.requestId });
  }
  function failed(input: ProviderInput, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof AntigravityError ? error.code : "ANTIGRAVITY_ERROR";
    if (input.type === "session.prompt")
      emit({
        type: "session.prompt_result",
        sessionId: input.sessionId,
        clientMessageId: input.prompt.clientMessageId,
        result: { type: "failed", error: { message, code } },
      });
    else if ("requestId" in input)
      emit({ type: "request.failed", requestId: input.requestId, error: { message, code } });
  }
  return {
    version: 1,
    capabilities: negotiated,
    async send(input) {
      if (closed) throw new AntigravityError("Antigravity connection is closed");
      requireProviderCapabilities(negotiated, input);
      const lane = "sessionId" in input ? `session:${input.sessionId}` : `op:${input.type}`;
      const previous = queues.get(lane) ?? Promise.resolve();
      const next = previous
        .then(async () => {
          if (!closed) await dispatch(input);
          return undefined;
        })
        .catch((error) => failed(input, error))
        .finally(() => {
          if (queues.get(lane) === next) queues.delete(lane);
        });
      queues.set(lane, next);
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      if (closed) return;
      closed = true;
      await Promise.all(queues.values());
      queues.clear();
      await Promise.all([...sessions.values()].map((opened) => opened.close()));
      sessions.clear();
      listeners.clear();
    },
  };
}
