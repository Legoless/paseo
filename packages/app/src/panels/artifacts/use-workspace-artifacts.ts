import { useEffect } from "react";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore, type Agent, type SessionState } from "@/stores/session-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import {
  collectAgentStreamItems,
  selectWorkspaceArtifacts,
  type ArtifactAgentInput,
  type ArtifactEntry,
} from "./select";

export function useWorkspaceArtifacts(input: {
  serverId: string;
  workspaceId: string;
  active: boolean;
}): ArtifactEntry[] {
  const { serverId, workspaceId, active } = input;
  const entries = useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectWorkspaceArtifactEntries(state.sessions[serverId], workspaceId),
    equal,
  );
  const demandedAgentIds = useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectWorkspaceArtifactAgentIds(state.sessions[serverId], workspaceId),
    equal,
  );
  const viewedTimelineSync = useSessionStore(
    (state) => state.sessions[serverId]?.viewedTimelineSync ?? null,
  );

  useEffect(() => {
    if (!active) {
      return;
    }
    for (const agentId of demandedAgentIds) {
      void getHostRuntimeStore()
        .prepareAgentTimeline(serverId, agentId)
        .catch(() => undefined);
    }
  }, [active, demandedAgentIds, serverId]);

  useEffect(() => {
    const persistenceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
    if (!active || !persistenceKey || !viewedTimelineSync) {
      return;
    }
    const sourceId = `${persistenceKey}:artifacts`;
    viewedTimelineSync.replaceVisibleAgentIds(sourceId, demandedAgentIds);
    return () => {
      viewedTimelineSync.replaceVisibleAgentIds(sourceId, []);
    };
  }, [active, demandedAgentIds, serverId, viewedTimelineSync, workspaceId]);

  return entries;
}

function selectWorkspaceArtifactEntries(
  session: SessionState | undefined,
  workspaceId: string,
): ArtifactEntry[] {
  if (!session) {
    return [];
  }
  const agents: ArtifactAgentInput[] = [];
  const streamsByAgentId: Record<string, ReturnType<typeof collectAgentStreamItems>> = {};
  for (const sessionAgent of session.agents.values()) {
    if (!isCurrentWorkspaceAgent(sessionAgent, workspaceId)) {
      continue;
    }
    agents.push(toArtifactAgent(sessionAgent));
    streamsByAgentId[sessionAgent.id] = collectAgentStreamItems({
      tail: session.agentStreamTail.get(sessionAgent.id) ?? [],
      head: session.agentStreamHead.get(sessionAgent.id) ?? [],
    });
  }
  return selectWorkspaceArtifacts({
    workspaceId,
    agents,
    streamsByAgentId,
  });
}

function selectWorkspaceArtifactAgentIds(
  session: SessionState | undefined,
  workspaceId: string,
): string[] {
  if (!session) {
    return [];
  }
  return [...session.agents.values()]
    .filter((sessionAgent) => isCurrentWorkspaceAgent(sessionAgent, workspaceId))
    .map((sessionAgent) => sessionAgent.id)
    .sort();
}

function isCurrentWorkspaceAgent(agent: Agent, workspaceId: string): boolean {
  if (agent.archivedAt) {
    return false;
  }
  return (agent.workspaceId ?? "").trim() === workspaceId.trim();
}

function toArtifactAgent(agent: Agent): ArtifactAgentInput {
  return {
    id: agent.id,
    title: agent.title,
    cwd: agent.cwd,
    workspaceId: agent.workspaceId,
    archivedAt: agent.archivedAt,
  };
}
