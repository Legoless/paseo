import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isPlatform } from "../../../test-utils/platform.js";
import { buildTerminalEnvironment } from "../../terminal.js";
import { buildAgentHookShellCommand } from "../agent-hook-installer.js";
import {
  AGENT_HOOK_PROVIDERS,
  installRegisteredAgentHooks,
  registeredAgentHooksAreInstalled,
  uninstallRegisteredAgentHooks,
} from "../provider-registry.js";

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

function createFakeCliBinDir(): string {
  const dir = createTempDir("paseo-cli-bin-");
  writeFileSync(join(dir, "paseo"), "");
  return dir;
}

interface TestClaudeSettings {
  hooks?: Record<string, unknown>;
  theme?: string;
}

function readSettings(configDir: string): TestClaudeSettings {
  return JSON.parse(readFileSync(join(configDir, "settings.json"), "utf8")) as {
    hooks?: Record<string, unknown>;
    theme?: string;
  };
}

function hookCommands(settings: { hooks?: Record<string, unknown> }, event: string): string[] {
  const entries = settings.hooks?.[event];
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.flatMap((entry) => {
    if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
      return [];
    }
    return entry.hooks
      .map((hook) => (isRecord(hook) ? hook.command : undefined))
      .filter((command): command is string => typeof command === "string");
  });
}

