import { default as React, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import { MenuHint, MenuItem, type MenuPageDefinition } from "@/components/ui/menu";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { selectAgentMoveWorkspaceTargets } from "@/stores/session-store-hooks/selectors";
import { useMoveAgentWorkspace } from "@/workspaces/use-move-agent-workspace";

export const MOVE_AGENT_PAGE_ID = "moveAgentWorkspace";

const NO_PAGES: readonly MenuPageDefinition[] = [];

export interface MoveAgentMenuTarget {
  serverId: string;
  sourceWorkspaceId: string;
  agentId: string;
  cwd: string;
  agentTitle: string;
}

export function useMoveAgentMenuPages(target: MoveAgentMenuTarget): readonly MenuPageDefinition[] {
  const { t } = useTranslation();
  // COMPAT(agentWorkspaceMove): added in v0.8.0, remove gate after 2028-03-01.
  const canMove = useHostFeature(target.serverId, "agentWorkspaceMove");
  return useMemo(() => {
    if (!canMove || !target.cwd) return NO_PAGES;
    return [
      {
        id: MOVE_AGENT_PAGE_ID,
        title: t("sidebar.project.actions.moveToWorkspace"),
        content: <MoveAgentPage target={target} />,
      },
    ];
  }, [canMove, t, target]);
}

function MoveAgentPage({ target }: { target: MoveAgentMenuTarget }): React.ReactElement {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(target.serverId);
  const moveAgent = useMoveAgentWorkspace();
  const candidates = useSessionStore(
    useShallow((state) => selectAgentMoveWorkspaceTargets(state, target)),
  );
  const handleSelect = useCallback(
    (workspaceId: string) => {
      const workspace = candidates.find((candidate) => candidate.id === workspaceId);
      if (!workspace) return;
      void moveAgent({
        client,
        serverId: target.serverId,
        agentId: target.agentId,
        sourceWorkspaceId: target.sourceWorkspaceId,
        targetWorkspaceId: workspace.id,
        agentTitle: target.agentTitle,
        targetTitle: workspace.title?.trim() || workspace.name,
        sourceMemberKey: `${target.serverId}:${target.sourceWorkspaceId}#${target.cwd}`,
        targetMemberKey: `${target.serverId}:${workspace.id}#${target.cwd}`,
      });
    },
    [candidates, client, moveAgent, target],
  );

  return (
    <>
      {candidates.map((workspace) => (
        <MoveAgentRow
          key={workspace.id}
          workspaceId={workspace.id}
          title={workspace.title?.trim() || workspace.name}
          onSelect={handleSelect}
        />
      ))}
      {candidates.length === 0 ? (
        <MenuHint>{t("sidebar.project.actions.noOtherWorkspaces")}</MenuHint>
      ) : null}
    </>
  );
}

function MoveAgentRow({
  workspaceId,
  title,
  onSelect,
}: {
  workspaceId: string;
  title: string;
  onSelect: (workspaceId: string) => void;
}): React.ReactElement {
  const handleSelect = useCallback(() => onSelect(workspaceId), [onSelect, workspaceId]);
  return (
    <MenuItem testID={`sidebar-agent-menu-move-${workspaceId}`} onSelect={handleSelect}>
      {title}
    </MenuItem>
  );
}
