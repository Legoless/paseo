import { useMemo } from "react";
import type { ProviderSubagentDescriptorPayload } from "@getpaseo/protocol/messages";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { useProviderSubagentStore } from "./provider-store";

function sameParentIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const id of left) {
    if (!right.has(id)) return false;
  }
  return true;
}

export function collectRunningPaseoChildParentIds(
  sessions: Readonly<Record<string, { agents?: ReadonlyMap<string, Agent> } | undefined>>,
  serverIds?: readonly string[],
): Set<string> {
  const parents = new Set<string>();
  for (const [serverId, session] of Object.entries(sessions)) {
    if (serverIds && !serverIds.includes(serverId)) continue;
    for (const agent of session?.agents?.values() ?? []) {
      if (!agent.parentAgentId || agent.archivedAt) continue;
      if (agent.turn.phase === "open") parents.add(agent.parentAgentId);
    }
  }
  return parents;
}

export function collectRunningProviderChildParentIds(
  descriptors: ReadonlyMap<string, ProviderSubagentDescriptorPayload>,
  hiddenFromTrack: ReadonlySet<string>,
  serverIds?: readonly string[],
): Set<string> {
  const parents = new Set<string>();
  for (const [key, subagent] of descriptors) {
    if (subagent.status !== "running" || hiddenFromTrack.has(key)) continue;
    if (serverIds && !serverIds.some((serverId) => key.startsWith(`${serverId}\0`))) continue;
    parents.add(subagent.parentAgentId);
  }
  return parents;
}

/**
 * Parent agents with a child that is still working, by the same rule the agent tab uses:
 * an open paseo turn, or a running provider subagent that is still on the track.
 *
 * The sidebar's status dot reads the parent agent's bucket. Without this set it sees
 * `requiresAttention` and paints the row green while the tab is blue because a child is
 * still running. Keep the two surfaces on the same signal.
 */
export function useRunningChildAgentIds(serverIds?: readonly string[]): ReadonlySet<string> {
  const paseoParentIds = useStoreWithEqualityFn(
    useSessionStore,
    (state) => collectRunningPaseoChildParentIds(state.sessions, serverIds),
    sameParentIds,
  );

  const providerParentIds = useStoreWithEqualityFn(
    useProviderSubagentStore,
    (state) =>
      collectRunningProviderChildParentIds(state.descriptors, state.hiddenFromTrack, serverIds),
    sameParentIds,
  );

  return useMemo(() => {
    if (paseoParentIds.size === 0) return providerParentIds;
    if (providerParentIds.size === 0) return paseoParentIds;
    const merged = new Set(paseoParentIds);
    for (const id of providerParentIds) merged.add(id);
    return merged;
  }, [paseoParentIds, providerParentIds]);
}
