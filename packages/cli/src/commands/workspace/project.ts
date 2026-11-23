import path from "node:path";
import type {
  WorkspaceDescriptorPayload,
  WorkspaceMemberAddRequest,
  WorkspaceProjectDescriptorPayload,
} from "@getpaseo/protocol/messages";
import { Command } from "commander";
import { expandUserPath } from "../../classify.js";
import {
  type CommandError,
  type CommandOptions,
  type ListResult,
  type OutputSchema,
  type SingleResult,
  withOutput,
} from "../../output/index.js";
import { buildDaemonConnectionCommandError, connectToDaemon } from "../../utils/client.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import type { DaemonTarget } from "../../utils/daemon-target.js";

export interface WorkspaceProjectRow {
  projectId: string;
  name: string;
  kind: "directory" | "local_checkout" | "checkout" | "worktree";
  branch: string | null;
  cwd: string;
  projectRootPath: string;
}

export interface WorkspaceProjectAddResult extends WorkspaceProjectRow {
  workspaceId: string;
  projects: WorkspaceProjectRow[];
}

export interface WorkspaceProjectRemoveResult {
  workspaceId: string;
  cwd: string;
  status: "removed";
  projects: WorkspaceProjectRow[];
}

export interface WorkspaceProjectMoveResult {
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  cwd: string;
  movedAgentIds: string[];
  movedTerminalIds: string[];
}

export interface WorkspaceProjectOptions extends CommandOptions {
  project?: string;
}

interface WorkspaceProjectDaemonFeatures {
  workspaceMultiProject?: boolean;
  workspaceMemberMove?: boolean;
  backgroundWorkspaces?: boolean;
}

interface WorkspaceProjectServerInfo {
  features?: WorkspaceProjectDaemonFeatures;
}

interface WorkspaceListPage {
  entries: WorkspaceDescriptorPayload[];
  pageInfo: { nextCursor?: string | null };
}

interface ProjectListResult {
  projects: WorkspaceProjectDescriptorPayload[];
}

interface WorkspaceMemberMutationResponse {
  workspace: WorkspaceDescriptorPayload | null;
  error: string | null;
  errorCode?: string;
}

interface WorkspaceMemberMoveResponse {
  source: WorkspaceDescriptorPayload | null;
  target: WorkspaceDescriptorPayload | null;
  movedAgentIds: string[];
  movedTerminalIds: string[];
  error: string | null;
  errorCode?: string;
}

interface FetchWorkspacePageOptions {
  filter?: { includeBackground?: boolean };
  page?: { limit: number; cursor?: string };
}

export interface WorkspaceProjectDaemonClient {
  getLastServerInfoMessage(): WorkspaceProjectServerInfo | null;
  fetchWorkspaces(options?: FetchWorkspacePageOptions): Promise<WorkspaceListPage>;
  listProjects(): Promise<ProjectListResult>;
  addWorkspaceMember(
    workspaceId: string,
    source: WorkspaceMemberAddRequest["source"],
  ): Promise<WorkspaceMemberMutationResponse>;
  removeWorkspaceMember(workspaceId: string, cwd: string): Promise<WorkspaceMemberMutationResponse>;
  moveWorkspaceMember(
    sourceWorkspaceId: string,
    targetWorkspaceId: string,
    cwd: string,
  ): Promise<WorkspaceMemberMoveResponse>;
  close(): Promise<void>;
}

export interface WorkspaceProjectCommandDeps {
  connect(options: { target: DaemonTarget }): Promise<WorkspaceProjectDaemonClient>;
  cwd(): string;
}

const defaultDeps: WorkspaceProjectCommandDeps = {
  connect: ({ target }) => connectToDaemon({ target }),
  cwd: () => process.cwd(),
};

export const workspaceProjectSchema: OutputSchema<WorkspaceProjectRow> = {
  idField: "cwd",
  columns: [
    { header: "PROJECT ID", field: "projectId", width: 20 },
    { header: "NAME", field: "name", width: 24 },
    { header: "KIND", field: "kind", width: 14 },
    { header: "BRANCH", field: (row) => row.branch ?? "-", width: 20 },
    { header: "CWD", field: "cwd", width: 42 },
  ],
};

const workspaceProjectAddSchema: OutputSchema<WorkspaceProjectAddResult> = {
  idField: "cwd",
  columns: [
    { header: "WORKSPACE ID", field: "workspaceId", width: 20 },
    { header: "PROJECT ID", field: "projectId", width: 20 },
    { header: "NAME", field: "name", width: 24 },
    { header: "KIND", field: "kind", width: 14 },
    { header: "CWD", field: "cwd", width: 42 },
  ],
};

