import equal from "fast-deep-equal";
import type {
  ScriptStatusUpdateMessage,
  SessionOutboundMessage,
} from "@getpaseo/protocol/messages";
import {
  normalizeProjectDescriptor,
  normalizeWorkspaceDescriptor,
  useSessionStore,
  type ProjectDescriptor,
  type WorkspaceDescriptor,
} from "@/stores/session-store";
import { useWorkspaceSetupStore } from "@/stores/workspace-setup-store";
import {
  clearWorkspaceArchivePending,
  shouldSuppressWorkspaceForLocalArchive,
} from "@/contexts/session-workspace-upserts";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import type { DirectoryReplicaMutation } from "@/runtime/replica-cache";

export type WorkspaceDirectoryDelta =
  | Extract<SessionOutboundMessage, { type: "workspace_update" | "project.update" }>["payload"]
  | { kind: "script_status"; update: ScriptStatusUpdateMessage["payload"] };

export interface WorkspaceDirectorySnapshot {
  workspaces: Map<string, WorkspaceDescriptor>;
  projects: Map<string, ProjectDescriptor>;
  syncCursors?: Partial<
    Record<"projects" | "workspaces", { generation: string; afterSeq: number }>
  >;
  syncModes?: Partial<Record<"projects" | "workspaces", "snapshot" | "changes">>;
  touchedWorkspaceIds?: Set<string>;
  touchedProjectIds?: Set<string>;
}

export class WorkspaceDirectoryReplica {
  private workspaces = new Map<string, WorkspaceDescriptor>();
  private projects = new Map<string, ProjectDescriptor>();
  private workspaceIdsByProject = new Map<string, Set<string>>();

  constructor(private readonly serverId: string) {}

  applyDelta(delta: WorkspaceDirectoryDelta): DirectoryReplicaMutation[] {
    if (delta.kind === "script_status") return this.applyScriptStatus(delta.update);
    if ("projectId" in delta || "project" in delta) return this.applyProjectDelta(delta);
    if (delta.kind === "remove") return this.removeWorkspace(delta);
    return this.upsertWorkspace(normalizeWorkspaceDescriptor(delta.workspace));
  }

  commitCached(input: {
    workspaces: Map<string, WorkspaceDescriptor>;
    projects: Map<string, ProjectDescriptor>;
  }): void {
    this.replace({
      workspaces: new Map([...input.workspaces, ...this.workspaces]),
      projects: new Map([...input.projects, ...this.projects]),
    });
    useSessionStore.getState().setHasWorkspaceDirectorySnapshot(this.serverId, true);
  }

  commitCachedWorkspace(
    workspace: WorkspaceDescriptor,
    projects: readonly ProjectDescriptor[],
  ): void {
    if (shouldSuppressWorkspaceForLocalArchive({ serverId: this.serverId, workspace })) return;
    for (const project of projects) this.setProject(project);
    this.setWorkspace(workspace);
  }

  commitSnapshot(
    snapshot: WorkspaceDirectorySnapshot,
    deltas: readonly WorkspaceDirectoryDelta[],
  ): DirectoryReplicaMutation[] {
    this.replace(snapshot);
    const mutations = deltas.flatMap((delta) => this.applyDelta(delta));
    useSessionStore.getState().setHasHydratedWorkspaces(this.serverId, true);
    return mutations;
  }

  snapshot(): WorkspaceDirectorySnapshot {
    return { workspaces: this.workspaces, projects: this.projects };
  }

  acceptWorkspaces(workspaces: readonly WorkspaceDescriptor[]): DirectoryReplicaMutation[] {
    return workspaces.flatMap((workspace) => this.upsertWorkspace(workspace));
  }

  acceptProject(project: ProjectDescriptor): DirectoryReplicaMutation[] {
    this.setProject(project);
    return [{ kind: "project", type: "upsert", id: project.projectId, value: project }];
  }

  removeWorkspaceSnapshot(workspaceId: string): DirectoryReplicaMutation[] {
    this.deleteWorkspace(workspaceId);
    return [{ kind: "workspace", type: "delete", id: workspaceId }];
  }

  private replace(snapshot: WorkspaceDirectorySnapshot): void {
    const workspaces = new Map<string, WorkspaceDescriptor>();
    for (const [workspaceId, workspace] of snapshot.workspaces) {
      if (!shouldSuppressWorkspaceForLocalArchive({ serverId: this.serverId, workspace })) {
        workspaces.set(workspaceId, workspace);
      }
    }
    this.workspaces = workspaces;
    this.projects = new Map(snapshot.projects);
    this.rebuildProjectIndex();
    const store = useSessionStore.getState();
    store.setWorkspaces(this.serverId, this.workspaces);
    store.setProjects(this.serverId, this.projects.values());
  }

  private applyScriptStatus(
    update: ScriptStatusUpdateMessage["payload"],
  ): DirectoryReplicaMutation[] {
    const workspaceId = resolveWorkspaceMapKeyByIdentity({
      workspaces: this.workspaces,
      workspaceId: update.workspaceId,
    });
    const workspace = workspaceId ? this.workspaces.get(workspaceId) : undefined;
    if (!workspace) return [];
    const scripts = update.cwd
      ? [...workspace.scripts.filter((script) => script.cwd !== update.cwd), ...update.scripts]
      : update.scripts;
    if (equal(workspace.scripts, scripts)) return [];
    const next = { ...workspace, scripts: scripts.map((script) => Object.assign({}, script)) };
    this.setWorkspace(next);
    return [{ kind: "workspace", type: "upsert", id: next.id, value: next }];
  }

