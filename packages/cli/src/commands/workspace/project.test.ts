import { homedir } from "node:os";
import path from "node:path";
import type {
  WorkspaceDescriptorPayload,
  WorkspaceMemberAddRequest,
  WorkspaceProjectDescriptorPayload,
} from "@getpaseo/protocol/messages";
import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import type { DaemonTarget } from "../../utils/daemon-target.js";
import { createWorkspaceCommand } from "./index.js";
import {
  extractWorkspaceProjects,
  runWorkspaceProjectAddCommand,
  runWorkspaceProjectLsCommand,
  runWorkspaceProjectMoveCommand,
  runWorkspaceProjectRemoveCommand,
  type WorkspaceProjectCommandDeps,
  type WorkspaceProjectDaemonClient,
} from "./project.js";

const localTarget: DaemonTarget = { kind: "instance", home: "/tmp/paseo-test-home" };
const remoteTarget: DaemonTarget = { kind: "endpoint", host: "devbox:6767" };
const dummyCommand = {} as Command;

function makeMember(
  overrides: Partial<NonNullable<WorkspaceDescriptorPayload["members"]>[number]> & {
    projectId: string;
    workspaceDirectory: string;
  },
): NonNullable<WorkspaceDescriptorPayload["members"]>[number] {
  return {
    projectId: overrides.projectId,
    projectDisplayName: overrides.projectDisplayName ?? path.basename(overrides.workspaceDirectory),
    projectCustomName: overrides.projectCustomName ?? null,
    projectRootPath: overrides.projectRootPath ?? overrides.workspaceDirectory,
    workspaceDirectory: overrides.workspaceDirectory,
    workspaceKind: overrides.workspaceKind ?? "local_checkout",
    worktreeSlug: overrides.worktreeSlug ?? null,
    branch: overrides.branch === undefined ? "main" : overrides.branch,
  };
}

function makeWorkspace(
  overrides: Partial<WorkspaceDescriptorPayload> & { id: string },
): WorkspaceDescriptorPayload {
  const primary = overrides.members?.[0];
  const base: WorkspaceDescriptorPayload = {
    id: overrides.id,
    projectId: primary?.projectId ?? "prj_1",
    projectDisplayName: primary?.projectDisplayName ?? "app",
    projectRootPath: primary?.projectRootPath ?? "/repos/app",
    workspaceDirectory: primary?.workspaceDirectory ?? "/repos/app",
    projectKind: "git",
    workspaceKind: primary?.workspaceKind ?? "local_checkout",
    name: "main",
    status: "idle",
    archivingAt: null,
    statusEnteredAt: null,
    activityAt: null,
  };
  return { ...base, ...overrides };
}

interface FakeClientState {
  features: {
    workspaceMultiProject?: boolean;
    workspaceMemberMove?: boolean;
    backgroundWorkspaces?: boolean;
  };
  workspacePages: WorkspaceDescriptorPayload[][];
  projects: WorkspaceProjectDescriptorPayload[];
  fetchCalls: Array<{
    filter?: { includeBackground?: boolean };
    page?: { limit: number; cursor?: string };
  }>;
  addCalls: Array<{ workspaceId: string; source: WorkspaceMemberAddRequest["source"] }>;
  removeCalls: Array<{ workspaceId: string; cwd: string }>;
  moveCalls: Array<{ sourceWorkspaceId: string; targetWorkspaceId: string; cwd: string }>;
  closed: boolean;
  addHandler?: WorkspaceProjectDaemonClient["addWorkspaceMember"];
  removeHandler?: WorkspaceProjectDaemonClient["removeWorkspaceMember"];
  moveHandler?: WorkspaceProjectDaemonClient["moveWorkspaceMember"];
}

