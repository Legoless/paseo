import type { Agent, ProjectDescriptor, WorkspaceDescriptor } from "@/stores/session-store";
import { getAgentWorkspaceLabelNames } from "@getpaseo/protocol/agent-labels";
import { createProjectIconTarget, type ProjectIconTarget } from "@/projects/icon-target";
import { deriveSidebarStateBucket, type SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { normalizeWorkspaceOpaqueId, normalizeWorkspacePath } from "@/utils/workspace-identity";
import { shortenPath } from "@/utils/shorten-path";
import {
  collectAllPanes,
  collectAllTabs,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";
import { resolveExplorerSidebarPaneId } from "@/stores/workspace-layout-store";
import { deriveWorkspacePaneState } from "@/screens/workspace/workspace-pane-state";

export interface SidebarWorkspaceNewAgentRow {
  tabId: string;
  /** The name the user gave the tab; null keeps the "New Agent" placeholder. */
  title: string | null;
  createdAt: number;
  cwd: string;
  cwdLabel: string;
  matchesMemberDirectory: boolean;
  labels: string[];
}

export interface SidebarWorkspaceAgentRow {
  agentId: string;
  title: string;
  cwd: string;
  cwdLabel: string;
  matchesMemberDirectory: boolean;
  labels: string[];
  statusBucket: SidebarStateBucket;
  lastActivityAt: Date;
}

export interface SidebarWorkspaceMemberRow {
  /** `${workspaceKey}#${workspaceDirectory}` — the member's cwd is its removal key. */
  memberKey: string;
  projectId: string;
  projectName: string;
  workspaceDirectory: string;
  workspaceDirectoryLabel: string;
  /** Live diff for the member's directory; null when the daemon has no snapshot for it. */
  diffStat: { additions: number; deletions: number } | null;
  /** The primary member owns the workspace's PR facts. */
  isPrimary: boolean;
  newAgents?: SidebarWorkspaceNewAgentRow[];
  agents: SidebarWorkspaceAgentRow[];
}

export interface SidebarWorkspaceUncategorizedRow {
  /** `${workspaceKey}#uncategorized` — shares the member rows' drag-order namespace. */
  memberKey: string;
  newAgents?: SidebarWorkspaceNewAgentRow[];
  agents: SidebarWorkspaceAgentRow[];
}

export interface SidebarWorkspaceSection {
  workspaceKey: string;
  serverId: string;
  workspaceId: string;
  /**
   * Agents and launcher tabs whose cwd is no member's directory. A tab owns its own project, so
   * one that has not chosen a project belongs to no member — putting it under the primary member
   * claimed a project it never had, and lent it that project's branch and diff.
   */
  uncategorized: SidebarWorkspaceUncategorizedRow;
  members: SidebarWorkspaceMemberRow[];
  /** How many panes glow each color that wants the user: orange, red and green. */
  paneStatusCounts: SidebarPaneStatusCounts;
}

/** The pane glow colors the sidebar counts: needs input, failed, and a finish nobody has seen. */
export type SidebarPaneStatusBucket = Extract<
  SidebarStateBucket,
  "needs_input" | "failed" | "attention"
>;

export type SidebarPaneStatusCounts = Readonly<Record<SidebarPaneStatusBucket, number>>;

export const EMPTY_PANE_STATUS_COUNTS: SidebarPaneStatusCounts = {
  needs_input: 0,
  failed: 0,
  attention: 0,
};

function isPaneStatusBucket(
  bucket: SidebarStateBucket | undefined,
): bucket is SidebarPaneStatusBucket {
  return bucket === "needs_input" || bucket === "failed" || bucket === "attention";
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
 * members with their agents bucketed underneath. Agent rows match open agent tabs — closing
 * a tab removes the row. Pure — the hook layer owns subscriptions and identity preservation.
 */
export function buildSidebarWorkspaceGroupModel(input: {
  sessions: readonly SidebarWorkspaceGroupSession[];
  layoutsByWorkspace?: Readonly<Record<string, WorkspaceLayout>>;
  explorerPaneIdByWorkspace?: Readonly<Record<string, string | null>>;
}): SidebarWorkspaceGroupModel {
  const sectionsByWorkspaceKey = new Map<string, SidebarWorkspaceSection>();
  const memberIconTargets: ProjectIconTarget[] = [];

  for (const session of input.sessions) {
    for (const workspace of session.workspaces.values()) {
      const workspaceKey = `${session.serverId}:${workspace.id}`;
      const { section, iconTargets } = buildWorkspaceSection({
        serverId: session.serverId,
        workspace,
        agents: session.agents,
        projects: session.projects,
        layout: input.layoutsByWorkspace?.[workspaceKey],
        explorerPaneId: input.explorerPaneIdByWorkspace?.[workspaceKey],
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
  layout?: WorkspaceLayout;
  explorerPaneId?: string | null;
}): { section: SidebarWorkspaceSection; iconTargets: ProjectIconTarget[] } {
  const workspaceId = input.workspace.id;
  const workspaceKey = `${input.serverId}:${workspaceId}`;
  const iconTargets: ProjectIconTarget[] = [];
  const realMembers = input.workspace.members.filter((member) =>
    input.projects.has(member.projectId),
  );
  const members = realMembers.map<SidebarWorkspaceMemberRow>((member, index) => {
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
      workspaceDirectoryLabel: member.worktreeSlug ?? shortenPath(member.workspaceDirectory),
      diffStat: member.diffStat ?? null,
      isPrimary: index === 0,
      agents: [],
    };
  });

  const memberByDirectory = new Map<string, SidebarWorkspaceMemberRow>();
  for (const member of members) {
    const directory = normalizeWorkspacePath(member.workspaceDirectory);
    if (directory && !memberByDirectory.has(directory)) {
      memberByDirectory.set(directory, member);
    }
  }
  const uncategorized: SidebarWorkspaceUncategorizedRow = {
    memberKey: `${workspaceKey}#uncategorized`,
    agents: [],
  };

  addNewAgentRows({ layout: input.layout, memberByDirectory, uncategorized });
  const openAgentIds = collectOpenAgentTabIds(input.layout);

  for (const agent of input.agents.values()) {
    if (agent.archivedAt) continue;
    if (normalizeWorkspaceOpaqueId(agent.workspaceId) !== workspaceId) continue;
    if (!openAgentIds.has(agent.id)) continue;
    const directory = normalizeWorkspacePath(agent.cwd);
    const matchedMember = directory ? memberByDirectory.get(directory) : undefined;
    (matchedMember ?? uncategorized).agents.push(
      createAgentRow(
        agent,
        matchedMember?.workspaceDirectoryLabel ?? shortenPath(agent.cwd),
        Boolean(matchedMember),
      ),
    );
  }

  for (const bucket of [...members, uncategorized]) {
    sortAgentBucket(bucket);
  }
  members.sort(compareMemberRows);

  return {
    section: {
      workspaceKey,
      serverId: input.serverId,
      workspaceId,
      uncategorized,
      members,
      paneStatusCounts: countPaneStatuses(input),
    },
    iconTargets,
  };
}

/**
 * The panes that glow orange, red or green. Only a pane's front tab lights it — `SplitPaneView`
 * in split-container.tsx picks it with the same `deriveWorkspacePaneState` call — and the Explorer
 * dock never glows, so a tab behind the front one is not counted here. A terminal takes the bucket
 * the daemon lists for it: only a known agent running in it ever gets one, and the client has no
 * terminal activity of its own for a workspace that is not open. A provider subagent tab is not
 * counted: its status lives in the client's subagent store, not in the session this model reads.
 */
function countPaneStatuses(input: {
  workspace: WorkspaceDescriptor;
  agents: ReadonlyMap<string, Agent>;
  layout?: WorkspaceLayout;
  explorerPaneId?: string | null;
}): SidebarPaneStatusCounts {
  // Without terminal buckets (an old daemon) the counts would leave out every terminal pane.
  if (!input.layout || !input.workspace.terminalStatusBuckets) {
    return EMPTY_PANE_STATUS_COUNTS;
  }
  const tabs = collectAllTabs(input.layout.root);
  const explorerPaneId = resolveExplorerSidebarPaneId(input.layout, input.explorerPaneId);
  const counts: Record<SidebarPaneStatusBucket, number> = { ...EMPTY_PANE_STATUS_COUNTS };
  for (const pane of collectAllPanes(input.layout.root)) {
    if (pane.id === explorerPaneId) continue;
    const target = deriveWorkspacePaneState({ pane, tabs }).activeTab?.descriptor.target;
    const agent = target?.kind === "agent" ? input.agents.get(target.agentId) : undefined;
    let bucket: SidebarStateBucket | undefined;
    if (target?.kind === "terminal") {
      bucket = input.workspace.terminalStatusBuckets?.[target.terminalId];
    } else if (agent) {
      bucket = deriveAgentStatusBucket(agent);
    }
    if (isPaneStatusBucket(bucket)) {
      counts[bucket] += 1;
    }
  }
  return counts;
}

function collectOpenAgentTabIds(layout: WorkspaceLayout | undefined): Set<string> {
  const agentIds = new Set<string>();
  if (!layout) {
    return agentIds;
  }
  for (const tab of collectAllTabs(layout.root)) {
    if (tab.target.kind === "agent") {
      agentIds.add(tab.target.agentId);
    }
  }
  return agentIds;
}

type SidebarAgentBucket = Pick<SidebarWorkspaceMemberRow, "newAgents" | "agents">;

function sortAgentBucket(bucket: SidebarAgentBucket): void {
  bucket.newAgents?.sort(
    (left, right) => right.createdAt - left.createdAt || left.tabId.localeCompare(right.tabId),
  );
  bucket.agents.sort(compareAgentRows);
}

function addNewAgentRows(input: {
  layout?: WorkspaceLayout;
  memberByDirectory: ReadonlyMap<string, SidebarWorkspaceMemberRow>;
  uncategorized: SidebarWorkspaceUncategorizedRow;
}): void {
  for (const tab of input.layout ? collectAllTabs(input.layout.root) : []) {
    // Drafts only. A `new_tab` is an empty pane waiting on a choice, not an agent the user asked
    // for — the sidebar manages agents, so a pane earns a row once it becomes one.
    if (tab.target.kind !== "draft") continue;
    // A draft carries its chosen project on the target until the composer pins one into `setup`.
    const cwd = (tab.target.setup?.cwd ?? tab.target.cwd)?.trim();
    const directory = normalizeWorkspacePath(cwd);
    const matchedMember = directory ? input.memberByDirectory.get(directory) : undefined;
    const bucket = matchedMember ?? input.uncategorized;
    (bucket.newAgents ??= []).push({
      tabId: tab.tabId,
      title: tab.title?.trim() || null,
      createdAt: tab.createdAt,
      cwd: cwd ?? "",
      cwdLabel: matchedMember?.workspaceDirectoryLabel ?? (cwd ? shortenPath(cwd) : ""),
      matchesMemberDirectory: Boolean(matchedMember),
      labels: tab.target.labels ?? [],
    });
  }
}

function createAgentRow(
  agent: Agent,
  cwdLabel: string,
  matchesMemberDirectory: boolean,
): SidebarWorkspaceAgentRow {
  return {
    agentId: agent.id,
    title: agent.title?.trim() || "Untitled agent",
    cwd: agent.cwd,
    cwdLabel,
    matchesMemberDirectory,
    labels: getAgentWorkspaceLabelNames(agent.labels),
    statusBucket: deriveAgentStatusBucket(agent),
    lastActivityAt: agent.lastActivityAt,
  };
}

function deriveAgentStatusBucket(agent: Agent): SidebarStateBucket {
  return deriveSidebarStateBucket({
    status: agent.status,
    pendingPermissionCount: agent.pendingPermissions.length,
    backgroundWorkCount: agent.backgroundWorkCount,
    requiresAttention: agent.requiresAttention,
    attentionReason: agent.attentionReason,
  });
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
    left.paneStatusCounts.needs_input !== right.paneStatusCounts.needs_input ||
    left.paneStatusCounts.failed !== right.paneStatusCounts.failed ||
    left.paneStatusCounts.attention !== right.paneStatusCounts.attention ||
    left.members.length !== right.members.length ||
    !areAgentBucketsEqual(left.uncategorized, right.uncategorized)
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
    left.workspaceDirectoryLabel !== right.workspaceDirectoryLabel ||
    left.isPrimary !== right.isPrimary
  ) {
    return false;
  }
  if (
    (left.diffStat?.additions ?? null) !== (right.diffStat?.additions ?? null) ||
    (left.diffStat?.deletions ?? null) !== (right.diffStat?.deletions ?? null)
  ) {
    return false;
  }
  return areAgentBucketsEqual(left, right);
}

function areAgentBucketsEqual(left: SidebarAgentBucket, right: SidebarAgentBucket): boolean {
  return (
    areNewAgentRowsEqual(left.newAgents ?? [], right.newAgents ?? []) &&
    areAgentRowsEqual(left.agents, right.agents)
  );
}

function areNewAgentRowsEqual(
  left: readonly SidebarWorkspaceNewAgentRow[],
  right: readonly SidebarWorkspaceNewAgentRow[],
): boolean {
  return (
    left.length === right.length &&
    left.every((row, index) => {
      const rightRow = right[index];
      return (
        Boolean(rightRow) &&
        row.tabId === rightRow.tabId &&
        row.title === rightRow.title &&
        row.createdAt === rightRow.createdAt &&
        row.cwd === rightRow.cwd &&
        row.cwdLabel === rightRow.cwdLabel &&
        row.matchesMemberDirectory === rightRow.matchesMemberDirectory &&
        row.labels.length === rightRow.labels.length &&
        row.labels.every((label, labelIndex) => label === rightRow.labels[labelIndex])
      );
    })
  );
}

function areAgentRowsEqual(
  left: readonly SidebarWorkspaceAgentRow[],
  right: readonly SidebarWorkspaceAgentRow[],
): boolean {
  return (
    left.length === right.length &&
    left.every((leftAgent, index) => {
      const rightAgent = right[index];
      return (
        Boolean(rightAgent) &&
        leftAgent.agentId === rightAgent.agentId &&
        leftAgent.title === rightAgent.title &&
        leftAgent.cwd === rightAgent.cwd &&
        leftAgent.cwdLabel === rightAgent.cwdLabel &&
        leftAgent.matchesMemberDirectory === rightAgent.matchesMemberDirectory &&
        leftAgent.labels.length === rightAgent.labels.length &&
        leftAgent.labels.every((label, labelIndex) => label === rightAgent.labels[labelIndex]) &&
        leftAgent.statusBucket === rightAgent.statusBucket &&
        leftAgent.lastActivityAt.getTime() === rightAgent.lastActivityAt.getTime()
      );
    })
  );
}
