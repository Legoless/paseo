import type { ReactElement } from "react";
import { useSettings } from "@/hooks/use-settings";
import { WorkspaceTabPresentationResolver } from "@/screens/workspace/workspace-tab-presentation";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { PaneStatusGlowLayer } from "@/screens/workspace/pane-status-glow-layer";

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
  if (!enabled) {
    return null;
  }
  return (
    <WorkspaceTabPresentationResolver tab={tab} serverId={serverId} workspaceId={workspaceId}>
      {(presentation) => <PaneStatusGlowLayer bucket={presentation.statusBucket} />}
    </WorkspaceTabPresentationResolver>
  );
}
