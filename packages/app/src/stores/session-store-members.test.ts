import { describe, expect, it } from "vitest";
import { normalizeWorkspaceMembers } from "./session-store";

// The scalar project fields a daemon always sends. A projectless workspace fills
// them from the home directory and its own id purely so pre-v0.8.0 clients can
// parse the descriptor, which is exactly why they must never decide membership.
const SCALARS = {
  projectId: "proj-1",
  projectDisplayName: "repo",
  projectCustomName: null,
  projectRootPath: "/repo",
  workspaceDirectory: "/repo",
  workspaceKind: "worktree" as const,
  gitRuntime: null,
  diffStat: null,
};

describe("normalizeWorkspaceMembers", () => {
  it("maps the members a daemon sends", () => {
    const members = normalizeWorkspaceMembers({
      ...SCALARS,
      members: [
        {
          projectId: "proj-1",
          projectDisplayName: "repo",
          projectCustomName: null,
          projectRootPath: "/repo",
          workspaceDirectory: "/repo",
          workspaceKind: "worktree" as const,
          worktreeSlug: null,
          branch: null,
        },
      ],
    });

    expect(members).toHaveLength(1);
    expect(members[0]?.projectId).toBe("proj-1");
  });

  // COMPAT(workspaceMultiProject): daemons before v0.7.0 omit members entirely.
  it("synthesizes the implicit member when the daemon omits members", () => {
    const members = normalizeWorkspaceMembers({ ...SCALARS });

    expect(members).toHaveLength(1);
    expect(members[0]?.projectRootPath).toBe("/repo");
  });

  // The distinction the whole feature rests on: an empty list only means "no
  // projects" when the daemon says its list is complete. Without the flag it is
  // indistinguishable from a pre-v0.7.0 daemon, so it must still synthesize.
  it("still synthesizes for an empty list from a daemon that does not claim authority", () => {
    const members = normalizeWorkspaceMembers({ ...SCALARS, members: [] });

    expect(members).toHaveLength(1);
  });

  it("reports no projects for an authoritative empty list", () => {
    const members = normalizeWorkspaceMembers({
      ...SCALARS,
      members: [],
      membersAuthoritative: true,
    });

    expect(members).toEqual([]);
  });
});
