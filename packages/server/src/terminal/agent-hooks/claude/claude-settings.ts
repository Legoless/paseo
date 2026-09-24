import { type AgentHookConfigFormat, buildAgentHookShellCommand } from "../agent-hook-installer.js";

interface ClaudeCommandHook {
  type?: unknown;
  command?: unknown;
  timeout?: unknown;
}

interface ClaudeHookMatcher {
  matcher?: unknown;
  hooks?: unknown;
}

export interface ClaudeSettings {
  hooks?: Record<string, unknown>;
  [key: string]: unknown;
}

export const claudeSettingsFormat: AgentHookConfigFormat<ClaudeSettings> = {
  empty() {
    return {};
  },
  parse(raw) {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }
    return parsed;
  },
  stringify(config) {
    return `${JSON.stringify(config, null, 2)}\n`;
  },
  install(config, provider) {
    const marker = provider.install.hookMarker;
    const hooks = removeAllPaseoHooks(config.hooks, marker);
    for (const event of provider.events) {
      hooks[event.event] = [
        ...removePaseoHooks(hooks[event.event], marker),
        {
          matcher: "",
          hooks: [
            {
              type: "command",
              command: buildAgentHookShellCommand(provider, event),
              timeout: 10,
              // Claude ignores keys it does not know, so older versions run the hook synchronously.
              ...(event.async ? { async: true } : {}),
            },
          ],
        },
      ];
    }
    return { ...config, hooks };
  },
  uninstall(config, provider) {
    return { ...config, hooks: removeAllPaseoHooks(config.hooks, provider.install.hookMarker) };
  },
  isInstalled(config, provider) {
    const install = provider.install;
    const hooks = normalizeHooks(config.hooks);
    return provider.events.every((event) => hasPaseoHook(hooks[event.event], install.hookMarker));
  },
};

function normalizeHooks(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

function normalizeMatchers(value: unknown): ClaudeHookMatcher[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord);
}

function normalizeCommandHooks(value: unknown): ClaudeCommandHook[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord);
}

// Sweeps every event, not only the ones we install today, so an event we stop
// installing (SessionEnd) is removed from configs written by older versions.
function removeAllPaseoHooks(value: unknown, marker: string): Record<string, unknown> {
  const hooks = normalizeHooks(value);
  for (const [event, entries] of Object.entries(hooks)) {
    if (!hasPaseoHook(entries, marker)) continue;
    const kept = removePaseoHooks(entries, marker);
    if (kept.length > 0) {
      hooks[event] = kept;
    } else {
      delete hooks[event];
    }
  }
  return hooks;
}

function hasPaseoHook(value: unknown, marker: string): boolean {
  return normalizeMatchers(value).some((entry) =>
    normalizeCommandHooks(entry.hooks).some((hook) => commandContainsMarker(hook, marker)),
  );
}

function removePaseoHooks(value: unknown, marker: string): ClaudeHookMatcher[] {
  const entries: ClaudeHookMatcher[] = [];
  for (const entry of normalizeMatchers(value)) {
    const hooks = normalizeCommandHooks(entry.hooks).filter(
      (hook) => !commandContainsMarker(hook, marker),
    );
    if (hooks.length > 0) {
      entries.push(Object.assign({}, entry, { hooks }));
    }
  }
  return entries;
}

function commandContainsMarker(hook: ClaudeCommandHook, marker: string): boolean {
  return typeof hook.command === "string" && hook.command.includes(marker);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
