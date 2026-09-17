import type { ReactElement } from "react";
import { useSettings } from "@/hooks/use-settings";
import { WorkspaceTabPresentationResolver } from "@/screens/workspace/workspace-tab-presentation";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { PaneStatusGlowLayer } from "@/screens/workspace/pane-status-glow-layer";
import { useSessionStore } from "@/stores/session-store";

interface WorkspacePaneStatusGlowProps {
  tab: WorkspaceTabDescriptor;
  serverId: string;
  workspaceId: string;
}

export function WorkspacePaneStatusGlow({
  tab,
  serverId,
  workspaceId,
}: WorkspacePaneStatusGlowProps): ReactElement | null {
  const enabled = useSettings((settings) => settings.paneStatusGlowEnabled);
  const hasStarted = useAgentPaneHasStarted(serverId, tab);
  if (!enabled) {
    return null;
  }
  return (
    <WorkspaceTabPresentationResolver tab={tab} serverId={serverId} workspaceId={workspaceId}>
      {(presentation) => (
        <PaneStatusGlowLayer bucket={presentation.statusBucket} hasStarted={hasStarted} />
      )}
    </WorkspaceTabPresentationResolver>
  );
}

function useAgentPaneHasStarted(serverId: string, tab: WorkspaceTabDescriptor): boolean {
  return useSessionStore((state) => {
    if (tab.target.kind !== "agent") {
      return false;
    }
    const session = state.sessions[serverId];
    const agent =
      session?.agents?.get(tab.target.agentId) ??
      session?.agentDetails?.get(tab.target.agentId) ??
      null;
    return agent?.lastUserMessageAt != null;
  });
}
