import type { ReactElement, ReactNode } from "react";
import { useSettings } from "@/hooks/use-settings";
import { WorkspaceTabPresentationResolver } from "@/screens/workspace/workspace-tab-presentation";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { PaneStatusGlowLayer } from "@/screens/workspace/pane-status-glow-layer";
import {
  resolvePaneStatusBucket,
  shouldShowPaneStatusGlow,
  type PaneTabStatus,
} from "@/utils/pane-status-glow";

interface WorkspacePaneStatusGlowProps {
  tab: WorkspaceTabDescriptor;
  /** Every tab in the pane. An unseen one lights the pane even from behind `tab`. */
  paneTabs?: readonly WorkspaceTabDescriptor[];
  serverId: string;
  workspaceId: string;
}

export function WorkspacePaneStatusGlow({
  tab,
  paneTabs = [],
  serverId,
  workspaceId,
}: WorkspacePaneStatusGlowProps): ReactElement | null {
  const enabled = useSettings((settings) => settings.paneStatusGlowEnabled);
  const terminalEnabled = useSettings((settings) => settings.terminalStatusGlowEnabled);
  const glowingTabs = [
    tab,
    ...paneTabs.filter((candidate) => candidate.tabId !== tab.tabId),
  ].filter((candidate) =>
    shouldShowPaneStatusGlow({
      isTerminalTab: candidate.kind === "terminal",
      paneStatusGlowEnabled: enabled,
      terminalStatusGlowEnabled: terminalEnabled,
    }),
  );
  if (glowingTabs.length === 0) {
    return null;
  }
  return (
    <PaneTabStatuses
      tabs={glowingTabs}
      activeTabId={tab.tabId}
      statuses={[]}
      serverId={serverId}
      workspaceId={workspaceId}
    >
      {(statuses) => <PaneStatusGlowLayer bucket={resolvePaneStatusBucket(statuses)} />}
    </PaneTabStatuses>
  );
}

interface PaneTabStatusesProps {
  tabs: readonly WorkspaceTabDescriptor[];
  activeTabId: string;
  statuses: readonly PaneTabStatus[];
  serverId: string;
  workspaceId: string;
  children: (statuses: readonly PaneTabStatus[]) => ReactNode;
}

// A tab's status comes from its panel's descriptor hook, so each tab needs its own resolver. They
// nest, one per tab, and the innermost one sees every status.
function PaneTabStatuses({
  tabs,
  activeTabId,
  statuses,
  serverId,
  workspaceId,
  children,
}: PaneTabStatusesProps): ReactElement {
  const [tab, ...rest] = tabs;
  if (!tab) {
    return <>{children(statuses)}</>;
  }
  return (
    <WorkspaceTabPresentationResolver tab={tab} serverId={serverId} workspaceId={workspaceId}>
      {(presentation) => (
        <PaneTabStatuses
          tabs={rest}
          activeTabId={activeTabId}
          statuses={[
            ...statuses,
            { bucket: presentation.statusBucket, active: tab.tabId === activeTabId },
          ]}
          serverId={serverId}
          workspaceId={workspaceId}
        >
          {children}
        </PaneTabStatuses>
      )}
    </WorkspaceTabPresentationResolver>
  );
}
