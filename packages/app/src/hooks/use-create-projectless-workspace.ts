import { useCallback } from "react";
import { useToast } from "@/contexts/toast-context";
import { i18n } from "@/i18n/i18next";
import { useHosts } from "@/runtime/host-runtime";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { normalizeWorkspaceDescriptor, useSessionStore } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";

/**
 * Picks the host a projectless workspace is created on. The active workspace's
 * host is the user's current context; failing that, a single configured host is
 * unambiguous. Several hosts and no active workspace is a genuine choice, so
 * answer null and let the caller send the user somewhere that can ask.
 */
export function resolveProjectlessWorkspaceHost(input: {
  activeServerId: string | null;
  serverIds: readonly string[];
}): string | null {
  if (input.activeServerId) return input.activeServerId;
  return input.serverIds.length === 1 ? (input.serverIds[0] ?? null) : null;
}

/**
 * Creates a workspace holding no projects and opens it. It lands on the default
 * layout — one pane showing the new-tab launcher — so the user picks an agent,
 * terminal or browser, and the pane carries whichever project they choose.
 *
 * Returns false when it could not act, so a caller can fall back to a surface
 * that asks the user which host to use.
 */
export function useCreateProjectlessWorkspace(): () => Promise<boolean> {
  const toast = useToast();
  const hosts = useHosts();
  const activeSelection = useActiveWorkspaceSelection();
  const activeServerId = activeSelection?.serverId ?? null;

  return useCallback(async () => {
    const serverId = resolveProjectlessWorkspaceHost({
      activeServerId,
      serverIds: hosts.map((host) => host.serverId),
    });
    if (!serverId) return false;

    const session = useSessionStore.getState().sessions[serverId];
    // COMPAT(workspaceProjectless): added in v0.8.0, remove gate after 2028-03-01.
    // A daemon that predates the feature rejects the `empty` source outright, so
    // check before sending rather than reading the failure back.
    if (!session?.serverInfo?.features?.workspaceProjectless) return false;
    const client = session.client;
    if (!client) {
      toast.error(i18n.t("workspaceSetup.errors.hostDisconnected"));
      return true;
    }

    try {
      const payload = await client.createWorkspace({ source: { kind: "empty" } });
      if (payload.error || !payload.workspace) {
        throw new Error(payload.error ?? i18n.t("newWorkspace.errors.createWorktreeFailed"));
      }
      const workspace = normalizeWorkspaceDescriptor(payload.workspace);
      useSessionStore.getState().mergeWorkspaces(serverId, [workspace]);
      navigateToWorkspace({ serverId, workspaceId: workspace.id });
    } catch (error) {
      toast.error(toErrorMessage(error));
    }
    return true;
  }, [activeServerId, hosts, toast]);
}
