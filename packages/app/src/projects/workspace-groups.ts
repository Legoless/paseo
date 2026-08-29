import type { Agent, ProjectDescriptor, WorkspaceDescriptor } from "@/stores/session-store";
import { createProjectIconTarget, type ProjectIconTarget } from "@/projects/icon-target";
import { deriveSidebarStateBucket, type SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { normalizeWorkspaceOpaqueId, normalizeWorkspacePath } from "@/utils/workspace-identity";

export interface SidebarWorkspaceAgentRow {
  agentId: string;
  title: string;
  statusBucket: SidebarStateBucket;
  lastActivityAt: Date;
}

export interface SidebarWorkspaceMemberRow {
  /** `${workspaceKey}#${workspaceDirectory}` — the member's cwd is its removal key. */
  memberKey: string;
  projectId: string;
  projectName: string;
  workspaceDirectory: string;
  branch: string | null;
  /** Live diff for the member's directory; null when the daemon has no snapshot for it. */
  diffStat: { additions: number; deletions: number } | null;
  /** The primary member inherits every agent whose cwd matches no member directory. */
  isPrimary: boolean;
  agents: SidebarWorkspaceAgentRow[];
}

export interface SidebarWorkspaceSection {
  workspaceKey: string;
  serverId: string;
  workspaceId: string;
  members: SidebarWorkspaceMemberRow[];
}

export interface SidebarWorkspaceGroupModel {
  sectionsByWorkspaceKey: Map<string, SidebarWorkspaceSection>;
  /** One icon target per member row, keyed by `memberKey` through `projectViewKey`. */
  memberIconTargets: ProjectIconTarget[];
}

export interface SidebarWorkspaceGroupSession {
  serverId: string;
  workspaces: ReadonlyMap<string, WorkspaceDescriptor>;
  agents: ReadonlyMap<string, Agent>;
  projects: ReadonlyMap<string, ProjectDescriptor>;
}

/**
 * The sidebar's workspace-grouped hierarchy below the workspace row: each workspace's project
 * members with their agents bucketed underneath. Pure — the hook layer owns subscriptions and
 * identity preservation.
 */
export function buildSidebarWorkspaceGroupModel(input: {
  sessions: readonly SidebarWorkspaceGroupSession[];
}): SidebarWorkspaceGroupModel {
  const sectionsByWorkspaceKey = new Map<string, SidebarWorkspaceSection>();
  const memberIconTargets: ProjectIconTarget[] = [];

  for (const session of input.sessions) {
    for (const workspace of session.workspaces.values()) {
      const { section, iconTargets } = buildWorkspaceSection({
        serverId: session.serverId,
        workspace,
        agents: session.agents,
        projects: session.projects,
      });
      sectionsByWorkspaceKey.set(section.workspaceKey, section);
      memberIconTargets.push(...iconTargets);
    }
  }

  return { sectionsByWorkspaceKey, memberIconTargets };
}

function buildWorkspaceSection(input: {
  serverId: string;
  workspace: WorkspaceDescriptor;
  agents: ReadonlyMap<string, Agent>;
  projects: ReadonlyMap<string, ProjectDescriptor>;
}): { section: SidebarWorkspaceSection; iconTargets: ProjectIconTarget[] } {
  const workspaceId = input.workspace.id;
  const workspaceKey = `${input.serverId}:${workspaceId}`;
  const iconTargets: ProjectIconTarget[] = [];
  const members = input.workspace.members.map<SidebarWorkspaceMemberRow>((member, index) => {
    const memberKey = `${workspaceKey}#${member.workspaceDirectory}`;
    const project = input.projects.get(member.projectId);
    const target = createProjectIconTarget({
      projectViewKey: memberKey,
      placement: {
        serverId: input.serverId,
        projectId: member.projectId,
        iconWorkingDir: member.projectRootPath,
        customIconRevision: project?.projectCustomIconRevision ?? null,
        iconRevision: project?.projectIconRevision,
      },
    });
    if (target) {
      iconTargets.push(target);
    }
    return {
      memberKey,
      projectId: member.projectId,
      projectName: member.projectCustomName ?? member.projectDisplayName,
      workspaceDirectory: member.workspaceDirectory,
      branch: member.branch,
      diffStat: member.diffStat ?? null,
      isPrimary: index === 0,
      agents: [],
    };
  });

  const bucketByDirectory = new Map<string, SidebarWorkspaceAgentRow[]>();
  for (const member of members) {
    const directory = normalizeWorkspacePath(member.workspaceDirectory);
    if (directory && !bucketByDirectory.has(directory)) {
      bucketByDirectory.set(directory, member.agents);
    }
  }
  const primaryBucket = members[0]?.agents ?? null;

  for (const agent of input.agents.values()) {
    if (agent.archivedAt) continue;
    if (normalizeWorkspaceOpaqueId(agent.workspaceId) !== workspaceId) continue;
    const directory = normalizeWorkspacePath(agent.cwd);
    const bucket = (directory ? bucketByDirectory.get(directory) : undefined) ?? primaryBucket;
    bucket?.push(createAgentRow(agent));
  }

  for (const member of members) {
    member.agents.sort(compareAgentRows);
  }
  members.sort(compareMemberRows);

  return {
    section: { workspaceKey, serverId: input.serverId, workspaceId, members },
    iconTargets,
  };
}

function createAgentRow(agent: Agent): SidebarWorkspaceAgentRow {
  return {
    agentId: agent.id,
    title: agent.title?.trim() || "Untitled agent",
    statusBucket: deriveSidebarStateBucket({
      status: agent.status,
      pendingPermissionCount: agent.pendingPermissions.length,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason,
    }),
    lastActivityAt: agent.lastActivityAt,
  };
}

function compareMemberRows(
  left: SidebarWorkspaceMemberRow,
  right: SidebarWorkspaceMemberRow,
): number {
  return (
    left.projectName.localeCompare(right.projectName, undefined, {
      numeric: true,
      sensitivity: "base",
    }) || left.memberKey.localeCompare(right.memberKey)
  );
}

function compareAgentRows(left: SidebarWorkspaceAgentRow, right: SidebarWorkspaceAgentRow): number {
  return (
    right.lastActivityAt.getTime() - left.lastActivityAt.getTime() ||
    left.agentId.localeCompare(right.agentId)
  );
}

/**
 * Row memoization key. Agent activity churn rebuilds the model on every session change, so the
 * hook reuses the previous section/member/agent objects whenever their rendered fields are
 * unchanged — a token streaming into one agent must not re-render sibling rows.
 */
export function preserveSidebarWorkspaceGroupModelIdentity(
  previous: SidebarWorkspaceGroupModel,
  next: SidebarWorkspaceGroupModel,
): SidebarWorkspaceGroupModel {
  let allSectionsIdentical = true;
  const sectionsByWorkspaceKey = new Map<string, SidebarWorkspaceSection>();
  for (const [workspaceKey, nextSection] of next.sectionsByWorkspaceKey) {
    const previousSection = previous.sectionsByWorkspaceKey.get(workspaceKey);
    const section =
      previousSection && areSectionsEqual(previousSection, nextSection)
        ? previousSection
        : nextSection;
    if (section !== previousSection) {
      allSectionsIdentical = false;
    }
    sectionsByWorkspaceKey.set(workspaceKey, section);
  }
  if (
    allSectionsIdentical &&
    sectionsByWorkspaceKey.size === previous.sectionsByWorkspaceKey.size
  ) {
    return previous;
  }
  return { sectionsByWorkspaceKey, memberIconTargets: next.memberIconTargets };
}

function areSectionsEqual(left: SidebarWorkspaceSection, right: SidebarWorkspaceSection): boolean {
  if (
    left.workspaceKey !== right.workspaceKey ||
    left.serverId !== right.serverId ||
    left.workspaceId !== right.workspaceId ||
    left.members.length !== right.members.length
  ) {
    return false;
  }
  return left.members.every((leftMember, index) => {
    const rightMember = right.members[index];
    return Boolean(rightMember) && areMembersEqual(leftMember, rightMember);
  });
}

function areMembersEqual(
  left: SidebarWorkspaceMemberRow,
  right: SidebarWorkspaceMemberRow,
): boolean {
  if (
    left.memberKey !== right.memberKey ||
    left.projectId !== right.projectId ||
    left.projectName !== right.projectName ||
    left.workspaceDirectory !== right.workspaceDirectory ||
    left.branch !== right.branch ||
    left.isPrimary !== right.isPrimary ||
    left.agents.length !== right.agents.length
  ) {
    return false;
  }
  if (
    (left.diffStat?.additions ?? null) !== (right.diffStat?.additions ?? null) ||
    (left.diffStat?.deletions ?? null) !== (right.diffStat?.deletions ?? null)
  ) {
    return false;
  }
  return left.agents.every((leftAgent, index) => {
    const rightAgent = right.agents[index];
    return (
      Boolean(rightAgent) &&
      leftAgent.agentId === rightAgent.agentId &&
      leftAgent.title === rightAgent.title &&
      leftAgent.statusBucket === rightAgent.statusBucket &&
      leftAgent.lastActivityAt.getTime() === rightAgent.lastActivityAt.getTime()
    );
  });
}
