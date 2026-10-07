import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { buildDraftPanelDescriptor } from "@/panels/draft-panel-descriptor";
import {
  resolveAgentPanelStatusBucket,
  resolveWorkspaceAgentTabLabel,
} from "@/panels/agent-panel-descriptor";

function TestIcon() {
  return null;
}

describe("buildDraftPanelDescriptor", () => {
  it("uses the initial prompt title and running loader bucket during create", () => {
    const descriptor = buildDraftPanelDescriptor({
      isCreating: true,
      pendingPrompt: "Build the dashboard",
      icon: TestIcon,
    });

    expect(descriptor).toMatchObject({
      label: "Build the dashboard",
      subtitle: "Creating agent",
      titleState: "ready",
      statusBucket: "running",
    });
  });

  it("falls back to the draft title for empty create prompts", () => {
    const descriptor = buildDraftPanelDescriptor({
      isCreating: true,
      pendingPrompt: "   ",
      icon: TestIcon,
    });

    expect(descriptor.label).toBe("New Agent");
  });

  it("keeps ordinary draft tabs labeled as new agents", () => {
    const descriptor = buildDraftPanelDescriptor({ isCreating: false, icon: TestIcon });

    expect(descriptor).toMatchObject({
      label: "New Agent",
      subtitle: "New Agent",
      titleState: "ready",
      statusBucket: null,
    });
  });

  it("uses the active language for draft descriptor chrome", async () => {
    await i18n.changeLanguage("zh-CN");
    const idleDescriptor = buildDraftPanelDescriptor({
      isCreating: false,
      icon: TestIcon,
    });
    const creatingDescriptor = buildDraftPanelDescriptor({
      isCreating: true,
      pendingPrompt: "   ",
      icon: TestIcon,
    });

    expect(idleDescriptor).toMatchObject({
      label: "新建 Agent",
      subtitle: "新建 Agent",
    });
    expect(creatingDescriptor).toMatchObject({
      label: "新建 Agent",
      subtitle: "正在创建 Agent",
    });
    await i18n.changeLanguage("en");
  });
});

describe("resolveWorkspaceAgentTabLabel", () => {
  it("shimmers only while the agent has no title", () => {
    expect(resolveWorkspaceAgentTabLabel(null)).toBe(null);
    expect(resolveWorkspaceAgentTabLabel(undefined)).toBe(null);
    expect(resolveWorkspaceAgentTabLabel("   ")).toBe(null);
  });

  it("keeps a renamed tab's name, including the draft placeholder wording", () => {
    expect(resolveWorkspaceAgentTabLabel("  Ship the release  ")).toBe("Ship the release");
    expect(resolveWorkspaceAgentTabLabel("New Agent")).toBe("New Agent");
    expect(resolveWorkspaceAgentTabLabel("new agent")).toBe("new agent");
  });
});

describe("resolveAgentPanelStatusBucket", () => {
  const idleParent = {
    status: "idle",
    isTurnActive: false,
    pendingPermissionCount: 0,
    backgroundWorkCount: undefined,
    requiresAttention: false,
    attentionReason: null,
    hasRunningChild: false,
  } as const;

  it("stays running while a child works even with the parent's own turn closed", () => {
    expect(resolveAgentPanelStatusBucket({ ...idleParent, hasRunningChild: true })).toBe("running");
    expect(resolveAgentPanelStatusBucket(idleParent)).toBe("done");
  });

  it("keeps a finished parent working until its last child is done", () => {
    const finished = {
      ...idleParent,
      requiresAttention: true,
      attentionReason: "finished",
    } as const;

    expect(resolveAgentPanelStatusBucket(finished)).toBe("attention");
    expect(resolveAgentPanelStatusBucket({ ...finished, hasRunningChild: true })).toBe("running");
  });

  it("lets needs_input and unseen failures outrank a running child", () => {
    expect(
      resolveAgentPanelStatusBucket({
        ...idleParent,
        pendingPermissionCount: 1,
        hasRunningChild: true,
      }),
    ).toBe("needs_input");
    expect(
      resolveAgentPanelStatusBucket({
        ...idleParent,
        status: "error",
        requiresAttention: true,
        attentionReason: "error",
        hasRunningChild: true,
      }),
    ).toBe("failed");
  });

  it("has no bucket before the agent status lands", () => {
    expect(resolveAgentPanelStatusBucket({ ...idleParent, status: null })).toBeNull();
  });
});
