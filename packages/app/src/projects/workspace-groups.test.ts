import { describe, expect, it } from "vitest";
import type { Agent, ProjectDescriptor, WorkspaceDescriptor } from "@/stores/session-store";
import type { WorkspaceLayout } from "@/stores/workspace-layout-actions";
import type { WorkspaceTab, WorkspaceTabTarget } from "@/workspace-tabs/model";
import {
  buildSidebarWorkspaceGroupModel,
  preserveSidebarWorkspaceGroupModelIdentity,
  type SidebarWorkspaceGroupSession,
} from "./workspace-groups";

function tab(input: {
  tabId: string;
  target: WorkspaceTabTarget;
  createdAt: number;
}): WorkspaceTab {
  return { tabId: input.tabId, target: input.target, createdAt: input.createdAt };
}

/** `collectAllTabs` reads the pane's internal `tabs` array, which `SplitPane` does not declare. */
function layout(tabs: WorkspaceTab[]): WorkspaceLayout {
  const pane = { id: "main", tabIds: tabs.map((entry) => entry.tabId), focusedTabId: null, tabs };
  return {
    root: { kind: "pane", pane } as unknown as WorkspaceLayout["root"],
    focusedPaneId: "main",
  };
}

function member(input: {
  projectId: string;
  projectDisplayName: string;
  projectCustomName?: string | null;
  workspaceDirectory: string;
  branch?: string | null;
}): WorkspaceDescriptor["members"][number] {
  return {
    projectId: input.projectId,
    projectDisplayName: input.projectDisplayName,
    projectCustomName: input.projectCustomName ?? null,
    projectRootPath: `/repo/${input.projectId}`,
    workspaceDirectory: input.workspaceDirectory,
    workspaceKind: "worktree",
    worktreeSlug: null,
    branch: input.branch ?? null,
  };
}

function workspace(input: {
  id: string;
  members: WorkspaceDescriptor["members"];
}): WorkspaceDescriptor {
  const primary = input.members[0];
  if (!primary) {
    throw new Error("workspace requires at least one member");
  }
  return {
    id: input.id,
    projectId: primary.projectId,
    projectDisplayName: primary.projectDisplayName,
    projectRootPath: primary.projectRootPath,
    workspaceDirectory: primary.workspaceDirectory,
    projectKind: "git",
    workspaceKind: "worktree",
    name: input.id,
    status: "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
    members: input.members,
  };
}

function agent(input: {
  id: string;
  workspaceId: string;
  cwd: string;
  status?: Agent["status"];
  title?: string | null;
  lastActivityAt?: Date;
  archivedAt?: Date | null;
  parentAgentId?: string | null;
  pendingPermissions?: Agent["pendingPermissions"];
  requiresAttention?: boolean;
  attentionReason?: Agent["attentionReason"];
  labels?: Agent["labels"];
}): Agent {
  return {
    serverId: "srv",
    id: input.id,
    provider: "claude" as Agent["provider"],
    status: input.status ?? "idle",
    activeTurn: null,
    createdAt: new Date(0),
    updatedAt: new Date(1_000),
    lastUserMessageAt: null,
    lastActivityAt: input.lastActivityAt ?? new Date(1_000),
    capabilities: {} as Agent["capabilities"],
    currentModeId: null,
    availableModes: [],
    pendingPermissions: input.pendingPermissions ?? [],
    persistence: null,
    title: input.title ?? null,
    cwd: input.cwd,
    workspaceId: input.workspaceId,
    model: null,
    parentAgentId: input.parentAgentId ?? null,
    archivedAt: input.archivedAt ?? null,
    requiresAttention: input.requiresAttention,
    attentionReason: input.attentionReason,
    labels: input.labels ?? {},
  };
}

function project(input: {
  projectId: string;
  customIconRevision?: string | null;
  iconRevision?: string;
}): ProjectDescriptor {
  return {
    projectId: input.projectId,
    projectDisplayName: input.projectId,
    projectCustomName: null,
    projectCustomIconRevision: input.customIconRevision ?? null,
    projectIconRevision: input.iconRevision,
    projectRootPath: `/repo/${input.projectId}`,
    projectKind: "git",
  };
}

function session(input: {
  serverId?: string;
  workspaces: WorkspaceDescriptor[];
  agents?: Agent[];
  projects?: ProjectDescriptor[];
}): SidebarWorkspaceGroupSession {
  return {
    serverId: input.serverId ?? "srv",
    workspaces: new Map(input.workspaces.map((entry) => [entry.id, entry])),
    agents: new Map((input.agents ?? []).map((entry) => [entry.id, entry])),
    projects: new Map((input.projects ?? []).map((entry) => [entry.projectId, entry])),
  };
}

