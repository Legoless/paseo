import { generateMessageId } from "@/types/stream";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import type { TerminalProfile } from "@getpaseo/protocol/messages";

export type NewTabSelection =
  | { kind: "target"; target: WorkspaceTab["target"] }
  | { kind: "agent" }
  | { kind: "terminal"; profile?: TerminalProfile }
  | { kind: "browser" };

export function createNewWorkspaceTab(cwd?: string | null): WorkspaceTab {
  return {
    tabId: `tab_${generateMessageId()}`,
    target: { kind: "new_tab", ...(cwd ? { cwd } : {}) },
    createdAt: Date.now(),
  };
}

/**
 * The project a target carries itself. Agent and terminal cwds live on the daemon, not on the
 * target, so a pane emptied of those inherits nothing here — see `resolvePaneProjectRoot`.
 */
export function workspaceTabTargetOwnCwd(target: WorkspaceTab["target"]): string | null {
  if (target.kind === "draft") return target.setup?.cwd ?? target.cwd ?? null;
  if (target.kind === "new_tab") return target.cwd ?? null;
  return null;
}