  private applyProjectDelta(
    delta: Extract<SessionOutboundMessage, { type: "project.update" }>["payload"],
  ): DirectoryReplicaMutation[] {
    if (delta.kind === "remove") {
      const mutations: DirectoryReplicaMutation[] = [
        { kind: "project", type: "delete", id: delta.projectId },
      ];
      this.projects.delete(delta.projectId);
      useSessionStore.getState().removeProject(this.serverId, delta.projectId);
      for (const workspaceId of Array.from(this.workspaceIdsByProject.get(delta.projectId) ?? [])) {
        const workspace = this.workspaces.get(workspaceId);
        if (!workspace) continue;
        const members = workspace.members.filter((member) => member.projectId !== delta.projectId);
        if (members.length === workspace.members.length) continue;
        const next = { ...workspace, members };
        this.setWorkspace(next);
        mutations.push({ kind: "workspace", type: "upsert", id: next.id, value: next });
      }
      return mutations;
    }

    const project = normalizeProjectDescriptor(delta.project);
    this.setProject(project);
    const mutations: DirectoryReplicaMutation[] = [
      { kind: "project", type: "upsert", id: project.projectId, value: project },
    ];
    for (const workspaceId of Array.from(this.workspaceIdsByProject.get(project.projectId) ?? [])) {
      const workspace = this.workspaces.get(workspaceId);
      if (!workspace) continue;
      const members = workspace.members.map((member) =>
        member.projectId === project.projectId ? Object.assign({}, member, project) : member,
      );
      const next = {
        ...workspace,
        members,
        ...(workspace.projectId === project.projectId
          ? {
              projectDisplayName: project.projectDisplayName,
              projectCustomName: project.projectCustomName,
              projectCustomIconRevision: project.projectCustomIconRevision,
              projectRootPath: project.projectRootPath,
              projectKind: project.projectKind,
            }
          : {}),
      };
      this.setWorkspace(next);
      mutations.push({ kind: "workspace", type: "upsert", id: next.id, value: next });
    }
    return mutations;
  }

  private removeWorkspace(
    delta: Extract<SessionOutboundMessage, { type: "workspace_update" }>["payload"] & {
      kind: "remove";
    },
  ): DirectoryReplicaMutation[] {
    this.deleteWorkspace(delta.id);
    const mutations: DirectoryReplicaMutation[] = [
      { kind: "workspace", type: "delete", id: delta.id },
    ];
    if (delta.emptyProject) {
      const project = normalizeProjectDescriptor(delta.emptyProject);
      this.setProject(project);
      mutations.push({ kind: "project", type: "upsert", id: project.projectId, value: project });
    }
    if (delta.removedProjectId) {
      this.projects.delete(delta.removedProjectId);
      useSessionStore.getState().removeProject(this.serverId, delta.removedProjectId);
      mutations.push({ kind: "project", type: "delete", id: delta.removedProjectId });
    }
    clearWorkspaceArchivePending({ serverId: this.serverId, workspaceId: delta.id });
    useWorkspaceSetupStore
      .getState()
      .removeWorkspace({ serverId: this.serverId, workspaceId: delta.id });
    return mutations;
  }

  private upsertWorkspace(workspace: WorkspaceDescriptor): DirectoryReplicaMutation[] {
    if (shouldSuppressWorkspaceForLocalArchive({ serverId: this.serverId, workspace })) {
      if (!this.workspaces.has(workspace.id)) return [];
      this.deleteWorkspace(workspace.id);
      return [{ kind: "workspace", type: "delete", id: workspace.id }];
    }
    this.setWorkspace(workspace);
    return [{ kind: "workspace", type: "upsert", id: workspace.id, value: workspace }];
  }

  private setWorkspace(workspace: WorkspaceDescriptor): void {
    const previous = this.workspaces.get(workspace.id);
    if (previous) this.unindexWorkspace(previous);
    this.workspaces.set(workspace.id, workspace);
    this.indexWorkspace(workspace);
    useSessionStore.getState().mergeWorkspaces(this.serverId, [workspace]);
  }

  private deleteWorkspace(workspaceId: string): void {
    const workspace = this.workspaces.get(workspaceId);
    if (workspace) this.unindexWorkspace(workspace);
    this.workspaces.delete(workspaceId);
    useSessionStore.getState().removeWorkspace(this.serverId, workspaceId);
  }

  private setProject(project: ProjectDescriptor): void {
    this.projects.set(project.projectId, project);
    useSessionStore.getState().upsertProject(this.serverId, project);
  }

  private workspaceProjectIds(workspace: WorkspaceDescriptor): string[] {
    const ids = new Set<string>([workspace.projectId]);
    for (const member of workspace.members) ids.add(member.projectId);
    return [...ids];
  }

  private indexWorkspace(workspace: WorkspaceDescriptor): void {
    for (const projectId of this.workspaceProjectIds(workspace)) {
      const workspaceIds = this.workspaceIdsByProject.get(projectId) ?? new Set();
      workspaceIds.add(workspace.id);
      this.workspaceIdsByProject.set(projectId, workspaceIds);
    }
  }

  private unindexWorkspace(workspace: WorkspaceDescriptor): void {
    for (const projectId of this.workspaceProjectIds(workspace)) {
      this.workspaceIdsByProject.get(projectId)?.delete(workspace.id);
    }
  }

  private rebuildProjectIndex(): void {
    this.workspaceIdsByProject = new Map();
    for (const workspace of this.workspaces.values()) {
      this.indexWorkspace(workspace);
    }
  }
}
