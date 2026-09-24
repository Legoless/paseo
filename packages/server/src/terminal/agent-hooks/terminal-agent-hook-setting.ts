import type { AgentHookInstallLogger, AgentHookInstallOptions } from "./agent-hook-installer.js";
import {
  installRegisteredAgentHooks,
  type RegisteredAgentHookInstallOptions,
  registeredAgentHooksAreInstalled,
  uninstallRegisteredAgentHooks,
} from "./provider-registry.js";
import type { DaemonConfigStore } from "../../server/daemon-config-store.js";

interface ApplyTerminalAgentHookSettingOptions {
  store: DaemonConfigStore;
  logger?: AgentHookInstallLogger;
  install?: AgentHookInstallOptions;
}

export interface TerminalAgentHookSetting {
  ensureInstalled(): void;
  unsubscribe(): void;
}

// Installing agent hooks edits the user's real agent config files, so it only
// happens when `enableTerminalAgentHooks` is on. At boot we install when enabled
// and otherwise leave the configs untouched; toggling the setting live installs
// on enable and removes our marker-matched hooks on disable so opting out cleans
// up after itself.
//
// Those config files are shared by every Paseo daemon on the machine, so another
// daemon turning its setting off (or any tool rewriting the file) strips hooks
// this daemon still relies on. `ensureInstalled` runs on terminal creation and
// puts them back while this daemon's setting is on: a read of a few small files,
// and a write only when something is missing.
export function applyTerminalAgentHookSetting(
  options: ApplyTerminalAgentHookSettingOptions,
): TerminalAgentHookSetting {
  const { store, logger, install } = options;
  const installOptions: RegisteredAgentHookInstallOptions = { ...install, logger };

  if (store.get().enableTerminalAgentHooks) {
    installRegisteredAgentHooks(installOptions);
  }

  const unsubscribe = store.onFieldChange("enableTerminalAgentHooks", (value) => {
    if (value === true) {
      installRegisteredAgentHooks(installOptions);
      return;
    }
    try {
      uninstallRegisteredAgentHooks(install);
    } catch (error) {
      logger?.warn({ err: error }, "Failed to remove terminal activity hooks");
    }
  });

  function ensureInstalled(): void {
    if (!store.get().enableTerminalAgentHooks) return;
    try {
      if (registeredAgentHooksAreInstalled(install)) return;
    } catch {
      // An unreadable config counts as missing; the install below logs why it fails.
    }
    logger?.warn({}, "Terminal activity hooks were missing from an agent config; reinstalling");
    installRegisteredAgentHooks(installOptions);
  }

  return { ensureInstalled, unsubscribe };
}
