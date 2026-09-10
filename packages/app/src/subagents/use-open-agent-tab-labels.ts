import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { getOpenAgentTabLabel } from "@getpaseo/protocol/agent-labels";
import { useEffect, useRef, useState } from "react";
import { useSessionStore } from "@/stores/session-store";
import { getOrCreateClientId } from "@/utils/client-id";
import { isNotFoundErrorMessage, toErrorMessage } from "@/utils/error-messages";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import { getAgentTabsNeedingOpenLabel } from "./open-tab-labels";

function increment(value: number): number {
  return value + 1;
}

export function useOpenAgentTabLabels(input: {
  client: DaemonClient | null;
  serverId: string;
  tabs: WorkspaceTab[];
  enabled: boolean;
}): void {
  const agents = useSessionStore((state) => state.sessions[input.serverId]?.agents ?? null);
  const agentDetails = useSessionStore(
    (state) => state.sessions[input.serverId]?.agentDetails ?? null,
  );
  const pendingAgentIdsRef = useRef(new Set<string>());
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(
    () => () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const client = input.client;
    if (!client || !input.enabled) {
      return;
    }

    const openAgentIds = new Set(
      input.tabs.flatMap((tab) => (tab.target.kind === "agent" ? [tab.target.agentId] : [])),
    );
    for (const agentId of pendingAgentIdsRef.current) {
      if (!openAgentIds.has(agentId)) {
        pendingAgentIdsRef.current.delete(agentId);
      }
    }
    if (openAgentIds.size === 0) {
      return;
    }

    void (async () => {
      try {
        const clientId = await getOrCreateClientId();
        const label = getOpenAgentTabLabel(clientId);
        const agentIds = getAgentTabsNeedingOpenLabel({
          tabs: input.tabs,
          getAgent: (agentId) => agents?.get(agentId) ?? agentDetails?.get(agentId),
          label,
          pendingAgentIds: pendingAgentIdsRef.current,
        });
        for (const agentId of agentIds) {
          pendingAgentIdsRef.current.add(agentId);
          try {
            await client.updateAgent(agentId, { labels: { [label]: "true" } });
            pendingAgentIdsRef.current.delete(agentId);
          } catch (error) {
            console.warn("[OpenAgentTabLabels] Failed to mark open subagent tab", {
              error,
              agentId,
            });
            if (isNotFoundErrorMessage(toErrorMessage(error))) {
              // The agent is gone. Leaving the id in the pending set keeps it out of every later
              // selection, so a stale tab stops re-asking forever; the prune above releases it if
              // the tab is ever closed. Retrying a deleted agent only spams the daemon log.
              continue;
            }
            pendingAgentIdsRef.current.delete(agentId);
            retryTimerRef.current ??= setTimeout(() => {
              retryTimerRef.current = null;
              setRetryVersion(increment);
            }, 2_000);
          }
        }
      } catch (error) {
        console.warn("[OpenAgentTabLabels] Failed to resolve client ID", { error });
      }
    })();
  }, [agentDetails, agents, input.client, input.enabled, input.tabs, retryVersion]);
}