function createFakeDeps(
  initial: Partial<FakeClientState> = {},
  cwd = "/work/current",
): { deps: WorkspaceProjectCommandDeps; state: FakeClientState } {
  const state: FakeClientState = {
    features: initial.features ?? {
      workspaceMultiProject: true,
      workspaceMemberMove: true,
      backgroundWorkspaces: true,
    },
    workspacePages: initial.workspacePages ?? [[]],
    projects: initial.projects ?? [],
    fetchCalls: [],
    addCalls: [],
    removeCalls: [],
    moveCalls: [],
    closed: false,
    addHandler: initial.addHandler,
    removeHandler: initial.removeHandler,
    moveHandler: initial.moveHandler,
  };

  const client: WorkspaceProjectDaemonClient = {
    getLastServerInfoMessage: () => ({ features: state.features }),
    fetchWorkspaces: async (options) => {
      state.fetchCalls.push(options ?? {});
      const pageIndex = options?.page?.cursor ? Number(options.page.cursor) : 0;
      const entries = state.workspacePages[pageIndex] ?? [];
      const nextCursor = pageIndex + 1 < state.workspacePages.length ? String(pageIndex + 1) : null;
      return { entries, pageInfo: { nextCursor } };
    },
    listProjects: async () => ({ projects: state.projects }),
    addWorkspaceMember: async (workspaceId, source) => {
      state.addCalls.push({ workspaceId, source });
      if (state.addHandler) {
        return state.addHandler(workspaceId, source);
      }
      return { workspace: null, error: "Unhandled addWorkspaceMember" };
    },
    removeWorkspaceMember: async (workspaceId, memberCwd) => {
      state.removeCalls.push({ workspaceId, cwd: memberCwd });
      if (state.removeHandler) {
        return state.removeHandler(workspaceId, memberCwd);
      }
      return { workspace: null, error: "Unhandled removeWorkspaceMember" };
    },
    moveWorkspaceMember: async (sourceWorkspaceId, targetWorkspaceId, memberCwd) => {
      state.moveCalls.push({ sourceWorkspaceId, targetWorkspaceId, cwd: memberCwd });
      if (state.moveHandler) {
        return state.moveHandler(sourceWorkspaceId, targetWorkspaceId, memberCwd);
      }
      return {
        source: null,
        target: null,
        movedAgentIds: [],
        movedTerminalIds: [],
        error: "Unhandled moveWorkspaceMember",
      };
    },
    close: async () => {
      state.closed = true;
    },
  };

  return {
    deps: {
      connect: async () => client,
      cwd: () => cwd,
    },
    state,
  };
}

describe("extractWorkspaceProjects", () => {
  it("returns member records when present", () => {
    const workspace = makeWorkspace({
      id: "ws-1",
      members: [
        makeMember({ projectId: "prj_a", workspaceDirectory: "/repos/a", branch: "main" }),
        makeMember({ projectId: "prj_b", workspaceDirectory: "/repos/b", branch: null }),
      ],
      membersAuthoritative: true,
    });

    expect(extractWorkspaceProjects(workspace)).toEqual([
      {
        projectId: "prj_a",
        name: "a",
        kind: "local_checkout",
        branch: "main",
        cwd: "/repos/a",
        projectRootPath: "/repos/a",
      },
      {
        projectId: "prj_b",
        name: "b",
        kind: "local_checkout",
        branch: null,
        cwd: "/repos/b",
        projectRootPath: "/repos/b",
      },
    ]);
  });

  it("returns an empty list for authoritative projectless workspaces", () => {
    const workspace = makeWorkspace({
      id: "ws-empty",
      members: [],
      membersAuthoritative: true,
      workspaceDirectory: "/home/user/.paseo",
    });

    expect(extractWorkspaceProjects(workspace)).toEqual([]);
  });

  it("synthesizes a single project from legacy pre-v0.7.0 descriptors without members", () => {
    const workspace = makeWorkspace({
      id: "ws-legacy",
      projectId: "prj_legacy",
      projectDisplayName: "legacy-app",
      projectRootPath: "/repos/legacy",
      workspaceDirectory: "/repos/legacy",
      workspaceKind: "local_checkout",
    });

    expect(extractWorkspaceProjects(workspace)).toEqual([
      {
        projectId: "prj_legacy",
        name: "legacy-app",
        kind: "local_checkout",
        branch: null,
        cwd: "/repos/legacy",
        projectRootPath: "/repos/legacy",
      },
    ]);
  });
});

