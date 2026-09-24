import type { AgentHookActivityInput, AgentHookProvider } from "../agent-hook-installer.js";
import { type ClaudeSettings, claudeSettingsFormat } from "./claude-settings.js";

// Notification types Claude sends while a dialog waits on the user. idle_prompt is
// not one: it fires a minute after a finished turn, which Stop already recorded.
const NEEDS_INPUT_NOTIFICATIONS = new Set<unknown>([
  "permission_prompt",
  "elicitation_dialog",
  "elicitation_url_dialog",
  "worker_permission_prompt",
  "agent_needs_input",
]);

const QUOTA_ERRORS = new Set<unknown>(["rate_limit", "billing_error"]);

// No SessionEnd: the shell's command-finished already clears activity when Claude
// exits, and posting idle there turned /exit into a finished turn.
export const claudeAgentHookProvider: AgentHookProvider<ClaudeSettings> = {
  id: "claude",
  events: [
    { event: "UserPromptSubmit", async: true },
    { event: "Stop" },
    { event: "StopFailure" },
    { event: "Notification" },
  ],
  install: {
    kind: "config-file",
    configDir: ".claude",
    configFile: "settings.json",
    configDirEnvOverride: "CLAUDE_CONFIG_DIR",
    hookMarker: "hooks claude",
    format: claudeSettingsFormat,
  },
  async resolveActivity({ event, input }) {
    switch (event) {
      case "UserPromptSubmit":
        return "running";
      case "Stop": {
        // The turn ended but a background task still runs; Claude resumes when it finishes.
        const tasks = (await readPayload(input)).background_tasks;
        const busy =
          Array.isArray(tasks) && tasks.some((t) => isRecord(t) && t.status === "running");
        return busy ? "running" : "idle";
      }
      case "StopFailure":
        return QUOTA_ERRORS.has((await readPayload(input)).error) ? "quota" : "idle";
      case "Notification":
        return NEEDS_INPUT_NOTIFICATIONS.has((await readPayload(input)).notification_type)
          ? "needs-input"
          : null;
      default:
        return null;
    }
  },
};

async function readPayload(input: AgentHookActivityInput): Promise<Record<string, unknown>> {
  const raw = input.isTTY ? null : await input.read();
  if (!raw) return {};
  try {
    const payload = JSON.parse(raw) as unknown;
    return isRecord(payload) ? payload : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
