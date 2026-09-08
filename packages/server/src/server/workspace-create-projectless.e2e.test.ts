import { expect, test } from "vitest";

import { DaemonClient } from "./test-utils/index.js";
import { createTestPaseoDaemon } from "./test-utils/paseo-daemon.js";

// Empty membership is authoritative over the legacy wire fields, so creating
// or fetching a blank container must never invent a project or a directory.
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

    expect(descriptor.projectId).toBe("");
    expect(descriptor.projectDisplayName).toBe("");
    expect(descriptor.projectRootPath).toBe("");
    expect(descriptor.workspaceDirectory).toBe("");
    expect(descriptor.projectKind).toBe("non_git");
    expect(descriptor.workspaceKind).toBe("directory");
    expect(descriptor.name).toBe("Scratch pad");

    // Creating a container does not create a project.
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
