import { describe, expect, it } from "vitest";
import {
  startNewSessionAfterMissingHistory,
  type StartNewSessionPorts,
} from "./agent-session-missing-notice";
import type { WorkspaceDraftTabSetup } from "@/workspace-tabs/model";

function createPorts(overrides: Partial<StartNewSessionPorts> = {}) {
  const calls: string[] = [];
  let openedDraft: { draftId: string; setup?: WorkspaceDraftTabSetup } | null = null;
  let archivedAtApplied: string | null = null;
  let titledTabId: string | null = null;

  const ports: StartNewSessionPorts = {
    archiveAgent: async (agentId) => {
      calls.push(`archive:${agentId}`);
      return { archivedAt: "2026-11-22T12:00:00.000Z" };
    },
    unpinAndHideAgent: () => {
      calls.push("unpinAndHide");
    },
    replaceOrOpenDraftTab: (draftId, setup) => {
      calls.push(`replaceOrOpen:${draftId}`);
      openedDraft = { draftId, setup };
      return `draft_${draftId}`;
    },
    applyPreservedTabTitle: (tabId) => {
      calls.push(`applyTitle:${tabId}`);
      titledTabId = tabId;
    },
    applyArchivedResult: (archivedAt) => {
      calls.push("applyArchivedResult");
      archivedAtApplied = archivedAt;
    },
    evictTimeline: (agentId) => {
      calls.push(`evict:${agentId}`);
    },
    createDraftId: () => "draft-fresh-1",
    ...overrides,
  };

  return {
    ports,
    calls,
    getOpenedDraft: () => openedDraft,
    getArchivedAtApplied: () => archivedAtApplied,
    getTitledTabId: () => titledTabId,
  };
}

describe("startNewSessionAfterMissingHistory", () => {
  it("archives the dead agent, replaces or opens the draft tab, applies its title, and updates caches", async () => {
    const setup: WorkspaceDraftTabSetup = {
      provider: "claude",
      cwd: "/Users/legoless/Projects/legoless/finance",
      modeId: "bypassPermissions",
      model: "default",
      thinkingOptionId: null,
      featureValues: { fast_mode: false },
    };
    const harness = createPorts();

    await startNewSessionAfterMissingHistory({
      agentId: "agent-finance",
      setup,
      ports: harness.ports,
    });

    expect(harness.calls).toEqual([
      "archive:agent-finance",
      "unpinAndHide",
      "replaceOrOpen:draft-fresh-1",
      "applyTitle:draft_draft-fresh-1",
      "applyArchivedResult",
      "evict:agent-finance",
    ]);
    expect(harness.getArchivedAtApplied()).toBe("2026-11-22T12:00:00.000Z");
    expect(harness.getOpenedDraft()).toEqual({
      draftId: "draft-fresh-1",
      setup,
    });
    expect(harness.getTitledTabId()).toBe("draft_draft-fresh-1");
  });

  it("skips applying a tab title when no draft tab id is returned", async () => {
    const harness = createPorts({
      replaceOrOpenDraftTab: () => null,
    });

    await startNewSessionAfterMissingHistory({
      agentId: "agent-finance",
      ports: harness.ports,
    });

    expect(harness.calls).toEqual([
      "archive:agent-finance",
      "unpinAndHide",
      "applyArchivedResult",
      "evict:agent-finance",
    ]);
    expect(harness.getTitledTabId()).toBeNull();
  });

  it("leaves the tab untouched and propagates the error when archiving fails", async () => {
    const harness = createPorts({
      archiveAgent: async () => {
        throw new Error("Host disconnected");
      },
    });

    await expect(
      startNewSessionAfterMissingHistory({
        agentId: "agent-finance",
        ports: harness.ports,
      }),
    ).rejects.toThrow("Host disconnected");

    expect(harness.calls).toEqual([]);
    expect(harness.getOpenedDraft()).toBeNull();
  });
});
