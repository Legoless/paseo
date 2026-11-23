#!/usr/bin/env npx tsx

import assert from "node:assert";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createE2ETestContext } from "./helpers/test-daemon.ts";

console.log("=== Workspace Project Commands ===\n");

const ctx = await createE2ETestContext({ timeout: 30000 });

try {
  const dirA = path.join(ctx.workDir, "project-a");
  const dirB = path.join(ctx.workDir, "project-b");
  const dirC = path.join(ctx.workDir, "project-c");
  await mkdir(dirA, { recursive: true });
  await mkdir(dirB, { recursive: true });
  await mkdir(dirC, { recursive: true });

  const createdWs1 = await ctx.paseo([
    "workspace",
    "create",
    "--isolation",
    "local",
    "--path",
    dirA,
    "--title",
    "Workspace 1",
    "--json",
  ]);
  assert.strictEqual(createdWs1.exitCode, 0, createdWs1.stderr);
  const ws1Id = JSON.parse(createdWs1.stdout).workspaceId as string;

  const createdWs2 = await ctx.paseo([
    "workspace",
    "create",
    "--isolation",
    "local",
    "--path",
    dirC,
    "--title",
    "Workspace 2",
    "--json",
  ]);
  assert.strictEqual(createdWs2.exitCode, 0, createdWs2.stderr);
  const ws2Id = JSON.parse(createdWs2.stdout).workspaceId as string;

  // Initial list shows project-a in ws1.
  const initialList = await ctx.paseo(["workspace", "project", "ls", ws1Id, "--json"]);
  assert.strictEqual(initialList.exitCode, 0, initialList.stderr);
  const initialProjects = JSON.parse(initialList.stdout) as Array<{
    projectId: string;
    cwd: string;
  }>;
  assert.deepStrictEqual(
    initialProjects.map((project) => project.cwd),
    [dirA],
  );
  console.log("✓ workspace project ls");

  // Add project-b by directory path.
  const addedByPath = await ctx.paseo(["workspace", "project", "add", ws1Id, dirB, "--json"]);
  assert.strictEqual(addedByPath.exitCode, 0, addedByPath.stderr);
  const addedResult = JSON.parse(addedByPath.stdout) as {
    workspaceId: string;
    projectId: string;
    cwd: string;
    projects: Array<{ cwd: string }>;
  };
  assert.strictEqual(addedResult.workspaceId, ws1Id);
  assert.strictEqual(addedResult.cwd, dirB);
  assert.deepStrictEqual(
    addedResult.projects.map((project) => project.cwd),
    [dirA, dirB],
  );
  const projectBId = addedResult.projectId;
  console.log("✓ workspace project add <path>");

  // Duplicate add fails cleanly.
  const duplicateAdd = await ctx.paseo(["workspace", "project", "add", ws1Id, dirB, "--json"]);
  assert.notStrictEqual(duplicateAdd.exitCode, 0);
  console.log("✓ workspace project add rejects duplicate directory");

  // Move project-b from ws1 to ws2.
  const moved = await ctx.paseo(["workspace", "project", "move", ws1Id, ws2Id, dirB, "--json"]);
  assert.strictEqual(moved.exitCode, 0, moved.stderr);
  assert.deepStrictEqual(JSON.parse(moved.stdout), {
    sourceWorkspaceId: ws1Id,
    targetWorkspaceId: ws2Id,
    cwd: dirB,
    movedAgentIds: [],
    movedTerminalIds: [],
  });

  const ws1AfterMove = await ctx.paseo(["workspace", "project", "ls", ws1Id, "--json"]);
  assert.strictEqual(ws1AfterMove.exitCode, 0, ws1AfterMove.stderr);
  assert.deepStrictEqual(
    (JSON.parse(ws1AfterMove.stdout) as Array<{ cwd: string }>).map((project) => project.cwd),
    [dirA],
  );

  const ws2AfterMove = await ctx.paseo(["workspace", "project", "ls", ws2Id, "--json"]);
  assert.strictEqual(ws2AfterMove.exitCode, 0, ws2AfterMove.stderr);
  assert.deepStrictEqual(
    (JSON.parse(ws2AfterMove.stdout) as Array<{ cwd: string }>).map((project) => project.cwd),
    [dirC, dirB],
  );
  console.log("✓ workspace project move");

  // Remove project-b from ws2 by --project id.
  const removed = await ctx.paseo([
    "workspace",
    "project",
    "remove",
    ws2Id,
    "--project",
    projectBId,
    "--json",
  ]);
  assert.strictEqual(removed.exitCode, 0, removed.stderr);
  const removedResult = JSON.parse(removed.stdout) as {
    workspaceId: string;
    cwd: string;
    status: string;
    projects: Array<{ cwd: string }>;
  };
  assert.strictEqual(removedResult.workspaceId, ws2Id);
  assert.strictEqual(removedResult.cwd, dirB);
  assert.strictEqual(removedResult.status, "removed");
  assert.deepStrictEqual(
    removedResult.projects.map((project) => project.cwd),
    [dirC],
  );
  console.log("✓ workspace project remove --project");

  // Re-add project-b to ws1 by --project id alone (no path argument).
  const addedByProjectId = await ctx.paseo([
    "workspace",
    "project",
    "add",
    ws1Id,
    "--project",
    projectBId,
    "--json",
  ]);
  assert.strictEqual(addedByProjectId.exitCode, 0, addedByProjectId.stderr);
  const readded = JSON.parse(addedByProjectId.stdout) as {
    workspaceId: string;
    projectId: string;
    cwd: string;
    projects: Array<{ cwd: string }>;
  };
  assert.strictEqual(readded.workspaceId, ws1Id);
  assert.strictEqual(readded.projectId, projectBId);
  assert.strictEqual(readded.cwd, dirB);
  assert.deepStrictEqual(
    readded.projects.map((project) => project.cwd),
    [dirA, dirB],
  );
  console.log("✓ workspace project add --project");
} finally {
  await ctx.stop();
}

console.log("\n=== Workspace Project Commands Tests Passed ===");
