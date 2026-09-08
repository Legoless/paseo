import { basename, resolve } from "node:path";
import type { Logger } from "pino";
import {
  generateWorkspaceId,
  initialWorkspacePlacement,
  reconcileWorkspacePlacement,
  workspaceMembers,
  type MutableWorkspacePlacement,
} from "../../workspace-registry-model.js";
import {
  createPersistedWorkspaceRecord,
  type PersistedProjectRecord,
  type PersistedWorkspaceMember,
  type PersistedWorkspaceRecord,
  type ProjectRegistry,
  type WorkspaceRegistry,
} from "../../workspace-registry.js";
import type { WorkspaceGitService } from "../../workspace-git-service.js";
import type { CreatePaseoWorktreeWorkflowResult } from "../../worktree-session.js";
import { deriveProjectKey } from "../../project-key.js";
import { areEquivalentPaths, createRealpathAwarePathMatcher } from "../../../utils/path.js";

export interface ResolveOrCreateWorkspaceIdInput {
  createdWorktree: CreatePaseoWorktreeWorkflowResult | null;
  requestedWorkspaceId?: string;
  cwd: string;
  initialTitle: string | null;
}

export interface ImportWorkspaceInput {
  cwd: string;
  requestedWorkspaceId?: string;
}

export interface ImportWorkspaceResult<T> {
  value: T;
  createdWorkspace: PersistedWorkspaceRecord | null;
}

export interface CreateWorktreeWorkspaceInput {
  sourceCwd: string;
  projectId?: string;
  repoRoot: string;
  cwd: string;
  worktreeRoot: string;
  branch: string | null;
  baseBranch: string | null;
  title: string | null;
  expectsInitialAgent?: boolean;
}

export interface AddWorkspaceMemberInput {
  workspaceId: string;
  source: {
    kind: "directory";
    path: string;
    projectId?: string;
  };
}

export interface RemoveWorkspaceMemberInput {
  workspaceId: string;
  cwd: string;
}

export interface MoveWorkspaceMemberInput {
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  cwd: string;
}

export interface MoveWorkspaceMemberResult {
  source: PersistedWorkspaceRecord;
  target: PersistedWorkspaceRecord;
}

export interface WorkspaceProvisioningService {
  runInImportWorkspace<T>(
    input: ImportWorkspaceInput,
    operation: (workspace: PersistedWorkspaceRecord) => Promise<T>,
  ): Promise<ImportWorkspaceResult<T>>;
  findOrCreateWorkspaceForDirectory(cwd: string): Promise<PersistedWorkspaceRecord>;
  resolveOrCreateWorkspaceIdForCreateAgent(input: ResolveOrCreateWorkspaceIdInput): Promise<string>;
  createWorkspaceForDirectory(
    cwd: string,
    title?: string | null,
    projectId?: string,
    context?: { expectsInitialAgent?: boolean },
  ): Promise<PersistedWorkspaceRecord>;
  // COMPAT(workspaceProjectless): added in v0.8.0, remove after 2028-03-01.
  createProjectlessWorkspace(
    title?: string | null,
    context?: { expectsInitialAgent?: boolean },
  ): Promise<PersistedWorkspaceRecord>;
  createWorkspaceForWorktree(
    input: CreateWorktreeWorkspaceInput,
  ): Promise<PersistedWorkspaceRecord>;
  findOrCreateProjectForDirectory(cwd: string): Promise<PersistedProjectRecord>;
  ensureWorkspaceRecordUnarchived(
    workspace: PersistedWorkspaceRecord,
  ): Promise<PersistedWorkspaceRecord>;
  addWorkspaceMember(input: AddWorkspaceMemberInput): Promise<PersistedWorkspaceRecord>;
  removeWorkspaceMember(input: RemoveWorkspaceMemberInput): Promise<PersistedWorkspaceRecord>;
  moveWorkspaceMember(input: MoveWorkspaceMemberInput): Promise<MoveWorkspaceMemberResult>;
}