const workspaceProjectRemoveSchema: OutputSchema<WorkspaceProjectRemoveResult> = {
  idField: "cwd",
  columns: [
    { header: "WORKSPACE ID", field: "workspaceId", width: 20 },
    { header: "STATUS", field: "status", width: 10 },
    { header: "CWD", field: "cwd", width: 42 },
  ],
};

const workspaceProjectMoveSchema: OutputSchema<WorkspaceProjectMoveResult> = {
  idField: "cwd",
  columns: [
    { header: "SOURCE WORKSPACE", field: "sourceWorkspaceId", width: 20 },
    { header: "TARGET WORKSPACE", field: "targetWorkspaceId", width: 20 },
    { header: "CWD", field: "cwd", width: 42 },
    { header: "AGENTS MOVED", field: (row) => String(row.movedAgentIds.length), width: 14 },
    { header: "TERMINALS MOVED", field: (row) => String(row.movedTerminalIds.length), width: 16 },
  ],
};

export function extractWorkspaceProjects(
  workspace: WorkspaceDescriptorPayload,
): WorkspaceProjectRow[] {
  if (workspace.members && workspace.members.length > 0) {
    return workspace.members.map((member) => ({
      projectId: member.projectId,
      name: member.projectDisplayName,
      kind: member.workspaceKind,
      branch: member.branch,
      cwd: member.workspaceDirectory,
      projectRootPath: member.projectRootPath,
    }));
  }
  // COMPAT(workspaceProjectless): added in v0.8.0, remove gate after 2028-03-01.
  if (workspace.membersAuthoritative) {
    return [];
  }
  // COMPAT(workspaceMultiProject): daemons before v0.7.0 omit members; synthesize the
  // implicit single member from the scalar placement fields.
  return [
    {
      projectId: workspace.projectId,
      name: workspace.projectDisplayName,
      kind: workspace.workspaceKind,
      branch: null,
      cwd: workspace.workspaceDirectory ?? workspace.projectRootPath,
      projectRootPath: workspace.projectRootPath,
    },
  ];
}

function normalizeComparablePath(value: string): string {
  const trimmed = value.replace(/[\\/]+$/, "");
  return trimmed.length > 0 ? trimmed : value;
}

function resolveDirectoryPath(input: {
  pathArg: string;
  cwd: string;
  daemonTarget: DaemonTarget;
}): string {
  if (input.pathArg.trim().length === 0) {
    throw {
      code: "INVALID_PATH",
      message: "Project path cannot be empty",
    } satisfies CommandError;
  }
  if (input.daemonTarget.kind === "endpoint") {
    return input.pathArg;
  }
  return path.resolve(input.cwd, expandUserPath(input.pathArg));
}

function normalizeProjectIdOption(project: string | undefined): string | undefined {
  if (project === undefined) {
    return undefined;
  }
  const trimmed = project.trim();
  if (trimmed.length === 0) {
    throw {
      code: "INVALID_OPTIONS",
      message: "Project id cannot be empty",
    } satisfies CommandError;
  }
  return trimmed;
}

function isCommandError(error: unknown): error is CommandError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    "message" in error &&
    typeof error.message === "string"
  );
}

async function connectWorkspaceProjectClient(
  target: DaemonTarget,
  deps: WorkspaceProjectCommandDeps,
): Promise<WorkspaceProjectDaemonClient> {
  try {
    return await deps.connect({ target });
  } catch (error: unknown) {
    throw buildDaemonConnectionCommandError({ target, error });
  }
}

function requireWorkspaceMultiProjectFeature(client: WorkspaceProjectDaemonClient): void {
  // COMPAT(workspaceMultiProject): added in v0.7.0, remove gate after 2027-02-28.
  if (client.getLastServerInfoMessage()?.features?.workspaceMultiProject !== true) {
    throw {
      code: "DAEMON_UPDATE_REQUIRED",
      message: "Update the host to manage workspace projects.",
    } satisfies CommandError;
  }
}

function requireWorkspaceMemberMoveFeature(client: WorkspaceProjectDaemonClient): void {
  // COMPAT(workspaceMemberMove): added in v0.7.0, remove gate after 2027-03-01.
  if (client.getLastServerInfoMessage()?.features?.workspaceMemberMove !== true) {
    throw {
      code: "DAEMON_UPDATE_REQUIRED",
      message: "Update the host to move workspace projects.",
    } satisfies CommandError;
  }
}

