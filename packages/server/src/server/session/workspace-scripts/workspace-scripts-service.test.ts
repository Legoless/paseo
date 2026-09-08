import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterEach, describe, expect, test } from "vitest";
import type { SessionOutboundMessage, StartWorkspaceScriptRequest } from "../../messages.js";
import { createServiceProxySubsystem, type ServiceProxySubsystem } from "../../service-proxy.js";
import type { TerminalManager } from "../../../terminal/terminal-manager.js";
import type {
  PersistedProjectRecord,
  PersistedWorkspaceRecord,
  ProjectRegistry,
  WorkspaceRegistry,
} from "../../workspace-registry.js";
import { createNoGitWorkspaceRuntimeSnapshot } from "../../test-utils/workspace-git-service-stub.js";
import { WorkspaceScriptRuntimeStore } from "../../workspace-script-runtime-store.js";
import type {
  SpawnWorkspaceScriptOptions,
  WorktreeScriptResult,
} from "../../worktree-bootstrap.js";
import type { WorkspaceGitService } from "../../workspace-git-service.js";
import { createWorkspaceScriptsService } from "./workspace-scripts-service.js";
import { deriveProjectServiceSlug } from "../../workspace-git-metadata.js";

// The production module reads only WorkspaceGitService.{peekSnapshot,getProjectSlug},
// WorkspaceRegistry.get, and forwards the launcher + opaque managers to the injected
// spawnWorkspaceScript port. The fakes below implement exactly that slice; the service proxy and
// runtime store are the real in-memory implementations, and spawning is injected so no process runs.

const logger = pino({ level: "silent" });

function fakeWorkspaceRegistry(
  record: PersistedWorkspaceRecord | null,
): Pick<WorkspaceRegistry, "get"> {
  return {
    async get() {
      return record;
    },
  };
}

function fakeProjectRegistry(record: PersistedProjectRecord | null): Pick<ProjectRegistry, "get"> {
  return {
    async get() {
      return record;
    },
  };
}

function fakeGitService() {
  const snapshot = createNoGitWorkspaceRuntimeSnapshot("/tmp/repo");
  snapshot.git = {
    ...snapshot.git,
    isGit: true,
    repoRoot: "/tmp/repo",
    currentBranch: "feature/scripts",
    remoteUrl: "https://github.com/getpaseo/paseo.git",
    hasRemote: true,
  };

  return {
    peekSnapshot() {
      return snapshot;
    },
  };
}

// The service only truthiness-checks terminalManager in its availability guard and then forwards it
// opaquely to the injected spawnWorkspaceScript fake, which ignores it — an empty stand-in is enough.
const availableTerminalManager = { getTerminal: () => null } as unknown as TerminalManager;

interface BuildOptions {
  serviceProxy?: ServiceProxySubsystem | null;
  scriptRuntimeStore?: WorkspaceScriptRuntimeStore | null;
  terminalManager?: TerminalManager | null;
  workspace?: PersistedWorkspaceRecord | null;
  project?: PersistedProjectRecord | null;
  spawnThrows?: string;
  gitService?: Pick<WorkspaceGitService, "peekSnapshot">;
}

function buildService(options: BuildOptions = {}) {
  const emitted: SessionOutboundMessage[] = [];
  const spawnCalls: SpawnWorkspaceScriptOptions[] = [];
  const workspace =
    options.workspace === undefined
      ? ({
          workspaceId: "ws-1",
          members: [
            {
              projectId: "test-project",
              cwd: "/tmp/repo",
              kind: "directory",
              displayName: "workspace",
              branch: null,
              worktreeRoot: null,
              baseBranch: null,
              isPaseoOwnedWorktree: false,
              mainRepoRoot: null,
            },
          ],
        } as PersistedWorkspaceRecord)
      : options.workspace;

  const service = createWorkspaceScriptsService({
    serviceProxy:
      options.serviceProxy === undefined
        ? createServiceProxySubsystem({ logger })
        : options.serviceProxy,
    scriptRuntimeStore:
      options.scriptRuntimeStore === undefined
        ? new WorkspaceScriptRuntimeStore()
        : options.scriptRuntimeStore,
    terminalManager:
      options.terminalManager === undefined ? availableTerminalManager : options.terminalManager,
    workspaceRegistry: fakeWorkspaceRegistry(workspace),
    projectRegistry: fakeProjectRegistry(options.project ?? null),
    workspaceGitService: options.gitService ?? fakeGitService(),
    getDaemonTcpPort: () => 6767,
    getDaemonTcpHost: () => "127.0.0.1",
    serviceProxyPublicBaseUrl: null,
    resolveScriptHealth: null,
    logger,
    emit: (message) => emitted.push(message),
    async spawnWorkspaceScript(spawnOptions): Promise<WorktreeScriptResult> {
      spawnCalls.push(spawnOptions);
      if (options.spawnThrows) {
        throw new Error(options.spawnThrows);
      }
      spawnOptions.onLifecycleChanged?.();
      return {
        scriptName: spawnOptions.scriptName,
        hostname: null,
        port: null,
        terminalId: "terminal-1",
      };
    },
  });

  return { service, emitted, spawnCalls };
}