describe("workspace project ls", () => {
  it("paginates workspaces with background inclusion when supported and returns member rows", async () => {
    const targetWorkspace = makeWorkspace({
      id: "ws-2",
      members: [
        makeMember({ projectId: "prj_1", workspaceDirectory: "/repos/api", branch: "feat/cli" }),
        makeMember({ projectId: "prj_2", workspaceDirectory: "/repos/web", branch: "main" }),
      ],
      membersAuthoritative: true,
    });
    const { deps, state } = createFakeDeps({
      workspacePages: [[makeWorkspace({ id: "ws-1" })], [targetWorkspace]],
    });

    const result = await runWorkspaceProjectLsCommand(
      "ws-2",
      { daemonTarget: localTarget },
      dummyCommand,
      deps,
    );

    expect(state.fetchCalls).toEqual([
      { filter: { includeBackground: true }, page: { limit: 200 } },
      { filter: { includeBackground: true }, page: { limit: 200, cursor: "1" } },
    ]);
    expect(result.data.map((row) => row.cwd)).toEqual(["/repos/api", "/repos/web"]);
    expect(state.closed).toBe(true);
  });

  it("omits includeBackground on daemons that do not advertise backgroundWorkspaces", async () => {
    const { deps, state } = createFakeDeps({
      features: { workspaceMultiProject: true },
      workspacePages: [
        [
          makeWorkspace({
            id: "ws-1",
            members: [makeMember({ projectId: "prj_1", workspaceDirectory: "/repos/api" })],
          }),
        ],
      ],
    });

    await runWorkspaceProjectLsCommand("ws-1", { daemonTarget: localTarget }, dummyCommand, deps);

    expect(state.fetchCalls).toEqual([{ page: { limit: 200 } }]);
    expect(state.closed).toBe(true);
  });

  it("throws WORKSPACE_NOT_FOUND when the workspace does not exist", async () => {
    const { deps, state } = createFakeDeps({ workspacePages: [[]] });

    await expect(
      runWorkspaceProjectLsCommand("ws-missing", { daemonTarget: localTarget }, dummyCommand, deps),
    ).rejects.toMatchObject({
      code: "WORKSPACE_NOT_FOUND",
      message: "Unknown workspace: ws-missing",
    });
    expect(state.closed).toBe(true);
  });
});

