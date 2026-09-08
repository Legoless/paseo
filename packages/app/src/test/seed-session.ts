import {
  useSessionStore,
  type ProjectDescriptor,
  type WorkspaceDescriptor,
} from "@/stores/session-store";

/**
 * Seeds a session the way a daemon populates it: every workspace's project is
 * published on the project channel, so the store never holds a workspace whose
 * project is unknown. Tests that seed workspaces alone model a state the daemon
 * cannot produce, and nothing renders.
 */
export function seedSessionWorkspaces(
  serverId: string,
  workspaces: Map<string, WorkspaceDescriptor>,
  projects?: Iterable<ProjectDescriptor>,
): void {
  const byProjectId = new Map<string, ProjectDescriptor>();
  for (const project of projects ?? []) byProjectId.set(project.projectId, project);
  for (const workspace of workspaces.values()) {
    for (const member of workspace.members) {
      if (!byProjectId.has(member.projectId)) {
        byProjectId.set(member.projectId, {
          ...member,
          projectKey: member.projectKey ?? member.projectId,
          projectKind: member.projectKind ?? "directory",
        });
      }
    }
  }
  const store = useSessionStore.getState();
  store.setProjects(serverId, byProjectId.values());
  store.setWorkspaces(serverId, workspaces);
}
