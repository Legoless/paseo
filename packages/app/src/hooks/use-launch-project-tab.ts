import { useCallback, useMemo } from "react";
import { useToast } from "@/contexts/toast-context";
import { i18n } from "@/i18n/i18next";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { generateDraftId } from "@/stores/draft-keys";
import { useSessionStore } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";

export interface ProjectTabLaunchActions {
  /** Opens the workspace on a fresh draft composer pinned to `cwd`. */
  launchAgent: (cwd: string) => void;
  /** Creates a terminal in `cwd` on this workspace, then opens its tab. */
  launchTerminal: (cwd: string) => void;
}

/**
 * Starts an agent or a terminal in one of a workspace's projects from outside the
 * workspace screen, where the screen's own launcher is not reachable.
 *
 * Both open the workspace as a side effect: a tab has to live somewhere, and the
 * workspace it belongs to is the only place that can show it.
 */
export function useLaunchProjectTab(input: {
  serverId: string;
  workspaceId: string;
}): ProjectTabLaunchActions {
  const { serverId, workspaceId } = input;
  const toast = useToast();

  const launchAgent = useCallback(
    (cwd: string) => {
      navigateToWorkspace({
        serverId,
        workspaceId,
        // `setup` needs a provider too, so the draft carries the directory until
        // the composer pins one — same shape the new-tab launcher produces.
        target: { kind: "draft", draftId: generateDraftId(), cwd },
      });
    },
    [serverId, workspaceId],
  );

  const launchTerminal = useCallback(
    (cwd: string) => {
      void (async () => {
        const client = useSessionStore.getState().sessions[serverId]?.client;
        if (!client) {
          toast.error(i18n.t("workspaceSetup.errors.hostDisconnected"));
          return;
        }
        try {
          // Unlike a draft, a terminal is daemon-side state: it has to exist
          // before a tab can point at it.
          const created = await client.createTerminal(cwd, undefined, undefined, { workspaceId });
          // The daemon reports a failed spawn via `error` with a null terminal.
          if (!created.terminal) {
            if (created.error) throw new Error(created.error);
            return;
          }
          navigateToWorkspace({
            serverId,
            workspaceId,
            target: { kind: "terminal", terminalId: created.terminal.id },
          });
        } catch (error) {
          toast.error(toErrorMessage(error));
        }
      })();
    },
    [serverId, toast, workspaceId],
  );

  return useMemo(() => ({ launchAgent, launchTerminal }), [launchAgent, launchTerminal]);
}