const request: StartWorkspaceScriptRequest = {
  type: "start_workspace_script_request",
  workspaceId: "ws-1",
  scriptName: "app",
  requestId: "req-1",
};

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("buildSnapshot", () => {
  test("returns no scripts when the service proxy is unavailable", async () => {
    const { service } = buildService({ serviceProxy: null });
    expect(
      service.buildSnapshot({
        workspaceId: "ws-1",
        members: [
          {
            projectId: "test-project",
            cwd: "/tmp/repo",
            kind: "directory",
            displayName: "workspace",
            branch: null,
            worktreeRoot: null,
            baseBranch: null,
            isPaseoOwnedWorktree: false,
            mainRepoRoot: null,
          },
        ],
      } as PersistedWorkspaceRecord),
    ).toEqual([]);
  });

  test("returns no scripts when the runtime store is unavailable", async () => {
    const { service } = buildService({ scriptRuntimeStore: null });
    expect(
      service.buildSnapshot({
        workspaceId: "ws-1",
        members: [
          {
            projectId: "test-project",
            cwd: "/tmp/repo",
            kind: "directory",
            displayName: "workspace",
            branch: null,
            worktreeRoot: null,
            baseBranch: null,
            isPaseoOwnedWorktree: false,
            mainRepoRoot: null,
          },
        ],
      } as PersistedWorkspaceRecord),
    ).toEqual([]);
  });

  test("returns no scripts for a workspace without a paseo.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "workspace-scripts-"));
    tempDirs.push(dir);
    const { service } = buildService();
    expect(
      service.buildSnapshot({
        workspaceId: "ws-1",
        members: [
          {
            projectId: "test-project",
            cwd: dir,
            kind: "directory",
            displayName: "workspace",
            branch: null,
            worktreeRoot: null,
            baseBranch: null,
            isPaseoOwnedWorktree: false,
            mainRepoRoot: null,
          },
        ],
      } as PersistedWorkspaceRecord),
    ).toEqual([]);
  });

  test("projects service hostnames without a Git snapshot", async () => {
    const directory = mkdtempSync(join(tmpdir(), "workspace-scripts-"));
    tempDirs.push(directory);
    writeFileSync(
      join(directory, "paseo.json"),
      JSON.stringify({ scripts: { app: { type: "service", command: "npm run app", port: 3000 } } }),
    );
    const project = {
      projectId: "prj_no_snapshot",
      rootPath: directory,
      kind: "git",
      displayName: "app",
      customName: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archivedAt: null,
    } as PersistedProjectRecord;
    const workspace = {
      workspaceId: "ws-no-snapshot",
      members: [
        {
          projectId: project.projectId,
          cwd: directory,
          kind: "directory",
          displayName: "workspace",
          branch: "feature/persisted",
          worktreeRoot: null,
          baseBranch: null,
          isPaseoOwnedWorktree: false,
          mainRepoRoot: null,
        },
      ],
    } as PersistedWorkspaceRecord;
    const serviceProxy = createServiceProxySubsystem({ logger });
    const { service, spawnCalls } = buildService({
      workspace,
      project,
      serviceProxy,
      gitService: { peekSnapshot: () => undefined },
    });

    expect(service.buildSnapshot(workspace, project)[0]?.hostname).toBe(
      serviceProxy.projectWorkspaceService({
        projectSlug: deriveProjectServiceSlug(project),
        branchName: workspace.members[0]!.branch,
        scriptName: "app",
        daemonPort: 6767,
      }).hostname,
    );
    await service.start({ ...request, workspaceId: workspace.workspaceId });
    expect(spawnCalls[0]?.branchName).toBe(workspace.members[0]!.branch);
  });
});