export type WorkspaceProvisioningErrorCode =
  | "unknown_project"
  | "archived_project"
  | "workspace_not_found"
  | "archived_workspace"
  | "duplicate_member"
  | "member_not_found"
  | "member_has_active_agents"
  | "member_has_live_terminals";

export class WorkspaceProvisioningError extends Error {
  constructor(
    readonly code: WorkspaceProvisioningErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceProvisioningError";
  }
}

export function createWorkspaceProvisioningService(deps: {
  serverId?: string;
  workspaceRegistry: WorkspaceRegistry;
  projectRegistry: ProjectRegistry;
  workspaceGitService: Pick<WorkspaceGitService, "getCheckout" | "getSnapshot" | "peekSnapshot">;
  logger: Logger;
}): WorkspaceProvisioningService {
  const { serverId, workspaceRegistry, projectRegistry, workspaceGitService, logger } = deps;

  async function runInImportWorkspace<T>(
    input: ImportWorkspaceInput,
    operation: (workspace: PersistedWorkspaceRecord) => Promise<T>,
  ): Promise<ImportWorkspaceResult<T>> {
    if (input.requestedWorkspaceId) {
      const workspace = await workspaceRegistry.get(input.requestedWorkspaceId);
      if (!workspace || workspace.archivedAt) {
        throw new Error(`Workspace not found: ${input.requestedWorkspaceId}`);
      }
      const member = workspace.members.find((candidate) =>
        createRealpathAwarePathMatcher(candidate.cwd)(input.cwd),
      );
      if (!member) {
        throw new Error(`Import cwd does not match workspace: ${workspace.workspaceId}`);
      }
      const project = await projectRegistry.get(member.projectId);
      if (!project || project.archivedAt) {
        throw new Error(`Project not found: ${member.projectId}`);
      }
      return {
        value: await operation(workspace),
        createdWorkspace: null,
      };
    }

    const projectsBeforeImport = await projectRegistry.list();
    const workspace = await createWorkspaceForDirectory(input.cwd);
    const importedMember = workspace.members.find((member) =>
      areEquivalentPaths(member.cwd, input.cwd),
    )!;
    const previousProject =
      projectsBeforeImport.find((project) => project.projectId === importedMember.projectId) ??
      null;

    try {
      return {
        value: await operation(workspace),
        createdWorkspace: workspace,
      };
    } catch (error) {
      await rollbackFailedImportWorkspace(workspace, importedMember.projectId, previousProject);
      throw error;
    }
  }

  async function rollbackFailedImportWorkspace(
    workspace: PersistedWorkspaceRecord,
    projectId: string,
    previousProject: PersistedProjectRecord | null,
  ): Promise<void> {
    try {
      await workspaceRegistry.remove(workspace.workspaceId);
      const projectHasActiveWorkspace = (await workspaceRegistry.list()).some(
        (candidate) =>
          !candidate.archivedAt &&
          candidate.members.some((member) => member.projectId === projectId),
      );
      if (projectHasActiveWorkspace) {
        return;
      }
      if (previousProject?.archivedAt) {
        await projectRegistry.upsert(previousProject);
      } else if (!previousProject) {
        await projectRegistry.remove(projectId);
      }
    } catch (error) {
      logger.error(
        { err: error, workspaceId: workspace.workspaceId, projectId },
        "Failed to restore workspace state after provider import failure",
      );
    }
  }

  async function findOrCreateProjectForDirectory(cwd: string): Promise<PersistedProjectRecord> {
    const rootPath = resolve(cwd);
    const checkout = await workspaceGitService.getCheckout(rootPath);
    const timestamp = new Date().toISOString();
    return projectRegistry.getOrCreateActiveByRoot({
      rootPath,
      kind: checkout.isGit ? "git" : "non_git",
      displayName: basename(rootPath) || rootPath,
      projectKey: deriveProjectKey({
        rootPath,
        remoteUrl: checkout.remoteUrl,
        worktreeRoot: checkout.worktreeRoot,
        mainRepoRoot: checkout.mainRepoRoot,
        serverId,
      }),
      timestamp,
    });
  }

  async function requireActiveProject(projectId: string): Promise<PersistedProjectRecord> {
    const project = await projectRegistry.get(projectId);
    if (!project)
      throw new WorkspaceProvisioningError("unknown_project", `Unknown project: ${projectId}`);
    if (project.archivedAt)
      throw new WorkspaceProvisioningError("archived_project", `Archived project: ${projectId}`);
    return project;
  }

  async function createWorkspaceForDirectory(
    cwd: string,
    title?: string | null,
    projectId?: string,
    context?: { expectsInitialAgent?: boolean },
  ): Promise<PersistedWorkspaceRecord> {
    const normalizedCwd = resolve(cwd);
    const checkout = await workspaceGitService.getCheckout(normalizedCwd);
    const project = projectId
      ? await refreshProjectKind(await requireActiveProject(projectId), normalizedCwd, checkout)
      : // COMPAT(workspaceCreateMissingProjectId): added in v0.1.107, remove after 2027-01-15.
        await findOrCreateProjectForDirectory(normalizedCwd);
    const timestamp = new Date().toISOString();
    const member = {
      projectId: project.projectId,
      ...initialWorkspacePlacement({ source: "checkout", cwd: normalizedCwd, checkout }),
    };
    const workspace = createPersistedWorkspaceRecord({
      workspaceId: generateWorkspaceId(),
      displayName: member.displayName,
      members: [member],
      title: title?.trim() || null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await workspaceRegistry.upsert(workspace, context);
    return workspace;
  }

  async function createProjectlessWorkspace(
    title?: string | null,
    context?: { expectsInitialAgent?: boolean },
  ): Promise<PersistedWorkspaceRecord> {
    const timestamp = new Date().toISOString();
    const workspaceId = generateWorkspaceId();
    const displayName = title?.trim() || "New workspace";
    const workspace = createPersistedWorkspaceRecord({
      workspaceId,
      displayName,
      title: title?.trim() || null,
      members: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await workspaceRegistry.upsert(workspace, context);
    return workspace;
  }

  async function createWorkspaceForWorktree(
    input: CreateWorktreeWorkspaceInput,
  ): Promise<PersistedWorkspaceRecord> {
    const sourceCwd = resolve(input.sourceCwd);
    const repoRoot = resolve(input.repoRoot);
    const cwd = resolve(input.cwd);
    const worktreeRoot = resolve(input.worktreeRoot);
    const project = await resolveSourceProjectForWorktree({
      sourceCwd,
      projectId: input.projectId,
      repoRoot,
    });
    const timestamp = new Date().toISOString();
    const member = {
      projectId: project.projectId,
      ...initialWorkspacePlacement({
        source: "created_worktree",
        cwd,
        worktreeRoot,
        branch: input.branch,
        baseBranch: input.baseBranch,
        mainRepoRoot: repoRoot,
      }),
    };
    const workspace = createPersistedWorkspaceRecord({
      workspaceId: generateWorkspaceId(),
      displayName: member.displayName,
      members: [member],
      title: input.title,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await workspaceRegistry.upsert(workspace, {
      expectsInitialAgent: input.expectsInitialAgent,
    });
    return workspace;
  }

  async function resolveSourceProjectForWorktree(input: {
    sourceCwd: string;
    projectId?: string;
    repoRoot: string;
  }): Promise<PersistedProjectRecord> {
    if (input.projectId) {
      return refreshProjectKind(await requireActiveProject(input.projectId));
    }

    const members = (await workspaceRegistry.list())
      .filter((workspace) => !workspace.archivedAt)
      .flatMap((workspace) => workspace.members);
    const sourceMember =
      members.find((member) => areEquivalentPaths(member.cwd, input.sourceCwd)) ??
      members.find((member) => areEquivalentPaths(member.cwd, input.repoRoot));
    if (sourceMember) {
      const project = await projectRegistry.get(sourceMember.projectId);
      if (project) return refreshProjectKind(project);
      // COMPAT(worktreeMissingSourceProject): added in v0.1.107, remove after 2027-01-15.
      // Orphaned legacy memberships fall through to exact-root allocation.
    }

    const checkout = await workspaceGitService.getCheckout(input.repoRoot);
    const project = await projectRegistry.getOrCreateActiveByRoot({
      rootPath: input.repoRoot,
      kind: "git",
      displayName: basename(input.repoRoot) || input.repoRoot,
      projectKey: deriveProjectKey({
        rootPath: input.repoRoot,
        remoteUrl: checkout.remoteUrl,
        worktreeRoot: checkout.worktreeRoot,
        mainRepoRoot: checkout.mainRepoRoot,
        serverId,
      }),
      timestamp: new Date().toISOString(),
    });
    return refreshProjectKind(project);
  }

  async function findOrCreateWorkspaceForDirectory(cwd: string): Promise<PersistedWorkspaceRecord> {
    const normalizedCwd = resolve(cwd);
    const workspaces = await workspaceRegistry.list();
    const active = workspaces
      .filter(
        (workspace) =>
          !workspace.archivedAt &&
          workspace.members.some((member) => areEquivalentPaths(member.cwd, normalizedCwd)),
      )
      .sort(
        (left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
          left.workspaceId.localeCompare(right.workspaceId),
      )[0];
    if (active) return refreshWorkspaceRecord(active);
    const archived = workspaces
      .filter(
        (workspace) =>
          workspace.archivedAt &&
          workspace.members.some((member) => areEquivalentPaths(member.cwd, normalizedCwd)),
      )
      .sort(
        (left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
          left.workspaceId.localeCompare(right.workspaceId),
      )[0];
    if (archived) {
      const member = archived.members.find((candidate) =>
        areEquivalentPaths(candidate.cwd, normalizedCwd),
      )!;
      const project = await projectRegistry.get(member.projectId);
      if (project && !project.archivedAt) return ensureWorkspaceRecordUnarchived(archived);
    }
    return createWorkspaceForDirectory(normalizedCwd);
  }

  async function resolveOrCreateWorkspaceIdForCreateAgent(
    input: ResolveOrCreateWorkspaceIdInput,
  ): Promise<string> {
    if (input.createdWorktree) return input.createdWorktree.workspace.workspaceId;
    if (input.requestedWorkspaceId) return input.requestedWorkspaceId;
    return (
      await createWorkspaceForDirectory(input.cwd, input.initialTitle, undefined, {
        expectsInitialAgent: true,
      })
    ).workspaceId;
  }

  async function resolveRestoredAutoArchiveChangeRequestUrl(
    workspace: PersistedWorkspaceRecord,
  ): Promise<string | null> {
    if (!workspace.archivedAt) return workspace.autoArchivedChangeRequestUrl;
    const snapshots = await Promise.all(
      workspace.members.map((member) =>
        workspaceGitService.getSnapshot(member.cwd, {
          force: true,
          includeForge: true,
          reason: "workspace-restore-auto-archive-latch",
        }),
      ),
    );
    const mergedUrls = new Set(
      snapshots.flatMap((snapshot) =>
        snapshot.forge.pullRequest?.isMerged ? [snapshot.forge.pullRequest.url] : [],
      ),
    );
    return mergedUrls.size === 1 ? [...mergedUrls][0] : workspace.autoArchivedChangeRequestUrl;
  }

  async function ensureWorkspaceRecordUnarchived(
    workspace: PersistedWorkspaceRecord,
  ): Promise<PersistedWorkspaceRecord> {
    const timestamp = new Date().toISOString();
    // Finish all checkout reads before restoring any lifecycle record.
    const placements = await Promise.all(
      workspace.members.map(async (member) => {
        const project = await projectRegistry.get(member.projectId);
        if (!project) throw new Error(`Unknown project: ${member.projectId}`);
        const checkout =
          workspace.archivedAt || project.archivedAt
            ? await workspaceGitService.getCheckout(member.cwd)
            : null;
        let projectCheckout = checkout;
        if (checkout && !areEquivalentPaths(project.rootPath, member.cwd)) {
          projectCheckout = await workspaceGitService.getCheckout(project.rootPath);
        }
        return { member, project, checkout, projectCheckout };
      }),
    );
    const autoArchivedChangeRequestUrl =
      await resolveRestoredAutoArchiveChangeRequestUrl(workspace);
    for (const { project, projectCheckout } of placements) {
      if (!projectCheckout) continue;
      const kind = projectCheckout.isGit ? "git" : "non_git";
      const projectKey = deriveProjectKey({
        rootPath: project.rootPath,
        remoteUrl: projectCheckout.remoteUrl,
        worktreeRoot: projectCheckout.worktreeRoot,
        mainRepoRoot: projectCheckout.mainRepoRoot,
        serverId,
      });
      if (project.archivedAt || project.kind !== kind || project.projectKey !== projectKey) {
        await projectRegistry.upsert({
          ...project,
          kind,
          projectKey,
          archivedAt: null,
          updatedAt: timestamp,
        });
      }
    }
    if (!workspace.archivedAt) return workspace;
    const updates = new Map(
      placements.map(({ member, checkout }) => [
        member.cwd,
        checkout ? reconcileWorkspacePlacement({ member, checkout })?.fields : undefined,
      ]),
    );
    return (
      (await workspaceRegistry.update(workspace.workspaceId, (current) => ({
        ...current,
        members: current.members.map((member) => ({ ...member, ...updates.get(member.cwd) })),
        archivedAt: null,
        autoArchivedChangeRequestUrl,
        updatedAt: timestamp,
      }))) ?? workspace
    );
  }

  async function refreshWorkspaceRecord(
    workspace: PersistedWorkspaceRecord,
  ): Promise<PersistedWorkspaceRecord> {
    const updates = new Map<string, Partial<MutableWorkspacePlacement>>();
    for (const member of workspace.members) {
      const checkout = await workspaceGitService.getCheckout(member.cwd);
      const project = await projectRegistry.get(member.projectId);
      if (project && !project.archivedAt) await refreshProjectKind(project, member.cwd, checkout);
      const update = reconcileWorkspacePlacement({ member, checkout });
      if (update) updates.set(member.cwd, update.fields);
    }
    if (updates.size === 0) return workspace;
    return (
      (await workspaceRegistry.update(workspace.workspaceId, (current) => ({
        ...current,
        members: current.members.map((member) => {
          const fields = updates.get(member.cwd);
          return fields ? { ...member, ...fields } : member;
        }),
        updatedAt: new Date().toISOString(),
      }))) ?? workspace
    );
  }

  async function refreshProjectKind(
    project: PersistedProjectRecord,
    workspaceCwd?: string,
    workspaceCheckout?: Awaited<ReturnType<WorkspaceGitService["getCheckout"]>>,
  ): Promise<PersistedProjectRecord> {
    const projectCheckout =
      workspaceCwd && workspaceCheckout && areEquivalentPaths(project.rootPath, workspaceCwd)
        ? workspaceCheckout
        : await workspaceGitService.getCheckout(project.rootPath);
    const kind: PersistedProjectRecord["kind"] = projectCheckout.isGit ? "git" : "non_git";
    const projectKey = deriveProjectKey({
      rootPath: project.rootPath,
      remoteUrl: projectCheckout.remoteUrl,
      worktreeRoot: projectCheckout.worktreeRoot,
      mainRepoRoot: projectCheckout.mainRepoRoot,
      serverId,
    });
    if (project.kind === kind && project.projectKey === projectKey) return project;
    const refreshed = {
      ...project,
      kind,
      projectKey,
      updatedAt: new Date().toISOString(),
    };
    await projectRegistry.upsert(refreshed);
    return refreshed;
  }

  async function addWorkspaceMember(
    input: AddWorkspaceMemberInput,
  ): Promise<PersistedWorkspaceRecord> {
    const workspace = await workspaceRegistry.get(input.workspaceId);
    if (!workspace) {
      throw new WorkspaceProvisioningError(
        "workspace_not_found",
        `Unknown workspace: ${input.workspaceId}`,
      );
    }
    if (workspace.archivedAt) {
      throw new WorkspaceProvisioningError(
        "archived_workspace",
        `Archived workspace: ${input.workspaceId}`,
      );
    }
    const normalizedCwd = resolve(input.source.path);
    // Fast-path guard ahead of the git/project side effects; the updater below
    // repeats it under the registry's mutation queue.
    if (
      workspaceMembers(workspace).some((candidate) =>
        areEquivalentPaths(candidate.cwd, normalizedCwd),
      )
    ) {
      throw new WorkspaceProvisioningError(
        "duplicate_member",
        `Workspace ${input.workspaceId} already has a member at ${normalizedCwd}`,
      );
    }
    const checkout = await workspaceGitService.getCheckout(normalizedCwd);
    const project = input.source.projectId
      ? await refreshProjectKind(
          await requireActiveProject(input.source.projectId),
          normalizedCwd,
          checkout,
        )
      : await findOrCreateProjectForDirectory(normalizedCwd);
    const member: PersistedWorkspaceMember = {
      projectId: project.projectId,
      ...initialWorkspacePlacement({ source: "checkout", cwd: normalizedCwd, checkout }),
    };
    const timestamp = new Date().toISOString();
    const updated = await workspaceRegistry.update(input.workspaceId, (current) => {
      if (current.archivedAt) {
        throw new WorkspaceProvisioningError(
          "archived_workspace",
          `Archived workspace: ${input.workspaceId}`,
        );
      }
      const members = workspaceMembers(current);
      if (members.some((candidate) => areEquivalentPaths(candidate.cwd, normalizedCwd))) {
        throw new WorkspaceProvisioningError(
          "duplicate_member",
          `Workspace ${input.workspaceId} already has a member at ${normalizedCwd}`,
        );
      }
      return { ...current, members: [...members, member], updatedAt: timestamp };
    });
    if (!updated) {
      throw new WorkspaceProvisioningError(
        "workspace_not_found",
        `Unknown workspace: ${input.workspaceId}`,
      );
    }
    return updated;
  }

  async function removeWorkspaceMember(
    input: RemoveWorkspaceMemberInput,
  ): Promise<PersistedWorkspaceRecord> {
    const normalizedCwd = resolve(input.cwd);
    const timestamp = new Date().toISOString();
    const updated = await workspaceRegistry.update(input.workspaceId, (current) => {
      if (current.archivedAt) {
        throw new WorkspaceProvisioningError(
          "archived_workspace",
          `Archived workspace: ${input.workspaceId}`,
        );
      }
      const members = workspaceMembers(current);
      const remaining = members.filter(
        (candidate) => !areEquivalentPaths(candidate.cwd, normalizedCwd),
      );
      if (remaining.length === members.length) {
        throw new WorkspaceProvisioningError(
          "member_not_found",
          `Workspace ${input.workspaceId} has no member at ${normalizedCwd}`,
        );
      }
      return {
        ...current,
        members: remaining,
        updatedAt: timestamp,
      };
    });
    if (!updated) {
      throw new WorkspaceProvisioningError(
        "workspace_not_found",
        `Unknown workspace: ${input.workspaceId}`,
      );
    }
    return updated;
  }

  async function moveWorkspaceMember(
    input: MoveWorkspaceMemberInput,
  ): Promise<MoveWorkspaceMemberResult> {
    const normalizedCwd = resolve(input.cwd);
    const source = await workspaceRegistry.get(input.sourceWorkspaceId);
    if (!source) {
      throw new WorkspaceProvisioningError(
        "workspace_not_found",
        `Unknown workspace: ${input.sourceWorkspaceId}`,
      );
    }
    if (source.archivedAt) {
      throw new WorkspaceProvisioningError(
        "archived_workspace",
        `Archived workspace: ${input.sourceWorkspaceId}`,
      );
    }
    const target = await workspaceRegistry.get(input.targetWorkspaceId);
    if (!target) {
      throw new WorkspaceProvisioningError(
        "workspace_not_found",
        `Unknown workspace: ${input.targetWorkspaceId}`,
      );
    }
    if (target.archivedAt) {
      throw new WorkspaceProvisioningError(
        "archived_workspace",
        `Archived workspace: ${input.targetWorkspaceId}`,
      );
    }
    // Fast-path guards ahead of the git/project side effects; the updaters below
    // repeat them under the registry's mutation queue.
    if (
      !workspaceMembers(source).some((candidate) =>
        areEquivalentPaths(candidate.cwd, normalizedCwd),
      )
    ) {
      throw new WorkspaceProvisioningError(
        "member_not_found",
        `Workspace ${input.sourceWorkspaceId} has no member at ${normalizedCwd}`,
      );
    }
    if (
      workspaceMembers(target).some((candidate) => areEquivalentPaths(candidate.cwd, normalizedCwd))
    ) {
      throw new WorkspaceProvisioningError(
        "duplicate_member",
        `Workspace ${input.targetWorkspaceId} already has a member at ${normalizedCwd}`,
      );
    }
    const checkout = await workspaceGitService.getCheckout(normalizedCwd);
    const project = await findOrCreateProjectForDirectory(normalizedCwd);
    const member: PersistedWorkspaceMember = {
      projectId: project.projectId,
      ...initialWorkspacePlacement({ source: "checkout", cwd: normalizedCwd, checkout }),
    };
    const timestamp = new Date().toISOString();
    // Append before strip: a concurrent failure mid-move leaves the member in
    // both workspaces (removable) rather than in neither (lost).
    const updatedTarget = await workspaceRegistry.update(input.targetWorkspaceId, (current) => {
      if (current.archivedAt) {
        throw new WorkspaceProvisioningError(
          "archived_workspace",
          `Archived workspace: ${input.targetWorkspaceId}`,
        );
      }
      const members = workspaceMembers(current);
      if (members.some((candidate) => areEquivalentPaths(candidate.cwd, normalizedCwd))) {
        throw new WorkspaceProvisioningError(
          "duplicate_member",
          `Workspace ${input.targetWorkspaceId} already has a member at ${normalizedCwd}`,
        );
      }
      return { ...current, members: [...members, member], updatedAt: timestamp };
    });
    if (!updatedTarget) {
      throw new WorkspaceProvisioningError(
        "workspace_not_found",
        `Unknown workspace: ${input.targetWorkspaceId}`,
      );
    }
    const updatedSource = await workspaceRegistry.update(input.sourceWorkspaceId, (current) => {
      if (current.archivedAt) {
        throw new WorkspaceProvisioningError(
          "archived_workspace",
          `Archived workspace: ${input.sourceWorkspaceId}`,
        );
      }
      const members = workspaceMembers(current);
      const remaining = members.filter(
        (candidate) => !areEquivalentPaths(candidate.cwd, normalizedCwd),
      );
      if (remaining.length === members.length) {
        throw new WorkspaceProvisioningError(
          "member_not_found",
          `Workspace ${input.sourceWorkspaceId} has no member at ${normalizedCwd}`,
        );
      }
      return {
        ...current,
        members: remaining,
        updatedAt: timestamp,
      };
    });
    if (!updatedSource) {
      throw new WorkspaceProvisioningError(
        "workspace_not_found",
        `Unknown workspace: ${input.sourceWorkspaceId}`,
      );
    }
    return { source: updatedSource, target: updatedTarget };
  }

  return {
    runInImportWorkspace,
    findOrCreateWorkspaceForDirectory,
    resolveOrCreateWorkspaceIdForCreateAgent,
    createWorkspaceForDirectory,
    createProjectlessWorkspace,
    createWorkspaceForWorktree,
    findOrCreateProjectForDirectory,
    ensureWorkspaceRecordUnarchived,
    addWorkspaceMember,
    removeWorkspaceMember,
    moveWorkspaceMember,
  };
}