function hookObjects(
  settings: { hooks?: Record<string, unknown> },
  event: string,
): Record<string, unknown>[] {
  const entries = settings.hooks?.[event];
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.flatMap((entry) =>
    isRecord(entry) && Array.isArray(entry.hooks) ? entry.hooks.filter(isRecord) : [],
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("Claude terminal agent hooks", () => {
  it("installs registered provider hooks idempotently", () => {
    const configDir = createTempDir("paseo-claude-config-");
    const provider = AGENT_HOOK_PROVIDERS.claude;
    const install = provider.install;

    installRegisteredAgentHooks({ configDir });
    const [secondInstall] = installRegisteredAgentHooks({ configDir });

    const settings = readSettings(configDir);
    for (const event of provider.events) {
      const paseoCommands = hookCommands(settings, event.event).filter((command) =>
        command.includes(install.hookMarker),
      );
      expect(paseoCommands).toHaveLength(1);
      expect(paseoCommands[0]).toBe(
        `if [ -n "$PASEO_TERMINAL_ID" ]; then "\${PASEO_HOOK_CLI:-paseo}" hooks ${provider.id} ${event.event} 2>/dev/null || true; fi`,
      );
    }
    expect(secondInstall.changed).toBe(false);
    expect(registeredAgentHooksAreInstalled({ configDir })).toBe(true);
  });

  it("runs only the prompt hook in the background", () => {
    const configDir = createTempDir("paseo-claude-config-async-");

    installRegisteredAgentHooks({ configDir });

    const settings = readSettings(configDir);
    expect(hookObjects(settings, "UserPromptSubmit")).toEqual([
      expect.objectContaining({ async: true }),
    ]);
    for (const event of ["Stop", "StopFailure", "Notification"]) {
      expect(hookObjects(settings, event)).toEqual([expect.not.objectContaining({ async: true })]);
    }
  });

  it("replaces hooks from older installs, including events no longer installed", () => {
    const configDir = createTempDir("paseo-claude-config-upgrade-");
    const oldCommand = (event: string) =>
      `if [ -n "$PASEO_TERMINAL_ID" ]; then "\${PASEO_HOOK_CLI:-paseo}" hooks claude ${event}; fi`;
    const oldEntry = (event: string) => ({
      matcher: "",
      hooks: [{ type: "command", command: oldCommand(event), timeout: 10 }],
    });
    const events = ["UserPromptSubmit", "Stop", "StopFailure", "SessionEnd", "Notification"];
    writeFileSync(
      join(configDir, "settings.json"),
      `${JSON.stringify(
        {
          hooks: {
            ...Object.fromEntries(events.map((event) => [event, [oldEntry(event)]])),
            Stop: [
              { matcher: "", hooks: [{ type: "command", command: "say done", timeout: 5 }] },
              oldEntry("Stop"),
            ],
          },
        },
        null,
        2,
      )}\n`,
    );

    installRegisteredAgentHooks({ configDir });

    const settings = readSettings(configDir);
    expect(settings.hooks?.SessionEnd).toBeUndefined();
    expect(hookCommands(settings, "Stop")).toEqual([
      "say done",
      buildAgentHookShellCommand(AGENT_HOOK_PROVIDERS.claude, { event: "Stop" }),
    ]);
    for (const event of AGENT_HOOK_PROVIDERS.claude.events) {
      expect(
        hookCommands(settings, event.event).filter((command) => command.includes("hooks claude")),
      ).toEqual([buildAgentHookShellCommand(AGENT_HOOK_PROVIDERS.claude, event)]);
    }
  });

  it("preserves unrelated user hooks", () => {
    const configDir = createTempDir("paseo-claude-config-preserve-");
    writeFileSync(
      join(configDir, "settings.json"),
      `${JSON.stringify(
        {
          theme: "dark",
          hooks: {
            Stop: [
              {
                matcher: "",
                hooks: [{ type: "command", command: "say done", timeout: 5 }],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    );

    installRegisteredAgentHooks({ configDir });

    const settings = readSettings(configDir);
    expect(settings.theme).toBe("dark");
    expect(hookCommands(settings, "Stop")).toContain("say done");
    expect(
      hookCommands(settings, "Stop").some((command) => command.includes("hooks claude Stop")),
    ).toBe(true);
  });

  it("uninstalls only marker-matched hooks", () => {
    const configDir = createTempDir("paseo-claude-config-uninstall-");
    installRegisteredAgentHooks({ configDir });
    const settings = readSettings(configDir);
    settings.hooks = {
      ...settings.hooks,
      Stop: [
        ...(Array.isArray(settings.hooks?.Stop) ? settings.hooks.Stop : []),
        {
          matcher: "",
          hooks: [{ type: "command", command: "say still-here", timeout: 5 }],
        },
      ],
    };
    writeFileSync(join(configDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);

    uninstallRegisteredAgentHooks({ configDir });

    const nextSettings = readSettings(configDir);
    expect(hookCommands(nextSettings, "Stop")).toEqual(["say still-here"]);
    expect(registeredAgentHooksAreInstalled({ configDir })).toBe(false);
  });

  it("builds a minimal gated hook command", () => {
    const provider = AGENT_HOOK_PROVIDERS.claude;
    const command = buildAgentHookShellCommand(provider, provider.events[0]);

    expect(command).toBe(
      'if [ -n "$PASEO_TERMINAL_ID" ]; then "${PASEO_HOOK_CLI:-paseo}" hooks claude UserPromptSubmit 2>/dev/null || true; fi',
    );
  });

  it.skipIf(isPlatform("win32")).each(AGENT_HOOK_PROVIDERS.claude.events)(
    "$event hook command exits 0 silently when PASEO_TERMINAL_ID is unset or the CLI is missing",
    (event) => {
      const provider = AGENT_HOOK_PROVIDERS.claude;
      const command = buildAgentHookShellCommand(provider, event);

      const unset = spawnSync("/bin/sh", ["-c", command], {
        env: { PATH: process.env.PATH ?? "", PASEO_HOOK_CLI: "paseo" },
        encoding: "utf8",
      });
      const missingCli = spawnSync("/bin/sh", ["-c", command], {
        env: {
          PATH: process.env.PATH ?? "",
          PASEO_TERMINAL_ID: "terminal-1",
          PASEO_HOOK_CLI: join(createTempDir("paseo-missing-cli-"), "paseo"),
        },
        encoding: "utf8",
      });

      for (const result of [unset, missingCli]) {
        expect(result).toMatchObject({ status: 0, stdout: "", stderr: "" });
      }
    },
  );

  it("keeps provider names out of the generic server bootstrap", () => {
    const source = readFileSync(
      new URL("../../../server/bootstrap.ts", import.meta.url),
      "utf8",
    ).toLowerCase();

    for (const providerId of Object.keys(AGENT_HOOK_PROVIDERS)) {
      expect(source).not.toContain(providerId);
    }
  });

  it("prepends the paseo CLI directory and injects the hook CLI path", () => {
    const cliBinDir = createFakeCliBinDir();
    const hookCliPath = join(cliBinDir, "paseo");

    const env = buildTerminalEnvironment({
      shell: "/bin/sh",
      env: { PATH: ["/usr/bin", "/bin"].join(delimiter) },
      paseoCliBinDir: cliBinDir,
      paseoHookCliPath: hookCliPath,
    });

    expect(env.PATH?.split(delimiter)).toEqual([cliBinDir, "/usr/bin", "/bin"]);
    expect(env.PASEO_HOOK_CLI).toBe(hookCliPath);
  });

  it("leaves terminal PATH unchanged when the CLI directory cannot be resolved", () => {
    const env = buildTerminalEnvironment({
      shell: "/bin/sh",
      env: { PATH: ["/usr/bin", "/bin"].join(delimiter) },
      paseoCliBinDir: null,
    });

    expect(env.PATH?.split(delimiter)).toEqual(["/usr/bin", "/bin"]);
  });
});