describe("workspace project add", () => {
  it("resolves a relative local path against cwd and returns the added project", async () => {
    const expectedPath = path.resolve("/work/current", "../api");
    const { deps, state } = createFakeDeps(
      {
        addHandler: async (workspaceId, source) => ({
          workspace: makeWorkspace({
            id: workspaceId,
            members: [
              makeMember({ projectId: "prj_web", workspaceDirectory: "/work/web" }),
              makeMember({
                projectId: "prj_api",
                workspaceDirectory: source.path,
                branch: "main",
              }),
            ],
            membersAuthoritative: true,
          }),
          error: null,
        }),
      },
      "/work/current",
    );

    const result = await runWorkspaceProjectAddCommand(
      "ws-1",
      "../api",
      { daemonTarget: localTarget },
      dummyCommand,
      deps,
    );

    expect(state.addCalls).toEqual([
      { workspaceId: "ws-1", source: { kind: "directory", path: expectedPath } },
    ]);
    expect(result.data).toEqual({
      workspaceId: "ws-1",
      projectId: "prj_api",
      name: "api",
      kind: "local_checkout",
      branch: "main",
      cwd: expectedPath,
      projectRootPath: expectedPath,
      projects: [
        {
          projectId: "prj_web",
          name: "web",
          kind: "local_checkout",
          branch: "main",
          cwd: "/work/web",
          projectRootPath: "/work/web",
        },
        {
          projectId: "prj_api",
          name: "api",
          kind: "local_checkout",
          branch: "main",
          cwd: expectedPath,
          projectRootPath: expectedPath,
        },
      ],
    });
    expect(state.closed).toBe(true);
  });

  it("expands tilde paths locally and defaults to cwd when path and --project are omitted", async () => {
    const tildeExpected = path.resolve("/work/current", path.join(homedir(), "repos/sdk"));
    const { deps, state } = createFakeDeps(
      {
        addHandler: async (workspaceId, source) => ({
          workspace: makeWorkspace({
            id: workspaceId,
            members: [makeMember({ projectId: "prj_1", workspaceDirectory: source.path })],
            membersAuthoritative: true,
          }),
          error: null,
        }),
      },
      "/work/current",
    );

    await runWorkspaceProjectAddCommand(
      "ws-1",
      "~/repos/sdk",
      { daemonTarget: localTarget },
      dummyCommand,
      deps,
    );
    await runWorkspaceProjectAddCommand(
      "ws-1",
      undefined,
      { daemonTarget: localTarget },
      dummyCommand,
      deps,
    );

    expect(state.addCalls).toEqual([
      { workspaceId: "ws-1", source: { kind: "directory", path: tildeExpected } },
      { workspaceId: "ws-1", source: { kind: "directory", path: path.resolve("/work/current") } },
    ]);
  });

  it("passes remote paths untouched and identifies the appended member after daemon tilde expansion", async () => {
    const { deps, state } = createFakeDeps({
      addHandler: async (workspaceId) => ({
        workspace: makeWorkspace({
          id: workspaceId,
          members: [
            makeMember({ projectId: "prj_existing", workspaceDirectory: "/srv/existing" }),
            makeMember({ projectId: "prj_remote", workspaceDirectory: "/home/dev/api" }),
          ],
          membersAuthoritative: true,
        }),
        error: null,
      }),
    });

    const result = await runWorkspaceProjectAddCommand(
      "ws-1",
      "~/api",
      { daemonTarget: remoteTarget },
      dummyCommand,
      deps,
    );

    expect(state.addCalls).toEqual([
      { workspaceId: "ws-1", source: { kind: "directory", path: "~/api" } },
    ]);
    expect(result.data.projectId).toBe("prj_remote");
    expect(result.data.cwd).toBe("/home/dev/api");
  });

  it("resolves --project without a path from daemon projects (including on remote hosts)", async () => {
    const { deps, state } = createFakeDeps({
      projects: [
        {
          projectId: "prj_registered",
          projectDisplayName: "Billing",
          projectCustomName: null,
          projectRootPath: "/srv/repos/billing",
          projectKind: "git",
        },
      ],
      addHandler: async (workspaceId, source) => ({
        workspace: makeWorkspace({
          id: workspaceId,
          members: [
            makeMember({
              projectId: source.projectId ?? "prj_registered",
              projectDisplayName: "Billing",
              workspaceDirectory: source.path,
            }),
          ],
          membersAuthoritative: true,
        }),
        error: null,
      }),
    });

    const result = await runWorkspaceProjectAddCommand(
      "ws-1",
      undefined,
      { daemonTarget: remoteTarget, project: "prj_registered" },
      dummyCommand,
      deps,
    );

    expect(state.addCalls).toEqual([
      {
        workspaceId: "ws-1",
        source: {
          kind: "directory",
          path: "/srv/repos/billing",
          projectId: "prj_registered",
        },
      },
    ]);
    expect(result.data.projectId).toBe("prj_registered");
    expect(result.data.cwd).toBe("/srv/repos/billing");
  });

  it("throws PROJECT_NOT_FOUND when --project does not match any registered project", async () => {
    const { deps, state } = createFakeDeps({ projects: [] });

    await expect(
      runWorkspaceProjectAddCommand(
        "ws-1",
        undefined,
        { daemonTarget: localTarget, project: "prj_missing" },
        dummyCommand,
        deps,
      ),
    ).rejects.toMatchObject({
      code: "PROJECT_NOT_FOUND",
      message: "Unknown project: prj_missing",
    });
    expect(state.closed).toBe(true);
  });

  it("requires a path or --project when targeting an explicit remote daemon", async () => {
    const { deps } = createFakeDeps();

    await expect(
      runWorkspaceProjectAddCommand(
        "ws-1",
        undefined,
        { daemonTarget: remoteTarget },
        dummyCommand,
        deps,
      ),
    ).rejects.toMatchObject({ code: "MISSING_PATH" });
  });

  it("gates add on server_info.features.workspaceMultiProject", async () => {
    const { deps, state } = createFakeDeps({ features: {} });

    await expect(
      runWorkspaceProjectAddCommand(
        "ws-1",
        "/repos/api",
        { daemonTarget: localTarget },
        dummyCommand,
        deps,
      ),
    ).rejects.toMatchObject({
      code: "DAEMON_UPDATE_REQUIRED",
      message: "Update the host to manage workspace projects.",
    });
    expect(state.addCalls).toEqual([]);
    expect(state.closed).toBe(true);
  });
});