async function fetchWorkspaceById(
  client: WorkspaceProjectDaemonClient,
  workspaceId: string,
): Promise<WorkspaceDescriptorPayload> {
  const includeBackground =
    client.getLastServerInfoMessage()?.features?.backgroundWorkspaces === true;
  let cursor: string | undefined;
  do {
    const payload = await client.fetchWorkspaces({
      ...(includeBackground ? { filter: { includeBackground: true } } : {}),
      page: { limit: 200, ...(cursor ? { cursor } : {}) },
    });
    const match = payload.entries.find((entry) => entry.id === workspaceId);
    if (match) {
      return match;
    }
    cursor = payload.pageInfo.nextCursor ?? undefined;
  } while (cursor);

  throw {
    code: "WORKSPACE_NOT_FOUND",
    message: `Unknown workspace: ${workspaceId}`,
  } satisfies CommandError;
}

async function resolveMemberCwdFromProject(input: {
  client: WorkspaceProjectDaemonClient;
  workspaceId: string;
  projectId: string;
}): Promise<string> {
  const workspace = await fetchWorkspaceById(input.client, input.workspaceId);
  const matches = extractWorkspaceProjects(workspace).filter(
    (member) => member.projectId === input.projectId,
  );
  if (matches.length === 0) {
    throw {
      code: "MEMBER_NOT_FOUND",
      message: `Workspace ${input.workspaceId} has no project ${input.projectId}`,
    } satisfies CommandError;
  }
  if (matches.length > 1) {
    throw {
      code: "AMBIGUOUS_PROJECT",
      message: `Workspace ${input.workspaceId} has multiple directories for project ${input.projectId}; specify the path explicitly`,
    } satisfies CommandError;
  }
  return matches[0]!.cwd;
}

function validateExclusiveTargetInput(input: {
  pathArg: string | undefined;
  projectId: string | undefined;
  usage: string;
}): void {
  if (input.pathArg !== undefined && input.projectId !== undefined) {
    throw {
      code: "INVALID_OPTIONS",
      message: "Specify either a project path or --project, not both",
      details: input.usage,
    } satisfies CommandError;
  }
  if (input.pathArg === undefined && input.projectId === undefined) {
    throw {
      code: "MISSING_PATH",
      message: "Project path or --project is required",
      details: input.usage,
    } satisfies CommandError;
  }
}

function findAddedProjectRow(input: {
  workspace: WorkspaceDescriptorPayload;
  projects: WorkspaceProjectRow[];
  requestedPath: string;
  requestedProjectId?: string;
}): WorkspaceProjectRow {
  const normalizedTarget = normalizeComparablePath(input.requestedPath);
  const exactMatch = input.projects.find(
    (project) => normalizeComparablePath(project.cwd) === normalizedTarget,
  );
  if (exactMatch) {
    return exactMatch;
  }

  const lowerTarget = normalizedTarget.toLowerCase();
  const caseInsensitiveMatch = input.projects.find(
    (project) => normalizeComparablePath(project.cwd).toLowerCase() === lowerTarget,
  );
  if (caseInsensitiveMatch) {
    return caseInsensitiveMatch;
  }

  if (input.requestedProjectId) {
    const projectMatches = input.projects.filter(
      (project) => project.projectId === input.requestedProjectId,
    );
    const lastProjectMatch = projectMatches.at(-1);
    if (lastProjectMatch) {
      return lastProjectMatch;
    }
  }

  const appended = input.projects.at(-1);
  if (appended) {
    return appended;
  }

  return {
    projectId: input.requestedProjectId ?? input.workspace.projectId,
    name: input.workspace.projectDisplayName,
    kind: input.workspace.workspaceKind,
    branch: null,
    cwd: input.requestedPath,
    projectRootPath: input.requestedPath,
  };
}