const TWO_PROJECT_WORKSPACE = workspace({
  id: "ws-1",
  members: [
    member({
      projectId: "project-b",
      projectDisplayName: "Project B",
      workspaceDirectory: "/repo/project-b/ws-1",
      branch: "main",
    }),
    member({
      projectId: "project-a",
      projectDisplayName: "Project A",
      workspaceDirectory: "/repo/project-a/ws-1",
      branch: "feature",
    }),
  ],
});

describe("buildSidebarWorkspaceGroupModel", () => {
  it("builds a section per workspace with members sorted by project name", () => {
    const model = buildSidebarWorkspaceGroupModel({
      sessions: [session({ workspaces: [TWO_PROJECT_WORKSPACE] })],
    });

    const section = model.sectionsByWorkspaceKey.get("srv:ws-1");
    expect(section?.workspaceId).toBe("ws-1");
    expect(section?.members.map((entry) => entry.projectId)).toEqual(["project-a", "project-b"]);
    expect(section?.members[0]).toMatchObject({
      projectName: "Project A",
      isPrimary: false,
    });
    expect(section?.members[1]).toMatchObject({
      projectName: "Project B",
      isPrimary: true,
    });
  });

  it("prefers the member's custom project name", () => {
    const model = buildSidebarWorkspaceGroupModel({
      sessions: [
        session({
          workspaces: [
            workspace({
              id: "ws-1",
              members: [
                member({
                  projectId: "project-a",
                  projectDisplayName: "acme/app",
                  projectCustomName: "App",
                  workspaceDirectory: "/repo/app",
                }),
              ],
            }),
          ],
        }),
      ],
    });

    expect(model.sectionsByWorkspaceKey.get("srv:ws-1")?.members[0]?.projectName).toBe("App");
  });

  it("buckets agents into the member whose directory matches their cwd", () => {
    const model = buildSidebarWorkspaceGroupModel({
      sessions: [
        session({
          workspaces: [TWO_PROJECT_WORKSPACE],
          agents: [
            agent({
              id: "agent-a",
              workspaceId: "ws-1",
              cwd: "/repo/project-a/ws-1/",
              title: "In A",
              labels: {
                "paseo.workspace-label.urgent": "Urgent",
                surface: "cli",
              },
            }),
            agent({
              id: "agent-b",
              workspaceId: "ws-1",
              cwd: "/repo/project-b/ws-1",
              title: "In B",
            }),
          ],
        }),
      ],
    });

    const section = model.sectionsByWorkspaceKey.get("srv:ws-1");
    const memberA = section?.members.find((entry) => entry.projectId === "project-a");
    const memberB = section?.members.find((entry) => entry.projectId === "project-b");
    expect(memberA?.agents.map((entry) => entry.agentId)).toEqual(["agent-a"]);
    expect(memberB?.agents.map((entry) => entry.agentId)).toEqual(["agent-b"]);
    expect(memberA?.agents[0]?.matchesMemberDirectory).toBe(true);
    expect(memberA?.agents[0]?.labels).toEqual(["Urgent"]);
  });

  it("carries the member's live diff stat onto its row", () => {
    const withDiff = workspace({
      id: "ws-1",
      members: [
        {
          ...member({
            projectId: "project-a",
            projectDisplayName: "Project A",
            workspaceDirectory: "/repo/project-a/ws-1",
          }),
          diffStat: { additions: 12, deletions: 3 },
        },
      ],
    });
    const model = buildSidebarWorkspaceGroupModel({
      sessions: [session({ workspaces: [withDiff] })],
    });

    const section = model.sectionsByWorkspaceKey.get("srv:ws-1");
    expect(section?.members[0]?.diffStat).toEqual({ additions: 12, deletions: 3 });
  });

  it("sends agents whose cwd matches no member to the uncategorized bucket", () => {
    const model = buildSidebarWorkspaceGroupModel({
      sessions: [
        session({
          workspaces: [TWO_PROJECT_WORKSPACE],
          agents: [
            agent({
              id: "stray",
              workspaceId: "ws-1",
              cwd: "/somewhere/else",
            }),
          ],
        }),
      ],
    });

    const section = model.sectionsByWorkspaceKey.get("srv:ws-1");
    expect(section?.members.every((entry) => entry.agents.length === 0)).toBe(true);
    expect(section?.uncategorized.memberKey).toBe("srv:ws-1#uncategorized");
    expect(section?.uncategorized.agents.map((entry) => entry.agentId)).toEqual(["stray"]);
    expect(section?.uncategorized.agents[0]?.cwd).toBe("/somewhere/else");
    expect(section?.uncategorized.agents[0]?.cwdLabel).toBe("/somewhere/else");
    expect(section?.uncategorized.agents[0]?.matchesMemberDirectory).toBe(false);
  });

  it("ignores launcher panes and leaves unpinned drafts uncategorized", () => {
    const model = buildSidebarWorkspaceGroupModel({
      sessions: [session({ workspaces: [TWO_PROJECT_WORKSPACE] })],
      layoutsByWorkspace: {
        "srv:ws-1": layout([
          tab({ tabId: "tab_launcher", target: { kind: "new_tab" }, createdAt: 1 }),
          tab({
            tabId: "tab_draft",
            target: { kind: "draft", draftId: "draft-1" },
            createdAt: 2,
          }),
        ]),
      },
    });

    const section = model.sectionsByWorkspaceKey.get("srv:ws-1");
    expect(section?.members.every((entry) => (entry.newAgents ?? []).length === 0)).toBe(true);
    expect(section?.uncategorized.newAgents?.map((entry) => entry.tabId)).toEqual(["tab_draft"]);
    expect(section?.uncategorized.newAgents?.[0]).toMatchObject({
      cwd: "",
      cwdLabel: "",
      matchesMemberDirectory: false,
    });
  });

  it("gives an empty workspace of launcher panes no rows at all", () => {
    const model = buildSidebarWorkspaceGroupModel({
      sessions: [session({ workspaces: [TWO_PROJECT_WORKSPACE] })],
      layoutsByWorkspace: {
        "srv:ws-1": layout([
          tab({ tabId: "tab_a", target: { kind: "new_tab" }, createdAt: 1 }),
          tab({ tabId: "tab_b", target: { kind: "new_tab" }, createdAt: 2 }),
          tab({ tabId: "tab_c", target: { kind: "terminal", terminalId: "term-1" }, createdAt: 3 }),
        ]),
      },
    });

    const section = model.sectionsByWorkspaceKey.get("srv:ws-1");
    expect(section?.uncategorized.newAgents).toBeUndefined();
    expect(section?.uncategorized.agents).toEqual([]);
    expect(section?.members.every((entry) => (entry.newAgents ?? []).length === 0)).toBe(true);
  });

  it("buckets a draft into the member matching the project it chose", () => {
    const model = buildSidebarWorkspaceGroupModel({
      sessions: [session({ workspaces: [TWO_PROJECT_WORKSPACE] })],
      layoutsByWorkspace: {
        "srv:ws-1": layout([
          tab({
            tabId: "tab_chosen",
            createdAt: 1,
            target: { kind: "draft", draftId: "draft-1", cwd: "/repo/project-a/ws-1" },
          }),
          tab({
            tabId: "tab_pinned",
            createdAt: 2,
            target: {
              kind: "draft",
              draftId: "draft-2",
              setup: {
                provider: "claude",
                cwd: "/repo/project-b/ws-1",
                modeId: null,
                model: null,
                thinkingOptionId: null,
                featureValues: {},
              },
            },
          }),
          tab({
            tabId: "tab_elsewhere",
            createdAt: 3,
            target: { kind: "draft", draftId: "draft-3", cwd: "/home/user" },
          }),
        ]),
      },
    });

    const section = model.sectionsByWorkspaceKey.get("srv:ws-1");
    const memberA = section?.members.find((entry) => entry.projectId === "project-a");
    const memberB = section?.members.find((entry) => entry.projectId === "project-b");
    expect(memberA?.newAgents?.map((entry) => entry.tabId)).toEqual(["tab_chosen"]);
    expect(memberA?.newAgents?.[0]?.matchesMemberDirectory).toBe(true);
    expect(memberB?.newAgents?.map((entry) => entry.tabId)).toEqual(["tab_pinned"]);
    expect(section?.uncategorized.newAgents?.map((entry) => entry.tabId)).toEqual([
      "tab_elsewhere",
    ]);
    // The launcher's "No project" is the daemon user's home, which `shortenPath` renders as ~.
    expect(section?.uncategorized.newAgents?.[0]?.cwdLabel).toBe("~");
  });

  it("excludes archived agents and agents of other workspaces, keeps subagents", () => {
    const model = buildSidebarWorkspaceGroupModel({
      sessions: [
        session({
          workspaces: [TWO_PROJECT_WORKSPACE],
          agents: [
            agent({
              id: "archived",
              workspaceId: "ws-1",
              cwd: "/repo/project-a/ws-1",
              archivedAt: new Date(2_000),
            }),
            agent({
              id: "other-workspace",
              workspaceId: "ws-2",
              cwd: "/repo/project-a/ws-1",
            }),
            agent({
              id: "subagent",
              workspaceId: "ws-1",
              cwd: "/repo/project-a/ws-1",
              parentAgentId: "agent-a",
            }),
          ],
        }),
      ],
    });

    const section = model.sectionsByWorkspaceKey.get("srv:ws-1");
    const memberA = section?.members.find((entry) => entry.projectId === "project-a");
    expect(memberA?.agents.map((entry) => entry.agentId)).toEqual(["subagent"]);
  });

  it("sorts agents by most recent activity first", () => {
    const model = buildSidebarWorkspaceGroupModel({
      sessions: [
        session({
          workspaces: [TWO_PROJECT_WORKSPACE],
          agents: [
            agent({
              id: "older",
              workspaceId: "ws-1",
              cwd: "/repo/project-a/ws-1",
              lastActivityAt: new Date(1_000),
            }),
            agent({
              id: "newer",
              workspaceId: "ws-1",
              cwd: "/repo/project-a/ws-1",
              lastActivityAt: new Date(5_000),
            }),
          ],
        }),
      ],
    });

    const memberA = model.sectionsByWorkspaceKey
      .get("srv:ws-1")
      ?.members.find((entry) => entry.projectId === "project-a");
    expect(memberA?.agents.map((entry) => entry.agentId)).toEqual(["newer", "older"]);
  });

  it("derives the agent status bucket from permissions, status, and attention", () => {
    const pendingPermission = { id: "perm-1" } as Agent["pendingPermissions"][number];
    const model = buildSidebarWorkspaceGroupModel({
      sessions: [
        session({
          workspaces: [TWO_PROJECT_WORKSPACE],
          agents: [
            agent({
              id: "needs-input",
              workspaceId: "ws-1",
              cwd: "/repo/project-a/ws-1",
              pendingPermissions: [pendingPermission],
            }),
            agent({
              id: "running",
              workspaceId: "ws-1",
              cwd: "/repo/project-a/ws-1",
              status: "running",
            }),
            agent({
              id: "review",
              workspaceId: "ws-1",
              cwd: "/repo/project-a/ws-1",
              requiresAttention: true,
              attentionReason: "finished",
            }),
          ],
        }),
      ],
    });

    const memberA = model.sectionsByWorkspaceKey
      .get("srv:ws-1")
      ?.members.find((entry) => entry.projectId === "project-a");
    const buckets = new Map(memberA?.agents.map((entry) => [entry.agentId, entry.statusBucket]));
    expect(buckets.get("needs-input")).toBe("needs_input");
    expect(buckets.get("running")).toBe("running");
    expect(buckets.get("review")).toBe("attention");
  });

  it("falls back to a placeholder title when the agent has none", () => {
    const model = buildSidebarWorkspaceGroupModel({
      sessions: [
        session({
          workspaces: [TWO_PROJECT_WORKSPACE],
          agents: [agent({ id: "untitled", workspaceId: "ws-1", cwd: "/repo/project-a/ws-1" })],
        }),
      ],
    });

    const memberA = model.sectionsByWorkspaceKey
      .get("srv:ws-1")
      ?.members.find((entry) => entry.projectId === "project-a");
    expect(memberA?.agents[0]?.title).toBe("Untitled agent");
  });

  it("creates one icon target per member with revisions from the project registry", () => {
    const model = buildSidebarWorkspaceGroupModel({
      sessions: [
        session({
          workspaces: [TWO_PROJECT_WORKSPACE],
          projects: [
            project({ projectId: "project-a", customIconRevision: "custom-1" }),
            project({ projectId: "project-b", iconRevision: "auto-2" }),
          ],
        }),
      ],
    });

    expect(model.memberIconTargets).toEqual([
      {
        projectViewKey: "srv:ws-1#/repo/project-b/ws-1",
        serverId: "srv",
        projectId: "project-b",
        iconWorkingDir: "/repo/project-b",
        customIconRevision: null,
        iconRevision: "auto-2",
      },
      {
        projectViewKey: "srv:ws-1#/repo/project-a/ws-1",
        serverId: "srv",
        projectId: "project-a",
        iconWorkingDir: "/repo/project-a",
        customIconRevision: "custom-1",
        iconRevision: undefined,
      },
    ]);
  });

  it("spans workspaces across hosts", () => {
    const model = buildSidebarWorkspaceGroupModel({
      sessions: [
        session({ serverId: "host-a", workspaces: [TWO_PROJECT_WORKSPACE] }),
        session({
          serverId: "host-b",
          workspaces: [
            workspace({
              id: "ws-9",
              members: [
                member({
                  projectId: "project-c",
                  projectDisplayName: "Project C",
                  workspaceDirectory: "/repo/project-c/ws-9",
                }),
              ],
            }),
          ],
        }),
      ],
    });

    expect([...model.sectionsByWorkspaceKey.keys()].sort()).toEqual(["host-a:ws-1", "host-b:ws-9"]);
  });
});