describe("emitStatusUpdate", () => {
  test("emits one script_status_update carrying the snapshot", async () => {
    const { service, emitted } = buildService();
    await service.emitStatusUpdate("ws-1", "/tmp/repo");
    expect(emitted).toEqual([
      {
        type: "script_status_update",
        payload: { workspaceId: "ws-1", cwd: "/tmp/repo", scripts: [] },
      },
    ]);
  });
});

describe("stop", () => {
  test("kills the supervised terminal and returns the stopped service metadata", async () => {
    const dir = mkdtempSync(join(tmpdir(), "workspace-scripts-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, "paseo.json"),
      JSON.stringify({ scripts: { web: { type: "service", command: "npm run web", port: 3000 } } }),
    );
    const runtimeStore = new WorkspaceScriptRuntimeStore();
    runtimeStore.set({
      workspaceId: "ws-1",
      scriptName: "web",
      type: "service",
      lifecycle: "running",
      terminalId: "terminal-1",
      exitCode: null,
    });
    const terminalManager = {
      getTerminal: (terminalId: string) => (terminalId === "terminal-1" ? { cwd: dir } : undefined),
      async killTerminalAndWait(terminalId: string) {
        expect(terminalId).toBe("terminal-1");
        runtimeStore.set({
          workspaceId: "ws-1",
          scriptName: "web",
          type: "service",
          lifecycle: "stopped",
          terminalId,
          exitCode: 143,
        });
      },
    } as unknown as TerminalManager;
    const { service } = buildService({
      workspace: {
        workspaceId: "ws-1",
        members: [
          {
            projectId: "test-project",
            cwd: dir,
            kind: "directory",
            displayName: "workspace",
            branch: null,
            worktreeRoot: null,
            baseBranch: null,
            isPaseoOwnedWorktree: false,
            mainRepoRoot: null,
          },
        ],
      } as PersistedWorkspaceRecord,
      scriptRuntimeStore: runtimeStore,
      terminalManager,
    });

    await expect(service.stop({ workspaceId: "ws-1", scriptName: "web" })).resolves.toMatchObject({
      scriptName: "web",
      type: "service",
      port: 3000,
      lifecycle: "stopped",
      exitCode: 143,
      terminalId: "terminal-1",
    });
  });
});

describe("start", () => {
  test("reports an error when workspace scripts are unavailable", async () => {
    const { service, emitted, spawnCalls } = buildService({ terminalManager: null });
    await service.start(request);
    expect(spawnCalls).toEqual([]);
    expect(emitted).toEqual([
      {
        type: "start_workspace_script_response",
        payload: {
          requestId: "req-1",
          workspaceId: "ws-1",
          scriptName: "app",
          terminalId: null,
          error: "Workspace scripts are not available on this daemon",
        },
      },
    ]);
  });

  test("reports an error when the workspace is not found", async () => {
    const { service, emitted, spawnCalls } = buildService({ workspace: null });
    await service.start(request);
    expect(spawnCalls).toEqual([]);
    expect(emitted).toEqual([
      {
        type: "start_workspace_script_response",
        payload: {
          requestId: "req-1",
          workspaceId: "ws-1",
          scriptName: "app",
          terminalId: null,
          error: "Workspace not found: ws-1",
        },
      },
    ]);
  });

  test("spawns the script with resolved git metadata and reports success", async () => {
    const { service, emitted, spawnCalls } = buildService();
    await service.start(request);

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]).toMatchObject({
      repoRoot: "/tmp/repo",
      workspaceId: "ws-1",
      projectSlug: "paseo",
      branchName: "feature/scripts",
      scriptName: "app",
      daemonPort: 6767,
      daemonListenHost: "127.0.0.1",
    });
    expect(emitted).toContainEqual({
      type: "script_status_update",
      payload: { workspaceId: "ws-1", cwd: "/tmp/repo", scripts: [] },
    });
    expect(emitted).toContainEqual({
      type: "start_workspace_script_response",
      payload: {
        requestId: "req-1",
        workspaceId: "ws-1",
        scriptName: "app",
        terminalId: "terminal-1",
        error: null,
      },
    });
  });

  test("uses the exact project root for a service hostname", async () => {
    const workspace = {
      workspaceId: "ws-app",
      members: [
        {
          projectId: "prj-app",
          cwd: "/repo/apps/app",
          kind: "directory",
          displayName: "workspace",
          branch: null,
          worktreeRoot: null,
          baseBranch: null,
          isPaseoOwnedWorktree: false,
          mainRepoRoot: null,
        },
      ],
    } as PersistedWorkspaceRecord;
    const project = {
      projectId: "prj-app",
      rootPath: "/repo/apps/app",
      kind: "git",
      displayName: "app",
      customName: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archivedAt: null,
    } as PersistedProjectRecord;
    const { service, spawnCalls } = buildService({ workspace, project });

    await service.start({ ...request, workspaceId: workspace.workspaceId });

    expect(spawnCalls[0]).toMatchObject({
      projectSlug: deriveProjectServiceSlug(project),
    });
  });

  test("keeps same-named service projects distinct", async () => {
    const projectA = {
      projectId: "prj-app-a",
      rootPath: "/repo-a/app",
      kind: "git",
      displayName: "app",
      customName: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archivedAt: null,
    } as PersistedProjectRecord;
    const projectB = { ...projectA, projectId: "prj-app-b", rootPath: "/repo-b/app" };
    const workspaceA = {
      workspaceId: "ws-app-a",
      members: [
        {
          projectId: projectA.projectId,
          cwd: projectA.rootPath,
          kind: "directory",
          displayName: "workspace",
          branch: null,
          worktreeRoot: null,
          baseBranch: null,
          isPaseoOwnedWorktree: false,
          mainRepoRoot: null,
        },
      ],
    } as PersistedWorkspaceRecord;
    const workspaceB = {
      workspaceId: "ws-app-b",
      members: [
        {
          projectId: projectB.projectId,
          cwd: projectB.rootPath,
          kind: "directory",
          displayName: "workspace",
          branch: null,
          worktreeRoot: null,
          baseBranch: null,
          isPaseoOwnedWorktree: false,
          mainRepoRoot: null,
        },
      ],
    } as PersistedWorkspaceRecord;
    const first = buildService({ workspace: workspaceA, project: projectA });
    const second = buildService({ workspace: workspaceB, project: projectB });

    await first.service.start({ ...request, workspaceId: workspaceA.workspaceId });
    await second.service.start({ ...request, workspaceId: workspaceB.workspaceId });

    expect(first.spawnCalls[0]?.projectSlug).not.toBe(second.spawnCalls[0]?.projectSlug);
  });

  test("predicts the same service hostname that start registers", async () => {
    const directory = mkdtempSync(join(tmpdir(), "workspace-scripts-"));
    tempDirs.push(directory);
    writeFileSync(
      join(directory, "paseo.json"),
      JSON.stringify({ scripts: { app: { type: "service", command: "npm run app", port: 3000 } } }),
    );
    const project = {
      projectId: "prj_hostname",
      rootPath: directory,
      kind: "git",
      displayName: "app",
      customName: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archivedAt: null,
    } as PersistedProjectRecord;
    const workspace = {
      workspaceId: "ws-hostname",
      members: [
        {
          projectId: project.projectId,
          cwd: directory,
          kind: "directory",
          displayName: "workspace",
          branch: null,
          worktreeRoot: null,
          baseBranch: null,
          isPaseoOwnedWorktree: false,
          mainRepoRoot: null,
        },
      ],
    } as PersistedWorkspaceRecord;
    const serviceProxy = createServiceProxySubsystem({ logger });
    const { service, spawnCalls } = buildService({ workspace, project, serviceProxy });

    const snapshot = service.buildSnapshot(workspace, project);
    await service.start({ ...request, workspaceId: workspace.workspaceId });

    const started = spawnCalls[0]!;
    expect(snapshot[0]?.hostname).toBe(
      serviceProxy.projectWorkspaceService({
        projectSlug: started.projectSlug,
        branchName: started.branchName,
        scriptName: started.scriptName,
        daemonPort: started.daemonPort,
      }).hostname,
    );
  });

  test("reports the launcher error when spawning fails", async () => {
    const { service, emitted } = buildService({ spawnThrows: "boom" });
    await service.start(request);
    expect(emitted).toEqual([
      {
        type: "start_workspace_script_response",
        payload: {
          requestId: "req-1",
          workspaceId: "ws-1",
          scriptName: "app",
          terminalId: null,
          error: "boom",
        },
      },
    ]);
  });
});

