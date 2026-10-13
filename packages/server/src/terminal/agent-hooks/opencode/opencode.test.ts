import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addAbortSignal, PassThrough, Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentHooksAreInstalled,
  installAgentHooks,
  resolveAgentHookConfigPath,
  uninstallAgentHooks,
} from "../agent-hook-installer.js";
import { opencodeAgentHookProvider } from "./opencode.js";
import { OPENCODE_PLUGIN_SOURCE } from "./opencode-plugin.js";

const temporaryDirs: string[] = [];

afterEach(() => {
  while (temporaryDirs.length > 0) {
    const dir = temporaryDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

describe("OpenCode terminal agent hooks", () => {
  it("installs a self-contained OpenCode plugin idempotently", () => {
    const configDir = createTempDir("paseo-opencode-config-");

    const firstInstall = installAgentHooks(opencodeAgentHookProvider, { configDir });
    const secondInstall = installAgentHooks(opencodeAgentHookProvider, { configDir });

    expect(firstInstall.configPath).toBe(join(configDir, "plugins", "paseo-terminal-activity.js"));
    expect(firstInstall.changed).toBe(true);
    expect(secondInstall.changed).toBe(false);
    expect(readFileSync(firstInstall.configPath, "utf8")).toBe(OPENCODE_PLUGIN_SOURCE);
    expect(agentHooksAreInstalled(opencodeAgentHookProvider, { configDir })).toBe(true);
  });

  it("does not finish a parent turn when a child becomes idle", async () => {
    const { plugin, commands } = loadInstalledPlugin();
    const hooks = plugin.server();
    for (const event of [
      { type: "session.created", properties: { info: { id: "parent", directory: "/workspace" } } },
      {
        type: "session.created",
        properties: { info: { id: "child", parentID: "parent", directory: "/workspace" } },
      },
      { type: "session.status", properties: { sessionID: "parent", status: { type: "busy" } } },
      { type: "session.status", properties: { sessionID: "child", status: { type: "busy" } } },
      { type: "session.status", properties: { sessionID: "child", status: { type: "idle" } } },
    ]) {
      await hooks.event({ event });
    }

    expect(commands).toEqual([["paseo", "hooks", "opencode", "session.status.busy"]]);
  });

  it.each([1, 2] as const)(
    "keeps OpenCode %s working after the parent stops until every child stops",
    async (generation) => {
      const { commands, inputs } = await runScenario(generation, [
        { action: "created", sessionID: "parent" },
        { action: "created", sessionID: "first-child", parentID: "parent" },
        { action: "created", sessionID: "last-child", parentID: "parent" },
        { action: "busy", sessionID: "parent" },
        { action: "busy", sessionID: "first-child" },
        { action: "busy", sessionID: "last-child" },
        { action: "idle", sessionID: "parent" },
        { action: "idle", sessionID: "first-child" },
        { action: "idle", sessionID: "last-child" },
      ]);

      expect(commands).toEqual([
        ["paseo", "hooks", "opencode", "session.status.busy"],
        ["paseo", "hooks", "opencode", "session.status.idle"],
      ]);
      expect(await Promise.all(inputs.map((input) => input.text()))).toEqual([
        JSON.stringify({ session_id: "parent" }),
        JSON.stringify({ session_id: "parent" }),
      ]);
    },
  );

  it.each([1, 2] as const)(
    "resolves resumed OpenCode %s descendants to the root without creation events",
    async (generation) => {
      const { commands, inputs, lookups } = await runScenario(
        generation,
        [
          { action: "busy", sessionID: "parent" },
          { action: "busy", sessionID: "grandchild" },
          { action: "idle", sessionID: "parent" },
          { action: "idle", sessionID: "grandchild" },
        ],
        {
          sessions: [
            { id: "parent", directory: "/workspace" },
            { id: "child", parentID: "parent", directory: "/workspace" },
            { id: "grandchild", parentID: "child", directory: "/workspace" },
          ],
        },
      );

      expect(commands).toEqual([
        ["paseo", "hooks", "opencode", "session.status.busy"],
        ["paseo", "hooks", "opencode", "session.status.idle"],
      ]);
      expect(lookups).toEqual(["parent", "grandchild", "child"]);
      expect(await Promise.all(inputs.map((input) => input.text()))).toEqual([
        JSON.stringify({ session_id: "parent" }),
        JSON.stringify({ session_id: "parent" }),
      ]);
    },
  );

  it.each([1, 2] as const)(
    "attributes OpenCode %s background work to the parent when the child reports first",
    async (generation) => {
      const { commands, inputs } = await runScenario(
        generation,
        [
          { action: "busy", sessionID: "child" },
          { action: "idle", sessionID: "parent" },
          { action: "idle", sessionID: "child" },
        ],
        {
          sessions: [
            { id: "parent", directory: "/workspace" },
            { id: "child", parentID: "parent", directory: "/workspace" },
          ],
        },
      );

      expect(commands).toEqual([
        ["paseo", "hooks", "opencode", "session.status.busy"],
        ["paseo", "hooks", "opencode", "session.status.idle"],
      ]);
      expect(await Promise.all(inputs.map((input) => input.text()))).toEqual([
        JSON.stringify({ session_id: "parent" }),
        JSON.stringify({ session_id: "parent" }),
      ]);
    },
  );

  it.each([1, 2] as const)(
    "keeps OpenCode %s orange while any descendant permission remains unanswered",
    async (generation) => {
      const { commands } = await runScenario(generation, [
        { action: "created", sessionID: "parent" },
        { action: "created", sessionID: "child", parentID: "parent" },
        { action: "busy", sessionID: "parent" },
        { action: "permission.asked", sessionID: "child", permissionID: "first" },
        { action: "busy", sessionID: "parent" },
        { action: "busy", sessionID: "child" },
        { action: "permission.asked", sessionID: "child", permissionID: "last" },
        { action: "permission.replied", sessionID: "child", permissionID: "first" },
        { action: "idle", sessionID: "parent" },
        { action: "permission.replied", sessionID: "child", permissionID: "last" },
        { action: "idle", sessionID: "child" },
      ]);

      expect(commands).toEqual([
        ["paseo", "hooks", "opencode", "session.status.busy"],
        ["paseo", "hooks", "opencode", "permission.asked"],
        ["paseo", "hooks", "opencode", "session.status.busy"],
        ["paseo", "hooks", "opencode", "session.status.idle"],
      ]);
    },
  );

  it.each([1, 2] as const)("reports OpenCode %s retries as working", async (generation) => {
    const { commands } = await runScenario(generation, [
      { action: "retry", sessionID: "parent" },
      { action: "idle", sessionID: "parent" },
    ]);

    expect(commands).toEqual([
      ["paseo", "hooks", "opencode", "session.status.busy"],
      ["paseo", "hooks", "opencode", "session.status.idle"],
    ]);
  });

  it.each([1, 2] as const)(
    "finishes OpenCode %s when its last active child is deleted",
    async (generation) => {
      const { commands } = await runScenario(generation, [
        { action: "created", sessionID: "parent" },
        { action: "created", sessionID: "child", parentID: "parent" },
        { action: "busy", sessionID: "parent" },
        { action: "busy", sessionID: "child" },
        { action: "idle", sessionID: "parent" },
        { action: "deleted", sessionID: "child" },
      ]);

      expect(commands).toEqual([
        ["paseo", "hooks", "opencode", "session.status.busy"],
        ["paseo", "hooks", "opencode", "session.status.idle"],
      ]);
    },
  );

  it.each([1, 2] as const)(
    "ignores unrelated roots while the OpenCode %s pane's session is active",
    async (generation) => {
      const { commands, inputs } = await runScenario(generation, [
        { action: "busy", sessionID: "parent" },
        { action: "busy", sessionID: "unrelated" },
        { action: "permission.asked", sessionID: "unrelated", permissionID: "permission" },
        { action: "idle", sessionID: "unrelated" },
        { action: "idle", sessionID: "parent" },
      ]);

      expect(commands).toEqual([
        ["paseo", "hooks", "opencode", "session.status.busy"],
        ["paseo", "hooks", "opencode", "session.status.idle"],
      ]);
      expect(await Promise.all(inputs.map((input) => input.text()))).toEqual([
        JSON.stringify({ session_id: "parent" }),
        JSON.stringify({ session_id: "parent" }),
      ]);
    },
  );

  it("ignores other OpenCode 2 locations but includes children with a different cwd", async () => {
    const { commands } = await runScenario(2, [
      { action: "created", sessionID: "unrelated", directory: "/elsewhere" },
      { action: "busy", sessionID: "unrelated" },
      { action: "created", sessionID: "parent" },
      { action: "created", sessionID: "child", parentID: "parent", directory: "/other-child-cwd" },
      { action: "busy", sessionID: "parent" },
      { action: "busy", sessionID: "child" },
      { action: "idle", sessionID: "parent" },
      { action: "idle", sessionID: "child" },
    ]);

    expect(commands).toEqual([
      ["paseo", "hooks", "opencode", "session.status.busy"],
      ["paseo", "hooks", "opencode", "session.status.idle"],
    ]);
  });

  it("uses the current Paseo executable with root session identity on stdin", async () => {
    const { commands, inputs } = await runScenario(1, [{ action: "busy", sessionID: "parent" }], {
      cli: "/Applications/Paseo Neo.app/Contents/Resources/paseo",
    });

    expect(commands).toEqual([
      [
        "/Applications/Paseo Neo.app/Contents/Resources/paseo",
        "hooks",
        "opencode",
        "session.status.busy",
      ],
    ]);
    expect(await inputs[0]!.text()).toBe(JSON.stringify({ session_id: "parent" }));
  });

  it.each(["succeeded", "failed", "interrupted"])(
    "reports OpenCode 2 execution start and %s as running then idle",
    async (outcome) => {
      const { plugin, commands } = loadInstalledPlugin();
      const events = Readable.from([
        { type: "session.execution.started", data: { sessionID: "session-1" } },
        { type: `session.execution.${outcome}`, data: { sessionID: "session-1" } },
      ]);

      const dispose = plugin.setup({ event: { subscribe: () => events } });
      await finished(events);
      dispose();

      expect(commands).toEqual([
        ["paseo", "hooks", "opencode", "session.status.busy"],
        ["paseo", "hooks", "opencode", "session.status.idle"],
      ]);
    },
  );

  it("reports OpenCode 1 status and permission events through server()", async () => {
    const { plugin, commands } = loadInstalledPlugin();
    const hooks = plugin.server();
    for (const event of [
      { type: "session.status", properties: { sessionID: "session-1", status: { type: "busy" } } },
      { type: "permission.asked", properties: { sessionID: "session-1", id: "permission-1" } },
      {
        type: "permission.replied",
        properties: { sessionID: "session-1", requestID: "permission-1" },
      },
      { type: "session.status", properties: { sessionID: "session-1", status: { type: "retry" } } },
      { type: "session.status", properties: { sessionID: "session-1", status: { type: "idle" } } },
      { type: "session.execution.started", data: { sessionID: "session-1" } },
      { type: "message.updated" },
    ]) {
      await hooks.event({ event });
    }

    expect(plugin.id).toBe("paseo-terminal-activity");
    expect(commands).toEqual([
      ["paseo", "hooks", "opencode", "session.status.busy"],
      ["paseo", "hooks", "opencode", "permission.asked"],
      ["paseo", "hooks", "opencode", "session.status.busy"],
      ["paseo", "hooks", "opencode", "session.status.idle"],
    ]);
  });

  it("reports OpenCode 2 permission events and ignores V1 status snapshots", async () => {
    const { plugin, commands } = loadInstalledPlugin();
    const events = Readable.from([
      { type: "permission.asked", data: { sessionID: "session-1", id: "permission-1" } },
      { type: "permission.replied", data: { sessionID: "session-1", requestID: "permission-1" } },
      { type: "session.status", properties: { status: { type: "busy" } } },
      { type: "session.text.delta", data: { sessionID: "session-1" } },
    ]);

    const dispose = plugin.setup({ event: { subscribe: () => events } });
    await finished(events);
    dispose();

    expect(commands).toEqual([
      ["paseo", "hooks", "opencode", "permission.asked"],
      ["paseo", "hooks", "opencode", "session.status.busy"],
    ]);
  });

  it("preserves activity order when the host dispatches events concurrently", async () => {
    let finishFirstHook = () => {};
    const firstExit = new Promise<number>((resolve) => {
      finishFirstHook = () => resolve(0);
    });
    let startedFirstHook = () => {};
    const firstStarted = new Promise<void>((resolve) => {
      startedFirstHook = resolve;
    });
    const { plugin, commands } = loadInstalledPlugin("terminal-1", firstExit, {
      onSpawn: startedFirstHook,
    });
    const hooks = plugin.server();

    const working = hooks.event({
      event: {
        type: "session.status",
        properties: { sessionID: "session-1", status: { type: "busy" } },
      },
    });
    const idle = hooks.event({
      event: {
        type: "session.status",
        properties: { sessionID: "session-1", status: { type: "idle" } },
      },
    });
    await firstStarted;
    expect(commands).toEqual([["paseo", "hooks", "opencode", "session.status.busy"]]);

    finishFirstHook();
    await Promise.all([working, idle]);
    expect(commands).toEqual([
      ["paseo", "hooks", "opencode", "session.status.busy"],
      ["paseo", "hooks", "opencode", "session.status.idle"],
    ]);
  });

  it("stops the OpenCode 2 subscription when unloaded", async () => {
    const { plugin, commands } = loadInstalledPlugin();
    const events = new PassThrough({ objectMode: true });
    const closed = finished(events);
    const dispose = plugin.setup({
      event: { subscribe: ({ signal }) => addAbortSignal(signal, events) },
    });

    dispose();

    await expect(closed).rejects.toMatchObject({ name: "AbortError" });
    expect(commands).toEqual([]);
  });

  it("keeps both generations inert outside Paseo terminals", async () => {
    const { plugin, commands, lookups } = loadInstalledPlugin("");
    await plugin.server().event({
      event: {
        type: "session.status",
        properties: { sessionID: "session-1", status: { type: "busy" } },
      },
    });
    const events = Readable.from([
      { type: "session.execution.started", data: { sessionID: "session-1" } },
      { type: "permission.asked", data: { sessionID: "session-1", id: "permission-1" } },
    ]);
    const dispose = plugin.setup({ event: { subscribe: () => events } });
    await finished(events);
    dispose();

    expect(commands).toEqual([]);
    expect(lookups).toEqual([]);
  });

  it("uninstalls the OpenCode plugin file", () => {
    const configDir = createTempDir("paseo-opencode-config-uninstall-");
    const configPath = resolveAgentHookConfigPath(opencodeAgentHookProvider, { configDir });
    installAgentHooks(opencodeAgentHookProvider, { configDir });

    const result = uninstallAgentHooks(opencodeAgentHookProvider, { configDir });

    expect(result).toEqual({ configPath, changed: true });
    expect(existsSync(configPath)).toBe(false);
    expect(agentHooksAreInstalled(opencodeAgentHookProvider, { configDir })).toBe(false);
  });

  it("prefers OPENCODE_CONFIG_DIR over the XDG config home", () => {
    const homeDir = createTempDir("paseo-home-");
    const configDir = createTempDir("paseo-opencode-override-");
    const xdgConfigHome = createTempDir("paseo-xdg-config-");

    const configPath = resolveAgentHookConfigPath(opencodeAgentHookProvider, {
      env: { OPENCODE_CONFIG_DIR: configDir, XDG_CONFIG_HOME: xdgConfigHome },
      homeDir,
    });

    expect(configPath).toBe(join(configDir, "plugins", "paseo-terminal-activity.js"));
  });

  it("uses the XDG config home for the default OpenCode config dir", () => {
    const homeDir = createTempDir("paseo-home-");
    const xdgConfigHome = createTempDir("paseo-xdg-config-");

    const configPath = resolveAgentHookConfigPath(opencodeAgentHookProvider, {
      env: { XDG_CONFIG_HOME: xdgConfigHome },
      homeDir,
    });

    expect(configPath).toBe(
      join(xdgConfigHome, "opencode", "plugins", "paseo-terminal-activity.js"),
    );
  });

  it("falls back to the home .config OpenCode dir without an XDG config home", () => {
    const homeDir = createTempDir("paseo-home-");

    const configPath = resolveAgentHookConfigPath(opencodeAgentHookProvider, {
      env: {},
      homeDir,
    });

    expect(configPath).toBe(
      join(homeDir, ".config", "opencode", "plugins", "paseo-terminal-activity.js"),
    );
  });

  it.each([
    ["session.status.busy", "running"],
    ["session.status.retry", "running"],
    ["session.status.idle", "idle"],
    ["permission.asked", "needs-input"],
    ["permission.replied", "running"],
  ] as const)("maps %s to %s", async (event, state) => {
    await expect(
      opencodeAgentHookProvider.resolveActivity({
        event,
        input: { read: async () => null },
      }),
    ).resolves.toBe(state);
  });
});

interface OpenCodeEvent {
  type: string;
  properties?: {
    sessionID?: string;
    id?: string;
    requestID?: string;
    status?: { type: string };
    info?: OpenCodeSession;
  };
  data?: {
    sessionID: string;
    id?: string;
    parentID?: string;
    requestID?: string;
    location?: { directory: string };
  };
}

interface OpenCodeSession {
  id: string;
  parentID?: string;
  directory: string;
}

interface ScenarioEvent {
  action:
    | "created"
    | "busy"
    | "retry"
    | "idle"
    | "deleted"
    | "permission.asked"
    | "permission.replied";
  sessionID: string;
  parentID?: string;
  directory?: string;
  permissionID?: string;
}

async function runScenario(
  generation: 1 | 2,
  scenario: ScenarioEvent[],
  options: PluginOptions = {},
) {
  const runtime = loadInstalledPlugin("terminal-1", Promise.resolve(0), options);
  const events: OpenCodeEvent[] = scenario.map((event) => {
    const { action, sessionID, parentID, permissionID } = event;
    const directory = event.directory ?? "/workspace";
    if (generation === 1) {
      if (action === "created" || action === "deleted")
        return {
          type: `session.${action}`,
          properties: { info: { id: sessionID, parentID, directory } },
        };
      if (action === "permission.asked")
        return {
          type: action,
          properties: { sessionID, id: permissionID },
        };
      if (action === "permission.replied")
        return {
          type: action,
          properties: { sessionID, requestID: permissionID },
        };
      return { type: "session.status", properties: { sessionID, status: { type: action } } };
    }
    if (action === "created")
      return {
        type: "session.created",
        data: { sessionID, parentID, location: { directory } },
      };
    if (action === "deleted") return { type: "session.deleted", data: { sessionID } };
    if (action === "permission.asked")
      return { type: action, data: { sessionID, id: permissionID } };
    if (action === "permission.replied")
      return { type: action, data: { sessionID, requestID: permissionID } };
    const type = {
      busy: "session.execution.started",
      retry: "session.retry.scheduled",
      idle: "session.execution.succeeded",
    }[action];
    return { type, data: { sessionID } };
  });
  if (generation === 1) {
    const hooks = runtime.plugin.server();
    for (const event of events) await hooks.event({ event });
  } else {
    const stream = Readable.from(events);
    const dispose = runtime.plugin.setup({ event: { subscribe: () => stream } });
    await finished(stream);
    dispose();
  }
  return runtime;
}

interface InstalledPlugin {
  id: string;
  server(context: {
    directory: string;
    client: {
      session: {
        get(options: {
          path: { id: string };
          query: { directory: string };
        }): Promise<{ data: OpenCodeSession }>;
      };
    };
  }): { event(input: { event: OpenCodeEvent }): Promise<void> };
  setup(context: {
    location: { directory: string };
    session: {
      get(options: {
        sessionID: string;
      }): Promise<OpenCodeSession & { location: { directory: string } }>;
    };
    event: { subscribe(options: { signal: AbortSignal }): AsyncIterable<OpenCodeEvent> };
  }): () => void;
}

interface PluginOptions {
  cli?: string;
  sessions?: OpenCodeSession[];
  onSpawn?: () => void;
}

function loadInstalledPlugin(
  terminalId = "terminal-1",
  exited = Promise.resolve(0),
  options: PluginOptions = {},
) {
  const configDir = createTempDir("paseo-opencode-runtime-");
  const { configPath } = installAgentHooks(opencodeAgentHookProvider, { configDir });
  const source = readFileSync(configPath, "utf8");
  const commands: string[][] = [];
  const inputs: Blob[] = [];
  const lookups: string[] = [];
  async function getSession(id: string) {
    lookups.push(id);
    return (
      options.sessions?.find((session) => session.id === id) ?? { id, directory: "/workspace" }
    );
  }
  // Supply the host runtime at the script boundary; execute the installed source.
  const installed: InstalledPlugin = runInNewContext(
    source.replace("export default", "globalThis.plugin ="),
    {
      AbortController,
      Blob,
      process: { env: { PASEO_TERMINAL_ID: terminalId, PASEO_HOOK_CLI: options.cli } },
      Bun: {
        spawn(command: string[], input: { stdin: Blob }) {
          commands.push(command);
          inputs.push(input.stdin);
          options.onSpawn?.();
          return { exited };
        },
      },
    },
  );
  const plugin = {
    id: installed.id,
    server: () =>
      installed.server({
        directory: "/workspace",
        client: { session: { get: async ({ path }) => ({ data: await getSession(path.id) }) } },
      }),
    setup: (context: Pick<Parameters<InstalledPlugin["setup"]>[0], "event">) =>
      installed.setup({
        ...context,
        location: { directory: "/workspace" },
        session: {
          get: async ({ sessionID }) => {
            const info = await getSession(sessionID);
            return { ...info, location: { directory: info.directory } };
          },
        },
      }),
  };
  return { plugin, commands, inputs, lookups };
}