describe("preserveSidebarWorkspaceGroupModelIdentity", () => {
  function buildModel(agents: Agent[] = []) {
    return buildSidebarWorkspaceGroupModel({
      sessions: [session({ workspaces: [TWO_PROJECT_WORKSPACE], agents })],
    });
  }

  it("returns the previous model when nothing rendered changed", () => {
    const agents = [agent({ id: "agent-a", workspaceId: "ws-1", cwd: "/repo/project-a/ws-1" })];
    const previous = buildModel(agents);
    const clonedAgents = agents.map((entry) => Object.assign({}, entry));
    const next = buildModel(clonedAgents);

    expect(preserveSidebarWorkspaceGroupModelIdentity(previous, next)).toBe(previous);
  });

  it("rebuilds only the section whose rendered fields changed", () => {
    const other = workspace({
      id: "ws-2",
      members: [
        member({
          projectId: "project-c",
          projectDisplayName: "Project C",
          workspaceDirectory: "/repo/project-c/ws-2",
        }),
      ],
    });
    const build = (agents: Agent[]) =>
      buildSidebarWorkspaceGroupModel({
        sessions: [session({ workspaces: [TWO_PROJECT_WORKSPACE, other], agents })],
      });
    const previous = build([
      agent({ id: "agent-a", workspaceId: "ws-1", cwd: "/repo/project-a/ws-1" }),
    ]);
    const next = build([
      agent({
        id: "agent-a",
        workspaceId: "ws-1",
        cwd: "/repo/project-a/ws-1",
        title: "Renamed",
      }),
    ]);

    const preserved = preserveSidebarWorkspaceGroupModelIdentity(previous, next);
    expect(preserved).not.toBe(previous);
    expect(preserved.sectionsByWorkspaceKey.get("srv:ws-2")).toBe(
      previous.sectionsByWorkspaceKey.get("srv:ws-2"),
    );
    expect(preserved.sectionsByWorkspaceKey.get("srv:ws-1")).not.toBe(
      previous.sectionsByWorkspaceKey.get("srv:ws-1"),
    );
    expect(
      preserved.sectionsByWorkspaceKey
        .get("srv:ws-1")
        ?.members.find((entry) => entry.projectId === "project-a")?.agents[0]?.title,
    ).toBe("Renamed");
  });

  it("rebuilds a section when a member's diff stat moves", () => {
    const withDiffStat = (diffStat: { additions: number; deletions: number } | null) =>
      workspace({
        id: "ws-1",
        members: TWO_PROJECT_WORKSPACE.members.map((entry, index) =>
          index === 0 ? Object.assign({}, entry, { diffStat }) : entry,
        ),
      });
    const previous = buildSidebarWorkspaceGroupModel({
      sessions: [session({ workspaces: [withDiffStat(null)] })],
    });
    const next = buildSidebarWorkspaceGroupModel({
      sessions: [session({ workspaces: [withDiffStat({ additions: 4, deletions: 1 })] })],
    });

    const preserved = preserveSidebarWorkspaceGroupModelIdentity(previous, next);
    expect(preserved).not.toBe(previous);
    expect(
      preserved.sectionsByWorkspaceKey
        .get("srv:ws-1")
        ?.members.find((entry) => entry.projectId === "project-b")?.diffStat,
    ).toEqual({ additions: 4, deletions: 1 });
  });
});