describe("workspace project remove", () => {
  it("removes a project by explicit path", async () => {
    const { deps, state } = createFakeDeps({
      removeHandler: async (workspaceId) => ({
        workspace: makeWorkspace({
          id: workspaceId,
          members: [makeMember({ projectId: "prj_a", workspaceDirectory: "/repos/a" })],
          membersAuthoritative: true,
        }),
        error: null,
      }),
    });

    const result = await runWorkspaceProjectRemoveCommand(
      "ws-1",
      "/repos/b",
      { daemonTarget: localTarget },
      dummyCommand,
      deps,
    );

    expect(state.removeCalls).toEqual([{ workspaceId: "ws-1", cwd: path.resolve("/repos/b") }]);
    expect(result.data).toEqual({
      workspaceId: "ws-1",
      cwd: path.resolve("/repos/b"),
      status: "removed",
      projects: [
        {
          projectId: "prj_a",
          name: "a",
          kind: "local_checkout",
          branch: "main",
          cwd: "/repos/a",
          projectRootPath: "/repos/a",
        },
      ],
    });
    expect(state.closed).toBe(true);
  });

  it("removes a project by --project when the workspace holds one directory for it", async () => {
    const { deps, state } = createFakeDeps({
      workspacePages: [
        [
          makeWorkspace({
            id: "ws-1",
            members: [
              makeMember({ projectId: "prj_a", workspaceDirectory: "/repos/a" }),
              makeMember({ projectId: "prj_b", workspaceDirectory: "/repos/b" }),
            ],
            membersAuthoritative: true,
          }),
        ],
      ],
      removeHandler: async (workspaceId) => ({
        workspace: makeWorkspace({
          id: workspaceId,
          members: [makeMember({ projectId: "prj_a", workspaceDirectory: "/repos/a" })],
          membersAuthoritative: true,
        }),
        error: null,
      }),
    });

    const result = await runWorkspaceProjectRemoveCommand(
      "ws-1",
      undefined,
      { daemonTarget: localTarget, project: "prj_b" },
      dummyCommand,
      deps,
    );

    expect(state.removeCalls).toEqual([{ workspaceId: "ws-1", cwd: "/repos/b" }]);
    expect(result.data.cwd).toBe("/repos/b");
  });

  it("rejects --project when the workspace holds multiple directories for the same project", async () => {
    const { deps, state } = createFakeDeps({
      workspacePages: [
        [
          makeWorkspace({
            id: "ws-1",
            members: [
              makeMember({ projectId: "prj_dup", workspaceDirectory: "/worktrees/a" }),
              makeMember({ projectId: "prj_dup", workspaceDirectory: "/worktrees/b" }),
            ],
            membersAuthoritative: true,
          }),
        ],
      ],
    });

    await expect(
      runWorkspaceProjectRemoveCommand(
        "ws-1",
        undefined,
        { daemonTarget: localTarget, project: "prj_dup" },
        dummyCommand,
        deps,
      ),
    ).rejects.toMatchObject({ code: "AMBIGUOUS_PROJECT" });
    expect(state.removeCalls).toEqual([]);
    expect(state.closed).toBe(true);
  });

  it("rejects passing both path and --project, or omitting both", async () => {
    const { deps } = createFakeDeps();

    await expect(
      runWorkspaceProjectRemoveCommand(
        "ws-1",
        "/repos/a",
        { daemonTarget: localTarget, project: "prj_a" },
        dummyCommand,
        deps,
      ),
    ).rejects.toMatchObject({ code: "INVALID_OPTIONS" });

    await expect(
      runWorkspaceProjectRemoveCommand(
        "ws-1",
        undefined,
        { daemonTarget: localTarget },
        dummyCommand,
        deps,
      ),
    ).rejects.toMatchObject({ code: "MISSING_PATH" });
  });
});

