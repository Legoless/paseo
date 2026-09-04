import { homedir } from "node:os";
import { expect, test } from "vitest";

import { DaemonClient } from "./test-utils/index.js";
import { createTestPaseoDaemon } from "./test-utils/paseo-daemon.js";

// COMPAT(workspaceProjectless): added in v0.8.0, remove after 2028-03-01.
// A projectless workspace is the one shape where `members: []` is the truth
// instead of "old daemon, derive the implicit member from the scalars", so the
// descriptor has to carry membersAuthoritative to say so. The scalar mirror is
// still filled — clients older than v0.8.0 render only those fields — using the
// workspace's own id as a stand-in projectId. That stand-in must never reach the
// project registry, and the workspace must survive a fetch round trip without
// being archived or filtered out for owning no checkout.
test("workspace.create with an empty source creates a workspace holding no projects", async () => {
  const daemon = await createTestPaseoDaemon();
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.8.0",
  });

  try {
    await client.connect();

    expect(client.getLastServerInfoMessage()?.features?.workspaceProjectless).toBe(true);

    const created = await client.createWorkspace({
      source: { kind: "empty" },
      title: "Scratch pad",
    });

    expect(created.error).toBeNull();
    if (!created.workspace) {
      throw new Error(created.error ?? "workspace.create returned no descriptor");
    }
    const descriptor = created.workspace;

    expect(descriptor.members).toEqual([]);
    expect(descriptor.membersAuthoritative).toBe(true);

    // The scalar mirror pre-v0.8.0 clients read. The stand-in projectId is the
    // workspace's own id, which keeps each projectless workspace a separate row
    // for such a client instead of collapsing them into one bogus project group.
    expect(descriptor.projectId).toBe(descriptor.id);
    expect(descriptor.projectDisplayName).toBe("Scratch pad");
    expect(descriptor.projectRootPath).toBe(homedir());
    expect(descriptor.workspaceDirectory).toBe(homedir());
    expect(descriptor.projectKind).toBe("non_git");
    expect(descriptor.workspaceKind).toBe("directory");
    expect(descriptor.name).toBe("Scratch pad");

    // The stand-in projectId resolves to nothing: this daemon started with no
    // projects and creating a projectless workspace must not add one.
    const projects = await client.listProjects();
    expect(projects.projects).toEqual([]);

    const workspaces = await client.fetchWorkspaces();
    const listed = workspaces.entries.find((entry) => entry.id === descriptor.id);
    expect(listed?.members).toEqual([]);
    expect(listed?.membersAuthoritative).toBe(true);
    expect(listed?.name).toBe("Scratch pad");
    expect(listed?.archivingAt).toBeNull();
  } finally {
    await client.close().catch(() => undefined);
    await daemon.close();
  }
}, 60000);
