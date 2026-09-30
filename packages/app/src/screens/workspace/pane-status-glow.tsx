import type { ReactElement } from "react";
import { useSettings } from "@/hooks/use-settings";
import { WorkspaceTabPresentationResolver } from "@/screens/workspace/workspace-tab-presentation";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { PaneStatusGlowLayer } from "@/screens/workspace/pane-status-glow-layer";
import { shouldShowPaneStatusGlow } from "@/utils/pane-status-glow";

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
  const terminalEnabled = useSettings((settings) => settings.terminalStatusGlowEnabled);
  const isVisible = shouldShowPaneStatusGlow({
    isTerminalTab: tab.kind === "terminal",
    paneStatusGlowEnabled: enabled,
    terminalStatusGlowEnabled: terminalEnabled,
  });
  if (!isVisible) {
    return null;
  }
  return (
    <WorkspaceTabPresentationResolver tab={tab} serverId={serverId} workspaceId={workspaceId}>
      {(presentation) => <PaneStatusGlowLayer bucket={presentation.statusBucket} />}
    </WorkspaceTabPresentationResolver>
  );
}