test("empty containers have no scripts and multiple projects require an explicit directory", async () => {
  const member = (cwd: string) => ({
    projectId: cwd,
    cwd,
    kind: "directory" as const,
    displayName: cwd,
    branch: null,
    worktreeRoot: null,
    baseBranch: null,
    isPaseoOwnedWorktree: false,
    mainRepoRoot: null,
  });
  const empty = { workspaceId: "ws-empty", members: [] } as unknown as PersistedWorkspaceRecord;
  const emptyService = buildService({ workspace: empty }).service;
  expect(await emptyService.list(empty.workspaceId)).toEqual([]);
  await expect(
    emptyService.launch({ workspaceId: empty.workspaceId, scriptName: "dev" }),
  ).rejects.toThrow("Choose a project");
  const dirs = [
    mkdtempSync(join(tmpdir(), "workspace-script-one-")),
    mkdtempSync(join(tmpdir(), "workspace-script-two-")),
  ];
  tempDirs.push(...dirs);
  for (const dir of dirs)
    writeFileSync(
      join(dir, "paseo.json"),
      JSON.stringify({ scripts: { dev: { command: "echo hello" } } }),
    );
  const workspace = {
    workspaceId: "ws-multi",
    members: dirs.map(member),
  } as unknown as PersistedWorkspaceRecord;
  const { service, spawnCalls } = buildService({ workspace });
  expect((await service.list(workspace.workspaceId)).map((script) => script.cwd)).toEqual(dirs);
  await expect(
    service.launch({ workspaceId: workspace.workspaceId, scriptName: "dev" }),
  ).rejects.toThrow("Choose a project");
  await service.launch({ workspaceId: workspace.workspaceId, scriptName: "dev", cwd: dirs[1] });
  expect(spawnCalls[0]?.repoRoot).toBe(dirs[1]);
});