export async function runWorkspaceProjectLsCommand(
  workspaceId: string,
  options: CommandOptions,
  _command: Command,
  deps: WorkspaceProjectCommandDeps = defaultDeps,
): Promise<ListResult<WorkspaceProjectRow>> {
  const client = await connectWorkspaceProjectClient(options.daemonTarget, deps);
  try {
    const workspace = await fetchWorkspaceById(client, workspaceId);
    return {
      type: "list",
      data: extractWorkspaceProjects(workspace),
      schema: workspaceProjectSchema,
    };
  } catch (error: unknown) {
    if (isCommandError(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw { code: "WORKSPACE_PROJECT_LS_FAILED", message } satisfies CommandError;
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runWorkspaceProjectAddCommand(
  workspaceId: string,
  pathArg: string | undefined,
  options: WorkspaceProjectOptions,
  _command: Command,
  deps: WorkspaceProjectCommandDeps = defaultDeps,
): Promise<SingleResult<WorkspaceProjectAddResult>> {
  const projectId = normalizeProjectIdOption(options.project);
  const directPath =
    pathArg !== undefined
      ? resolveDirectoryPath({ pathArg, cwd: deps.cwd(), daemonTarget: options.daemonTarget })
      : undefined;

  if (
    directPath === undefined &&
    projectId === undefined &&
    options.daemonTarget.kind === "endpoint"
  ) {
    throw {
      code: "MISSING_PATH",
      message: "Project path or --project is required when targeting a daemon explicitly",
      details: "Usage: paseo workspace project add <workspace-id> <path> --host <host>",
    } satisfies CommandError;
  }

  const client = await connectWorkspaceProjectClient(options.daemonTarget, deps);
  try {
    requireWorkspaceMultiProjectFeature(client);

    let source: WorkspaceMemberAddRequest["source"];
    if (directPath !== undefined) {
      source = {
        kind: "directory",
        path: directPath,
        ...(projectId ? { projectId } : {}),
      };
    } else if (projectId !== undefined) {
      const { projects } = await client.listProjects();
      const registered = projects.find((candidate) => candidate.projectId === projectId);
      if (!registered) {
        throw {
          code: "PROJECT_NOT_FOUND",
          message: `Unknown project: ${projectId}`,
        } satisfies CommandError;
      }
      source = {
        kind: "directory",
        path: registered.projectRootPath,
        projectId: registered.projectId,
      };
    } else {
      source = {
        kind: "directory",
        path: path.resolve(deps.cwd()),
      };
    }

    const payload = await client.addWorkspaceMember(workspaceId, source);
    if (payload.error || !payload.workspace) {
      throw new Error(payload.error ?? "Failed to add project to workspace");
    }

    const projects = extractWorkspaceProjects(payload.workspace);
    const added = findAddedProjectRow({
      workspace: payload.workspace,
      projects,
      requestedPath: source.path,
      requestedProjectId: source.projectId,
    });

    return {
      type: "single",
      data: {
        workspaceId: payload.workspace.id,
        ...added,
        projects,
      },
      schema: workspaceProjectAddSchema,
    };
  } catch (error: unknown) {
    if (isCommandError(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw { code: "WORKSPACE_PROJECT_ADD_FAILED", message } satisfies CommandError;
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runWorkspaceProjectRemoveCommand(
  workspaceId: string,
  pathArg: string | undefined,
  options: WorkspaceProjectOptions,
  _command: Command,
  deps: WorkspaceProjectCommandDeps = defaultDeps,
): Promise<SingleResult<WorkspaceProjectRemoveResult>> {
  const projectId = normalizeProjectIdOption(options.project);
  validateExclusiveTargetInput({
    pathArg,
    projectId,
    usage: "Usage: paseo workspace project remove <workspace-id> <path> | --project <project-id>",
  });
  const directPath =
    pathArg !== undefined
      ? resolveDirectoryPath({ pathArg, cwd: deps.cwd(), daemonTarget: options.daemonTarget })
      : undefined;

  const client = await connectWorkspaceProjectClient(options.daemonTarget, deps);
  try {
    requireWorkspaceMultiProjectFeature(client);

    const targetCwd =
      directPath ??
      (await resolveMemberCwdFromProject({
        client,
        workspaceId,
        projectId: projectId!,
      }));

    const payload = await client.removeWorkspaceMember(workspaceId, targetCwd);
    if (payload.error || !payload.workspace) {
      throw new Error(payload.error ?? "Failed to remove project from workspace");
    }

    return {
      type: "single",
      data: {
        workspaceId: payload.workspace.id,
        cwd: targetCwd,
        status: "removed",
        projects: extractWorkspaceProjects(payload.workspace),
      },
      schema: workspaceProjectRemoveSchema,
    };
  } catch (error: unknown) {
    if (isCommandError(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw { code: "WORKSPACE_PROJECT_REMOVE_FAILED", message } satisfies CommandError;
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runWorkspaceProjectMoveCommand(
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
  pathArg: string | undefined,
  options: WorkspaceProjectOptions,
  _command: Command,
  deps: WorkspaceProjectCommandDeps = defaultDeps,
): Promise<SingleResult<WorkspaceProjectMoveResult>> {
  const projectId = normalizeProjectIdOption(options.project);
  validateExclusiveTargetInput({
    pathArg,
    projectId,
    usage:
      "Usage: paseo workspace project move <source-workspace-id> <target-workspace-id> <path> | --project <project-id>",
  });
  const directPath =
    pathArg !== undefined
      ? resolveDirectoryPath({ pathArg, cwd: deps.cwd(), daemonTarget: options.daemonTarget })
      : undefined;

  const client = await connectWorkspaceProjectClient(options.daemonTarget, deps);
  try {
    requireWorkspaceMemberMoveFeature(client);

    const targetCwd =
      directPath ??
      (await resolveMemberCwdFromProject({
        client,
        workspaceId: sourceWorkspaceId,
        projectId: projectId!,
      }));

    const payload = await client.moveWorkspaceMember(
      sourceWorkspaceId,
      targetWorkspaceId,
      targetCwd,
    );
    if (payload.error || !payload.source || !payload.target) {
      throw new Error(payload.error ?? "Failed to move project between workspaces");
    }

    return {
      type: "single",
      data: {
        sourceWorkspaceId: payload.source.id,
        targetWorkspaceId: payload.target.id,
        cwd: targetCwd,
        movedAgentIds: payload.movedAgentIds,
        movedTerminalIds: payload.movedTerminalIds,
      },
      schema: workspaceProjectMoveSchema,
    };
  } catch (error: unknown) {
    if (isCommandError(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw { code: "WORKSPACE_PROJECT_MOVE_FAILED", message } satisfies CommandError;
  } finally {
    await client.close().catch(() => undefined);
  }
}

export function createWorkspaceProjectCommand(): Command {
  const project = new Command("project").description("Manage projects in a workspace");

  addJsonAndDaemonHostOptions(
    project
      .command("ls")
      .description("List projects in a workspace")
      .argument("<workspace-id>", "Workspace id")
      .allowExcessArguments(false),
  ).action(
    withOutput((workspaceId: string, options: CommandOptions, command: Command) =>
      runWorkspaceProjectLsCommand(workspaceId, options, command),
    ),
  );

  addJsonAndDaemonHostOptions(
    project
      .command("add")
      .description("Add a project directory to a workspace")
      .argument("<workspace-id>", "Workspace id")
      .argument("[path]", "Project directory (default: current directory, or --project root)")
      .option("--project <id>", "Existing project id")
      .allowExcessArguments(false),
  ).action(
    withOutput(
      (
        workspaceId: string,
        pathArg: string | undefined,
        options: WorkspaceProjectOptions,
        command: Command,
      ) => runWorkspaceProjectAddCommand(workspaceId, pathArg, options, command),
    ),
  );

  addJsonAndDaemonHostOptions(
    project
      .command("remove")
      .description("Remove a project directory from a workspace")
      .argument("<workspace-id>", "Workspace id")
      .argument("[path]", "Project directory to remove")
      .option("--project <id>", "Project id in the workspace")
      .allowExcessArguments(false),
  ).action(
    withOutput(
      (
        workspaceId: string,
        pathArg: string | undefined,
        options: WorkspaceProjectOptions,
        command: Command,
      ) => runWorkspaceProjectRemoveCommand(workspaceId, pathArg, options, command),
    ),
  );

  addJsonAndDaemonHostOptions(
    project
      .command("move")
      .description("Move a project directory from one workspace to another")
      .argument("<source-workspace-id>", "Source workspace id")
      .argument("<target-workspace-id>", "Target workspace id")
      .argument("[path]", "Project directory to move")
      .option("--project <id>", "Project id in the source workspace")
      .allowExcessArguments(false),
  ).action(
    withOutput(
      (
        sourceWorkspaceId: string,
        targetWorkspaceId: string,
        pathArg: string | undefined,
        options: WorkspaceProjectOptions,
        command: Command,
      ) =>
        runWorkspaceProjectMoveCommand(
          sourceWorkspaceId,
          targetWorkspaceId,
          pathArg,
          options,
          command,
        ),
    ),
  );

  return project;
}