describe("workspace project move", () => {
  it("moves a project between workspaces and reports moved agent and terminal ids", async () => {
    const { deps, state } = createFakeDeps({
      moveHandler: async (sourceWorkspaceId, targetWorkspaceId) => ({
        source: makeWorkspace({ id: sourceWorkspaceId, members: [], membersAuthoritative: true }),
        target: makeWorkspace({
          id: targetWorkspaceId,
          members: [makeMember({ projectId: "prj_b", workspaceDirectory: "/repos/b" })],
          membersAuthoritative: true,
        }),
        movedAgentIds: ["agent-1"],
        movedTerminalIds: ["term-1", "term-2"],
        error: null,
      }),
    });

    const result = await runWorkspaceProjectMoveCommand(
      "ws-1",
      "ws-2",
      "/repos/b",
      { daemonTarget: localTarget },
      dummyCommand,
      deps,
    );

    expect(state.moveCalls).toEqual([
      {
        sourceWorkspaceId: "ws-1",
        targetWorkspaceId: "ws-2",
        cwd: path.resolve("/repos/b"),
      },
    ]);
    expect(result.data).toEqual({
      sourceWorkspaceId: "ws-1",
      targetWorkspaceId: "ws-2",
      cwd: path.resolve("/repos/b"),
      movedAgentIds: ["agent-1"],
      movedTerminalIds: ["term-1", "term-2"],
    });
    expect(state.closed).toBe(true);
  });

  it("gates move on server_info.features.workspaceMemberMove", async () => {
    const { deps, state } = createFakeDeps({
      features: { workspaceMultiProject: true, workspaceMemberMove: false },
    });

    await expect(
      runWorkspaceProjectMoveCommand(
        "ws-1",
        "ws-2",
        "/repos/b",
        { daemonTarget: localTarget },
        dummyCommand,
        deps,
      ),
    ).rejects.toMatchObject({
      code: "DAEMON_UPDATE_REQUIRED",
      message: "Update the host to move workspace projects.",
    });
    expect(state.moveCalls).toEqual([]);
    expect(state.closed).toBe(true);
  });
});

describe("workspace project argument parsing", () => {
  function parseProjectCommand(argv: string[]): unknown {
    const silent = { writeErr: () => undefined };
    const workspace = createWorkspaceCommand().exitOverride().configureOutput(silent);
    const project = workspace.commands.find((command) => command.name() === "project");
    project?.exitOverride().configureOutput(silent);
    for (const sub of project?.commands ?? []) {
      sub.exitOverride().configureOutput(silent);
    }
    try {
      workspace.parse(argv, { from: "user" });
      return null;
    } catch (error) {
      return error;
    }
  }

  it("rejects excess positional arguments on add, remove, move, and ls", () => {
    expect(parseProjectCommand(["project", "ls", "ws-1", "extra"])).toMatchObject({
      code: "commander.excessArguments",
    });
    expect(parseProjectCommand(["project", "add", "ws-1", "/a", "extra"])).toMatchObject({
      code: "commander.excessArguments",
    });
    expect(parseProjectCommand(["project", "remove", "ws-1", "/a", "extra"])).toMatchObject({
      code: "commander.excessArguments",
    });
    expect(parseProjectCommand(["project", "move", "ws-1", "ws-2", "/a", "extra"])).toMatchObject({
      code: "commander.excessArguments",
    });
  });
});
