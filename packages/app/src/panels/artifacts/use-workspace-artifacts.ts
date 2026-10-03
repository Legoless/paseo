import { useEffect, useRef, useState } from "react";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import {
  useSessionStore,
  type Agent,
  type AgentTimelineCursorState,
  type SessionState,
} from "@/stores/session-store";
import { resolveAgentImageFallbackRoot } from "@/utils/assistant-image-source";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import {
  collectAgentStreamItems,
  selectLatestArtifactImageKey,
  selectWorkspaceArtifacts,
  type ArtifactAgentInput,
  type ArtifactEntry,
  type ArtifactImageHistory,
} from "./select";

const NO_IMAGE_KEYS: Record<string, string> = {};

// Streaming output moves an image message's position on every chunk; wait for it to settle.
const IMAGE_HISTORY_REFRESH_DELAY_MS = 750;

export function useWorkspaceArtifacts(input: {
  serverId: string;
  workspaceId: string;
  active: boolean;
}): ArtifactEntry[] {
  const { serverId, workspaceId, active } = input;
  const [imageHistory, setImageHistory] = useState<Record<string, ArtifactImageHistory>>({});
  const entries = useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectWorkspaceArtifactEntries(state.sessions[serverId], workspaceId, imageHistory),
    equal,
  );
  // Scanning every agent's stream for images is only worth it while the panel is open.
  const latestImageKeys = useStoreWithEqualityFn(
    useSessionStore,
    (state) =>
      active
        ? selectWorkspaceLatestImageKeys(state.sessions[serverId], workspaceId)
        : NO_IMAGE_KEYS,
    equal,
  );
  const supportsImageHistory = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.agentTimelineImages === true,
  );
  const requestedImageKeysRef = useRef(new Map<string, string>());
  const imageRequestIdsRef = useRef(new Map<string, number>());
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

  // The loaded stream holds only each agent's newest rows, so the daemon supplies the full image
  // list: once per agent, and again when the stream shows an image message the list may lack.
  useEffect(() => {
    const requested = requestedImageKeysRef.current;
    if (!active || !supportsImageHistory) {
      requested.clear();
      return;
    }
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client) {
      return;
    }
    const stale = Object.entries(latestImageKeys).filter(
      ([agentId, key]) => requested.get(agentId) !== key,
    );
    if (stale.length === 0) {
      return;
    }
    const firstLoad = stale.some(([agentId]) => !requested.has(agentId));
    const timer = setTimeout(
      () => {
        for (const [agentId, key] of stale) {
          requested.set(agentId, key);
          const requestId = (imageRequestIdsRef.current.get(agentId) ?? 0) + 1;
          imageRequestIdsRef.current.set(agentId, requestId);
          void client
            .listAgentTimelineImages(agentId)
            .then(({ epoch, images }) => {
              if (imageRequestIdsRef.current.get(agentId) === requestId) {
                setImageHistory(withAgentImageHistory(agentId, { epoch, images }));
              }
              return undefined;
            })
            .catch(() => {
              // Forget the attempt so the next stream change or reopening asks again.
              if (imageRequestIdsRef.current.get(agentId) === requestId) {
                requested.delete(agentId);
              }
            });
        }
      },
      firstLoad ? 0 : IMAGE_HISTORY_REFRESH_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [active, latestImageKeys, serverId, supportsImageHistory]);

  return entries;
}

function withAgentImageHistory(agentId: string, history: ArtifactImageHistory) {
  return (current: Record<string, ArtifactImageHistory>) => ({ ...current, [agentId]: history });
}

function selectWorkspaceArtifactEntries(
  session: SessionState | undefined,
  workspaceId: string,
  historyByAgentId: Readonly<Record<string, ArtifactImageHistory>>,
): ArtifactEntry[] {
  if (!session) {
    return [];
  }
  const agents: ArtifactAgentInput[] = [];
  const streamsByAgentId: Record<string, ReturnType<typeof collectAgentStreamItems>> = {};
  const loadedRangeByAgentId: Record<string, AgentTimelineCursorState | undefined> = {};
  for (const sessionAgent of session.agents.values()) {
    if (!isCurrentWorkspaceAgent(sessionAgent, workspaceId)) {
      continue;
    }
    agents.push(toArtifactAgent(sessionAgent));
    loadedRangeByAgentId[sessionAgent.id] = session.agentTimelineCursor.get(sessionAgent.id);
    streamsByAgentId[sessionAgent.id] = collectAgentStreamItems({
      tail: session.agentStreamTail.get(sessionAgent.id) ?? [],
      head: session.agentStreamHead.get(sessionAgent.id) ?? [],
    });
  }
  return selectWorkspaceArtifacts({
    workspaceId,
    agents,
    streamsByAgentId,
    historyByAgentId,
    loadedRangeByAgentId,
  });
}

function selectWorkspaceLatestImageKeys(
  session: SessionState | undefined,
  workspaceId: string,
): Record<string, string> {
  const keys: Record<string, string> = {};
  if (!session) {
    return keys;
  }
  for (const sessionAgent of session.agents.values()) {
    if (!isCurrentWorkspaceAgent(sessionAgent, workspaceId)) {
      continue;
    }
    keys[sessionAgent.id] = selectLatestArtifactImageKey(
      collectAgentStreamItems({
        tail: session.agentStreamTail.get(sessionAgent.id) ?? [],
        head: session.agentStreamHead.get(sessionAgent.id) ?? [],
      }),
    );
  }
  return keys;
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
    imageFallbackRoot: resolveAgentImageFallbackRoot(agent),
  };
}