test("script actions cannot reuse or stop the same name in another project", async () => {
  const member = (cwd: string) => ({
    projectId: cwd,
    cwd,
    kind: "directory" as const,
    displayName: cwd,
    branch: null,
    worktreeRoot: null,
    baseBranch: null,
    isPaseoOwnedWorktree: false,
    mainRepoRoot: null,
  });
  const workspace = {
    workspaceId: "ws-multi",
    members: [member("/one"), member("/two")],
  } as unknown as PersistedWorkspaceRecord;
  const runtimeStore = new WorkspaceScriptRuntimeStore();
  runtimeStore.set({
    workspaceId: workspace.workspaceId,
    scriptName: "dev",
    type: "script",
    lifecycle: "running",
    terminalId: "term-one",
    exitCode: null,
  });
  const terminalManager = {
    getTerminal: () => ({ cwd: "/one" }),
    killTerminalAndWait: () => {
      throw new Error("must not stop another project");
    },
  } as unknown as TerminalManager;
  const { service, spawnCalls } = buildService({
    workspace,
    scriptRuntimeStore: runtimeStore,
    terminalManager,
  });
  await expect(
    service.launch({ workspaceId: workspace.workspaceId, scriptName: "dev", cwd: "/two" }),
  ).rejects.toThrow("already running in /one");
  await expect(
    service.stop({ workspaceId: workspace.workspaceId, scriptName: "dev", cwd: "/two" }),
  ).rejects.toThrow("running in /one");
  expect(spawnCalls).toEqual([]);
});
